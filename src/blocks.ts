import { hashText, type FormatToken, type SourceBlock, type TranslationRecord } from "./types";
import { m } from "./i18n";

const ALLOWED = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "FIGCAPTION",
  "TD", "TH", "LI", "ASIDE", "BLOCKQUOTE",
]);

function originalText(el: Element): string {
  const spans = Array.from(el.querySelectorAll("span[data-text-index]")) as HTMLElement[];
  return spans.map((span) => span.textContent || "").join("").replace(/\s+/g, " ").trim();
}

// Models sometimes change [[/RT5]] into [//RT5] or [[/RT5]. Recognize those
// variants while preserving well-formed pairs for inline style restoration.
const TOKEN_RE = /\[\s*(?:\[\s*)?(\/{0,3})\s*RT\s*[:：]?\s*(\d+)\s*\]\s*\]?/gi;
const MARKER_NOISE_RE = /\[+\s*\/{0,3}\s*RT\s*[:：]?\s*\d+\s*\]*/gi;

function inlineFormat(node: HTMLElement, parent: HTMLElement | null, id: string): FormatToken | null {
  const tag = node.tagName.toLowerCase();
  const style = node.ownerDocument.defaultView?.getComputedStyle(node);
  const parentStyle = parent ? node.ownerDocument.defaultView?.getComputedStyle(parent) : null;
  if (tag === "sup" || style?.verticalAlign === "super") return { id, tag: "sup" };
  if (tag === "sub" || style?.verticalAlign === "sub") return { id, tag: "sub" };
  if (tag === "a" && (node as HTMLAnchorElement).href) {
    return { id, tag: "a", href: (node as HTMLAnchorElement).href };
  }
  const weight = Number.parseInt(style?.fontWeight || "400", 10);
  const parentWeight = Number.parseInt(parentStyle?.fontWeight || "400", 10);
  if (tag === "b" || tag === "strong" || weight >= 600 && weight > parentWeight) {
    return { id, tag: "strong" };
  }
  if (tag === "i" || tag === "em" || style?.fontStyle === "italic" && parentStyle?.fontStyle !== "italic") {
    return { id, tag: "em" };
  }
  const styleDiffers = !!style && !!parentStyle && (
    style.fontSize !== parentStyle.fontSize || style.fontWeight !== parentStyle.fontWeight ||
    style.fontStyle !== parentStyle.fontStyle
  );
  if (tag === "span" && styleDiffers) {
    return {
      id,
      tag: "span",
      style: {
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        fontSize: style.fontSize,
      },
    };
  }
  return null;
}

function formattedText(el: HTMLElement): { text: string; translationInput: string; formats: FormatToken[] } {
  const formats: FormatToken[] = [];
  let sequence = 0;
  const walk = (node: Node, parent: HTMLElement | null): string => {
    // Use DOM node type numbers instead of the global `Node` constructor.
    // Zotero's reader sandbox does not expose that constructor in every
    // window, although the nodes themselves are ordinary DOM nodes.
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    const child = node as HTMLElement;
    const token = inlineFormat(child, parent, String(sequence++));
    const content = Array.from(child.childNodes).map((item) => walk(item as Node, child)).join("");
    if (!token) return content;
    formats.push(token);
    return `[[RT${token.id}]]${content}[[/RT${token.id}]]`;
  };
  const raw = Array.from(el.childNodes).map((item) => walk(item as Node, el)).join("");
  const translationInput = raw.replace(/\s+/g, " ").trim();
  const text = originalText(el);
  return { text, translationInput: translationInput || text, formats };
}

function balancedMarkerIDs(value: string): Set<string> {
  const stack: string[] = [];
  const invalid = new Set<string>();
  const completed = new Set<string>();
  for (const match of value.matchAll(TOKEN_RE)) {
    const slash = match[1];
    const id = match[2];
    if (!slash) {
      stack.push(id);
      continue;
    }
    if (stack[stack.length - 1] === id) {
      stack.pop();
      completed.add(id);
      continue;
    }
    invalid.add(id);
    const index = stack.lastIndexOf(id);
    if (index >= 0) {
      for (let i = index; i < stack.length; i++) invalid.add(stack[i]);
      stack.splice(index, 1);
    }
  }
  for (const id of stack) invalid.add(id);
  return new Set([...completed].filter((id) => !invalid.has(id)));
}

/** Keep link labels in translations, but omit the destination and link behavior. */
export function removeTranslationLinks(value: string): string {
  return value.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, "$1");
}

function appendFormatted(doc: Document, container: HTMLElement, value: string, formats: FormatToken[]): void {
  const byID = new Map(formats.map((format) => [format.id, format]));
  const validIDs = balancedMarkerIDs(value);
  const stack: Array<{ id: string; element: HTMLElement }> = [{ id: "", element: container }];
  let last = 0;
  value.replace(TOKEN_RE, (match, slash: string, markerID: string, offset: number) => {
    const before = value.slice(last, offset);
    if (before) appendMarkdownText(doc, stack[stack.length - 1].element, cleanMarkerNoise(before));
    const id = markerID;
    if (!slash) {
      const format = byID.get(id);
      if (format && validIDs.has(id)) {
        const child = doc.createElement(format.tag === "a" ? "span" : format.tag);
        child.dataset.readtransFormatId = format.id;
        if (format.style) Object.assign(child.style, format.style);
        stack[stack.length - 1].element.append(child);
        stack.push({ id, element: child });
      }
    } else if (stack.length > 1 && stack[stack.length - 1].id === id) {
      stack.pop();
    }
    last = offset + match.length;
    return match;
  });
  const after = value.slice(last);
  if (after) appendMarkdownText(doc, stack[stack.length - 1].element, cleanMarkerNoise(after));
}

function cleanMarkerNoise(value: string): string {
  return value.replace(MARKER_NOISE_RE, "");
}

/** Render the Markdown commonly returned by translation services as DOM. */
function appendMarkdownText(doc: Document, container: HTMLElement, value: string): void {
  const htmlFormat = /<(sup|sub)>([\s\S]*?)<\/\1>/gi;
  let htmlLast = 0;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlFormat.exec(value))) {
    appendInlineMarkdown(doc, container, value.slice(htmlLast, htmlMatch.index));
    const child = doc.createElement(htmlMatch[1].toLowerCase());
    appendMarkdownText(doc, child, htmlMatch[2]);
    container.append(child);
    htmlLast = htmlMatch.index + htmlMatch[0].length;
  }
  appendInlineMarkdown(doc, container, value.slice(htmlLast));
}

function appendInlineMarkdown(doc: Document, container: HTMLElement, value: string): void {
  const markdown = /(\\[\\`*_~\[\]])|(\*\*|__)([\s\S]*?)\2|(\*|_)([^\n]*?)\4|`([^`\n]+)`|~~([^\n]+?)~~|\[([^\]]+)\]\(([^)\n]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = markdown.exec(value))) {
    if (match.index > last) container.append(doc.createTextNode(value.slice(last, match.index)));
    if (match[1]) {
      container.append(doc.createTextNode(match[1].slice(1)));
    } else if (match[2]) {
      const child = doc.createElement("strong");
      appendMarkdownText(doc, child, match[3]);
      container.append(child);
    } else if (match[4]) {
      const child = doc.createElement("em");
      appendMarkdownText(doc, child, match[5]);
      container.append(child);
    } else if (match[6]) {
      const child = doc.createElement("code");
      child.textContent = match[6];
      container.append(child);
    } else if (match[7]) {
      const child = doc.createElement("del");
      appendMarkdownText(doc, child, match[7]);
      container.append(child);
    } else if (match[8] && match[9]) {
      appendMarkdownText(doc, container, match[8]);
    }
    last = match.index + match[0].length;
  }
  if (last < value.length) container.append(doc.createTextNode(value.slice(last)));
}

function markdownSource(value: string, formats: FormatToken[]): string {
  const byID = new Map(formats.map((format) => [format.id, format]));
  const validIDs = balancedMarkerIDs(value);
  const markdown = value.replace(TOKEN_RE, (match, slash: string, markerID: string) => {
    const format = byID.get(markerID);
    if (!format || !validIDs.has(markerID)) return "";
    if (!slash) {
      if (format.tag === "strong") return "**";
      if (format.tag === "em") return "*";
      if (format.tag === "sup" || format.tag === "sub") return `<${format.tag}>`;
      if (format.tag === "a") return "";
      return "";
    }
    if (format.tag === "strong") return "**";
    if (format.tag === "em") return "*";
    if (format.tag === "sup" || format.tag === "sub") return `</${format.tag}>`;
    if (format.tag === "a") return "";
    return "";
  }).replace(MARKER_NOISE_RE, "");
  return removeTranslationLinks(markdown);
}

export function collectBlocks(doc: Document): SourceBlock[] {
  const root = doc.querySelector("#sdt-content");
  if (!root) return [];
  const result: SourceBlock[] = [];
  let section = "";
  for (const el of Array.from(root.querySelectorAll("[data-ref-path]")) as HTMLElement[]) {
    if (!ALLOWED.has(el.tagName)) continue;
    if (el.closest(".readtrans-translation,.sdt-source-crop,.sdt-math")) continue;
    if (el.classList.contains("sdt-reference")) continue;
    if ((Array.from(el.querySelectorAll("[data-ref-path]")) as HTMLElement[]).some((child) =>
      ALLOWED.has(child.tagName) && child.querySelector("span[data-text-index]"))) {
      continue;
    }
    const rich = formattedText(el);
    const text = rich.text;
    if (text.length < (el.tagName.startsWith("H") ? 2 : 8)) continue;
    if (/^H[1-6]$/.test(el.tagName)) section = text;
    const refPath = el.dataset.refPath;
    if (!refPath) continue;
    const hash = hashText(text);
    result.push({
      id: `${refPath}:${hash}`,
      refPath,
      hash,
      text,
      kind: el.tagName.toLowerCase(),
      section,
      translationInput: rich.translationInput,
      formats: rich.formats,
      element: el,
    });
  }
  return result;
}

export function renderTranslations(
  doc: Document,
  blocks: SourceBlock[],
  record: TranslationRecord | null,
  visible: boolean,
  onSaveEdit?: (blockID: string, translation: string) => Promise<void>,
): void {
  try {
    const translations = new Map(record?.blocks.map((b) => [b.id, b.translation]) || []);
    const liveIDs = new Set(blocks.map((b) => b.id));
    for (const node of Array.from(doc.querySelectorAll(".readtrans-translation")) as HTMLElement[]) {
      try {
        if (!visible || !liveIDs.has(node.dataset.blockId || "")) node.remove();
      } catch { /* node belongs to an iframe Zotero just replaced */ }
    }
    if (!visible) return;
    for (const block of blocks) {
      try {
        const translated = translations.get(block.id);
        if (!translated) continue;
        const isCell = block.element.tagName === "TD" || block.element.tagName === "TH";
        // Do not interpolate refPath into a CSS selector: paths can contain
        // quotes or brackets.  Inspect the direct translation nodes instead.
        const existing = isCell
          ? Array.from(block.element.querySelectorAll(".readtrans-translation"))
            .find((node) => (node as HTMLElement).dataset.blockId === block.id) as HTMLElement | undefined
          : block.element.nextElementSibling as HTMLElement | null;
        if (existing?.classList.contains("readtrans-translation") &&
            existing.dataset.blockId === block.id) {
          const editArea = existing.querySelector<HTMLTextAreaElement>(".readtrans-translation-editor");
          if (editArea?.dataset.editing === "true") continue;
          const content = existing.querySelector<HTMLElement>(".readtrans-translation-content");
          if (content) {
            // Replacing text nodes invalidates the browser's selection. The
            // observer also sees our own insertions, so unchanged content must
            // keep its nodes across render passes.
            if (content.dataset.renderedTranslation !== translated) {
              content.dataset.renderedTranslation = translated;
              content.replaceChildren();
              appendFormatted(doc, content, translated, block.formats || []);
            }
            continue;
          }
          // Upgrade a translation node created by an older ReadTrans build.
          existing.remove();
        }
        const translation = doc.createElement("div");
        translation.className = "readtrans-translation";
        translation.dataset.blockId = block.id;
        translation.lang = "zh-CN";
        // Let the browser keep its native selection and copy behavior while
        // preventing the reader's source-text mouse handlers from taking over.
        for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"]) {
          translation.addEventListener(type, (event) => {
            // Reader-owned figure and citation links still need Zotero's
            // delegated click handling to navigate to their targets.
            if ((event.target as Element | null)?.closest?.("a")) return;
            event.stopPropagation();
          });
        }
        const content = doc.createElement("div");
        content.className = "readtrans-translation-content";
        content.dataset.renderedTranslation = translated;
        content.style.userSelect = "text";
        appendFormatted(doc, content, translated, block.formats || []);
        translation.append(content);
        if (onSaveEdit) {
          const actions = doc.createElement("div");
          actions.className = "readtrans-translation-actions";
          const edit = doc.createElement("button");
          const save = doc.createElement("button");
          const cancel = doc.createElement("button");
          const editor = doc.createElement("textarea");
          editor.className = "readtrans-translation-editor";
          editor.hidden = true;
          editor.rows = 6;
          editor.wrap = "soft";
          editor.spellcheck = false;
          editor.style.cssText = "display:none;width:100%;box-sizing:border-box;min-height:5em;padding:7px 8px;border:1px solid #9eacc0;border-radius:5px;background:#fff;color:#26384b;font:13px/1.55 system-ui,sans-serif;resize:vertical;white-space:pre-wrap;";
          const stopReaderShortcuts = (event: Event) => event.stopPropagation();
          editor.addEventListener("keydown", stopReaderShortcuts);
          editor.addEventListener("keyup", stopReaderShortcuts);
          editor.addEventListener("keypress", stopReaderShortcuts);
          editor.addEventListener("mousedown", stopReaderShortcuts);
          editor.addEventListener("click", stopReaderShortcuts);
          for (const button of [edit, save, cancel]) {
            button.type = "button";
            button.style.cssText = "border:1px solid #c6d0dc;border-radius:4px;padding:2px 7px;background:#fff;color:#526477;font:12px system-ui,sans-serif;cursor:pointer;";
            button.addEventListener("click", (event) => event.stopPropagation());
          }
          edit.textContent = "✎";
          edit.title = m("editTranslation");
          edit.setAttribute("aria-label", m("editTranslation"));
          save.textContent = m("saveEdit");
          cancel.textContent = m("cancelEdit");
          save.hidden = true;
          cancel.hidden = true;
          edit.style.cssText = "border:0;border-radius:50%;padding:0;width:24px;height:24px;background:rgba(255,255,255,.9);color:#486b93;font:18px/24px system-ui,sans-serif;cursor:pointer;";
          actions.style.cssText = "position:absolute;top:4px;right:5px;display:flex;justify-content:flex-end;align-items:center;gap:5px;opacity:0;pointer-events:none;transition:opacity .12s ease;z-index:2;";
          const showActions = () => { actions.style.opacity = "1"; actions.style.pointerEvents = "auto"; };
          const hideActions = () => {
            if (editor.dataset.editing !== "true") {
              actions.style.opacity = "0";
              actions.style.pointerEvents = "none";
            }
          };
          translation.addEventListener("mouseenter", showActions);
          translation.addEventListener("mouseleave", hideActions);
          translation.addEventListener("focusin", showActions);
          translation.addEventListener("focusout", hideActions);
          let currentValue = translated;
          const setEditing = (editing: boolean) => {
            editor.dataset.editing = editing ? "true" : "false";
            editor.hidden = !editing;
            editor.style.display = editing ? "block" : "none";
            content.hidden = editing;
            content.style.display = editing ? "none" : "block";
            edit.hidden = editing;
            save.hidden = !editing;
            cancel.hidden = !editing;
            actions.style.opacity = editing ? "1" : "0";
            actions.style.pointerEvents = editing ? "auto" : "none";
          };
          edit.addEventListener("click", () => {
            editor.value = markdownSource(currentValue, block.formats || []);
            setEditing(true);
            editor.focus();
          });
          cancel.addEventListener("click", () => {
            setEditing(false);
          });
          save.addEventListener("click", () => {
            if (!onSaveEdit) return;
            const value = removeTranslationLinks(editor.value.trim());
            if (!value.replace(TOKEN_RE, "").trim()) {
              editor.title = m("emptyEdit");
              return;
            }
            save.disabled = true;
            void onSaveEdit(block.id, value).then(() => {
              currentValue = value;
              editor.title = "";
              content.dataset.renderedTranslation = currentValue;
              content.replaceChildren();
              appendFormatted(doc, content, currentValue, block.formats || []);
              setEditing(false);
            }).catch((error: unknown) => {
              editor.title = String(error);
            }).finally(() => {
              save.disabled = false;
            });
          });
          actions.append(edit, save, cancel);
          translation.append(editor, actions);
        }
        const computed = doc.defaultView?.getComputedStyle(block.element);
        const inheritedStyle = computed ?
          `font-family:system-ui,-apple-system,"Noto Sans CJK SC","Noto Sans SC",sans-serif;font-size:${computed.fontSize};font-weight:${computed.fontWeight};font-style:${computed.fontStyle};line-height:${computed.lineHeight};letter-spacing:${computed.letterSpacing};text-align:${computed.textAlign};` :
          "";
        translation.style.cssText =
          "display:block;position:relative;margin:.35em 0 1em;padding:.35em 2.4em .35em .65em;border-left:3px solid #6c83a5;" +
          "color:#40536a;background:rgba(116,141,170,.09);white-space:pre-wrap;" +
          "font-family:system-ui,sans-serif;font-size:.92em;line-height:1.65;text-align:left;user-select:text;" + inheritedStyle;
        if (isCell) block.element.append(translation);
        else block.element.after(translation);
      } catch {
        // A single block can become stale while Zotero paginates the reader;
        // leave it for the next render pass instead of aborting the task.
      }
    }
  } catch {
    // The whole reader document may have been destroyed.  Callers will bind
    // the replacement document on the next toolbar tick.
  }
}
