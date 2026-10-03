import { collectBlocks, removeTranslationLinks, renderTranslations } from "./blocks";
import { makeBatches, translateBatch } from "./ollama";
import { loadSettings } from "./settings";
import { isChineseLocale, m, ui } from "./i18n";
import {
  loadCheckpoint, loadSaved, newRecord, saveAttachment, saveCheckpoint, sourceHash,
} from "./storage";
import { ADDON_ID, type SourceBlock, type TranslationRecord } from "./types";

type Reader = _ZoteroTypes.ReaderInstance;
type ToolbarEvent = _ZoteroTypes.Reader.EventParams<"renderToolbar">;

type Session = {
  reader: Reader;
  pdf: Zotero.Item;
  toolbarDoc: Document;
  viewDoc: Document | null;
  wrapper: HTMLElement;
  button: HTMLButtonElement;
  menu: HTMLElement;
  status: HTMLElement;
  observer: MutationObserver | null;
  interval: number;
  record: TranslationRecord | null;
  blocks: SourceBlock[];
  visible: boolean;
  running: boolean;
  paused: boolean;
  /** Set before Zotero destroys the reader toolbar or its iframe. */
  disposed: boolean;
  generation: number;
  renderTimer: number | null;
  settings: ReturnType<typeof loadSettings>;
};

const sessions = new Set<Session>();
const byReader = new WeakMap<object, Session>();
const registeredMenuIDs: string[] = [];
let batchRunning = false;
// Use the same project mark in the library context menu and the preferences
// pane.  Zotero scales the SVG to the menu row size automatically.
const MENU_ICON = "chrome://readtrans/content/icons/readtrans-icon.svg";

/**
 * Reader documents are replaced while Zotero is parsing, changing layout, or
 * closing a tab.  Gecko represents a node from the old document as a "dead
 * object" and throws when any property is read.  Keep these checks small and
 * defensive; they are deliberately allowed to return false during teardown.
 */
function sessionAlive(session: Session): boolean {
  try {
    return !session.disposed && !!session.wrapper.isConnected;
  } catch {
    return false;
  }
}

function safeSetDisplay(element: HTMLElement, value: string): void {
  try { element.style.display = value; } catch { /* Zotero replaced the node */ }
}

function safeSetPressed(button: HTMLButtonElement, value: boolean): void {
  try { button.setAttribute("aria-pressed", value ? "true" : "false"); } catch { /* toolbar was rebuilt */ }
}

function safeCloseMenu(session: Session): void {
  safeSetDisplay(session.menu, "none");
}

function viewDocument(reader: Reader): Document | null {
  try {
    const internal = (reader as any)._internalReader;
    const views = internal?._lastViewPrimary === false
      ? [internal?._secondaryView, internal?._primaryView]
      : [internal?._primaryView, internal?._secondaryView];
    for (const view of views) {
      try {
        const doc = view?._iframeWindow?.document || view?._iframe?.contentDocument;
        if (doc?.querySelector?.("#sdt-content")) return doc;
      } catch { /* a reader iframe can be replaced */ }
    }
  } catch { /* the Reader object itself can be torn down */ }
  try {
    const doc = (reader as any)._iframeWindow?.document;
    if (doc?.querySelector?.("#sdt-content")) return doc;
    // Some Zotero 10 builds place the reflowable reader one iframe deeper.
    for (const iframe of Array.from(doc?.querySelectorAll?.("iframe") || [])) {
      try {
        const child = (iframe as HTMLIFrameElement).contentDocument;
        if (child?.querySelector?.("#sdt-content")) return child;
        for (const nested of Array.from(child?.querySelectorAll?.("iframe") || [])) {
          const nestedDoc = (nested as HTMLIFrameElement).contentDocument;
          if (nestedDoc?.querySelector?.("#sdt-content")) return nestedDoc;
        }
      } catch { /* cross-wrapper/dead iframe */ }
    }
  } catch { /* reader closed */ }
  return null;
}

function readingModeActive(session: Session): boolean {
  if (!sessionAlive(session)) return false;
  // Zotero 10 can render the reading-mode toolbar and its toggle in different
  // documents. The structured reading root is the authoritative state.
  if (viewDocument(session.reader)) return true;
  try {
    const button = session.toolbarDoc.getElementById("readingMode") ||
      (session.reader as any)._iframeWindow?.document?.getElementById("readingMode");
    return !!button && (button.classList.contains("active") ||
      button.getAttribute("aria-pressed") === "true" ||
      button.getAttribute("checked") === "true" ||
      button.getAttribute("data-active") === "true");
  } catch {
    return false;
  }
}

function setStatus(session: Session, message: string): void {
  try {
    if (session.disposed) return;
    session.status.textContent = message;
    session.status.title = message;
  } catch {
    // Zotero can destroy the toolbar while a translation request is pending.
  }
}

async function saveEditedTranslation(
  session: Session,
  blockID: string,
  translation: string,
): Promise<void> {
  if (session.disposed || !session.record) throw new Error(m("translationUnavailable"));
  const block = session.record.blocks.find((candidate) => candidate.id === blockID);
  if (!block) throw new Error(m("translationUnavailable"));
  const previous = block.translation;
  block.translation = removeTranslationLinks(translation);
  try {
    await saveCheckpoint(session.pdf, session.record);
    if (session.record.complete) await saveAttachment(session.pdf, session.record);
    setStatus(session, m("editSaved"));
  } catch (error) {
    if (previous) block.translation = previous;
    else delete block.translation;
    try { await saveCheckpoint(session.pdf, session.record); } catch { /* retain the original error */ }
    throw error;
  }
}

function scheduleRender(session: Session): void {
  if (!sessionAlive(session) || session.renderTimer !== null) return;
  try {
    const win = session.toolbarDoc.defaultView;
    if (!win) return;
    session.renderTimer = win.setTimeout(() => {
      session.renderTimer = null;
      try {
        if (!sessionAlive(session) || !session.viewDoc || !session.visible || !session.record) return;
        const doc = session.viewDoc;
        const blocks = collectBlocks(doc);
        if (!blocks.length) return;
        const known = new Set(session.record.blocks.map((block) => block.id));
        const additions = blocks.filter((block) => !known.has(block.id));
        if (additions.length) {
          session.record.blocks.push(
            ...additions.map(({ element: _element, ...block }) => block),
          );
          session.record.complete = false;
          if (!session.running && session.visible) void startTranslation(session);
        }
        session.blocks = blocks;
        renderTranslations(doc, blocks, session.record, session.visible,
          (blockID, translation) => saveEditedTranslation(session, blockID, translation));
      } catch {
        // The reader iframe may have been replaced between the checks above.
        // The next toolbar tick will bind the new document.
        try { session.observer?.disconnect(); } catch { /* old observer is dead */ }
        session.observer = null;
        session.viewDoc = null;
      }
    }, 120);
  } catch {
    session.renderTimer = null;
  }
}

function bindView(session: Session, doc: Document | null): void {
  if (session.disposed || session.viewDoc === doc) return;
  try { session.observer?.disconnect(); } catch { /* old iframe was destroyed */ }
  session.observer = null;
  session.viewDoc = doc;
  if (!doc) return;
  try {
    const root = doc.querySelector("#sdt-content");
    if (!root) return;
    const Observer = doc.defaultView?.MutationObserver;
    if (!Observer) return;
    session.observer = new Observer(() => scheduleRender(session));
    session.observer.observe(root, { childList: true, subtree: true });
    scheduleRender(session);
  } catch {
    session.observer = null;
    session.viewDoc = null;
  }
}

function syncMode(session: Session): void {
  try {
    if (!sessionAlive(session)) {
      if (!session.disposed && session.interval !== 0) disposeSession(session);
      return;
    }
    const active = readingModeActive(session);
    safeSetDisplay(session.wrapper, active ? "inline-flex" : "none");
    if (!active) {
      safeCloseMenu(session);
      if (session.visible && session.viewDoc) {
        try { renderTranslations(session.viewDoc, session.blocks, session.record, false); } catch { /* old view */ }
      }
      session.visible = false;
      if (session.running) session.paused = true;
      bindView(session, null);
      return;
    }
    bindView(session, viewDocument(session.reader));
  } catch {
    // Any object touched by this tick can be invalidated by a reader redraw.
    disposeSession(session);
  }
}

async function waitForReadingDocument(session: Session): Promise<Document> {
  for (let i = 0; i < 180; i++) {
    if (session.disposed) throw new Error(m("readerTimeout"));
    if (!readingModeActive(session)) throw new Error(m("readerModeRequired"));
    const doc = viewDocument(session.reader);
    if (doc) {
      bindView(session, doc);
      return doc;
    }
    if (i === 0 || i % 10 === 0) {
      setStatus(session, `${m("readingParsing")} ${Math.round(i / 2)} ${ui("秒", "seconds")}`);
    }
    await Zotero.Promise.delay(500);
  }
  throw new Error(m("readingTimeout"));
}

function showRecord(session: Session): void {
  try {
    if (session.disposed || !session.viewDoc || !session.record) return;
    session.visible = true;
    session.blocks = collectBlocks(session.viewDoc);
    renderTranslations(session.viewDoc, session.blocks, session.record, true,
      (blockID, translation) => saveEditedTranslation(session, blockID, translation));
    safeSetPressed(session.button, true);
  } catch {
    // A redraw can invalidate the view between collectBlocks and rendering.
    session.viewDoc = null;
  }
}

function hideRecord(session: Session): void {
  session.visible = false;
  try {
    if (session.viewDoc) renderTranslations(session.viewDoc, session.blocks, session.record, false);
  } catch { /* reader view was replaced */ }
  safeSetPressed(session.button, false);
  setStatus(session, m("hidden"));
}

function progress(record: TranslationRecord): string {
  const done = record.blocks.filter((b) => !!b.translation).length;
  return `${done}/${record.blocks.length}`;
}

async function startTranslation(session: Session): Promise<void> {
  if (session.disposed || !session.record || session.running) return;
  session.running = true;
  session.paused = false;
  const generation = ++session.generation;
  try {
    const record = session.record;
    const translated = new Set(record.blocks.filter((b) => !!b.translation).map((b) => b.id));
    let pending = session.blocks.filter((b) => !translated.has(b.id));
    while (pending.length) {
      const batch = makeBatches(pending)[0];
      if (session.disposed || session.paused || generation !== session.generation) break;
      setStatus(session, `${m("translating")} ${progress(record)}`);
      const firstIndex = session.blocks.findIndex((b) => b.id === batch[0].id);
      const lastIndex = session.blocks.findIndex((b) => b.id === batch.at(-1)?.id);
      const result = await translateBatch(
        batch,
        session.blocks.slice(Math.max(0, firstIndex - 2), firstIndex),
        session.blocks[lastIndex + 1],
        record.glossary,
        session.settings,
      );
      if (session.disposed || generation !== session.generation) return;
      for (const saved of record.blocks) {
        const translation = result.translations.get(saved.id);
        if (translation) saved.translation = removeTranslationLinks(translation);
      }
      Object.assign(record.glossary, result.terms);
      await saveCheckpoint(session.pdf, record);
      if (session.disposed || generation !== session.generation) return;
      if (session.visible && session.viewDoc) scheduleRender(session);
      pending = session.blocks.filter((b) => !record.blocks.some((saved) => saved.id === b.id && saved.translation));
    }
    if (session.disposed || generation !== session.generation) return;
    if (session.paused) {
      setStatus(session, `${m("pauseContinue")} ${progress(record)} · ${m("continueFromMenu")}`);
      return;
    }
    if (record.blocks.some((b) => !b.translation)) {
      throw new Error(m("incomplete"));
    }
    const currentHash = await sourceHash(session.pdf);
    if (session.disposed || generation !== session.generation) return;
    if (currentHash !== record.source.hash) {
      throw new Error(m("sourceUpdated"));
    }
    record.complete = true;
    await saveCheckpoint(session.pdf, record);
    if (session.disposed || generation !== session.generation) return;
    await saveAttachment(session.pdf, record);
    if (session.disposed || generation !== session.generation) return;
    setStatus(session, `${m("completedSaved")} ${progress(record)}`);
  } catch (error) {
    setStatus(session, `${ui("已暂停：", "Paused: ")}${String(error)}`);
    session.paused = true;
  } finally {
    if (!session.disposed && generation === session.generation) session.running = false;
  }
}

async function activate(session: Session, forceNew = false): Promise<void> {
  try {
    if (session.disposed || session.running || session.wrapper.dataset.busy === "true") return;
    session.wrapper.dataset.busy = "true";
  } catch {
    return;
  }
  try {
    // Preferences may have been changed while this reader stayed open.
    session.settings = loadSettings();
    const doc = await waitForReadingDocument(session);
    let blocks: SourceBlock[] = [];
    for (let i = 0; i < 180; i++) {
      if (session.disposed) return;
      // Zotero may replace the iframe after parsing starts.  Reacquire it on
      // every pass instead of continuing to query the old document object.
      const currentDoc = viewDocument(session.reader) || session.viewDoc || doc;
      if (currentDoc !== session.viewDoc) bindView(session, currentDoc);
      try { blocks = collectBlocks(currentDoc); } catch { blocks = []; }
      if (blocks.length) break;
      if (i % 10 === 0) setStatus(session, `${m("readingGenerating")} ${Math.round(i / 2)} ${ui("秒", "seconds")}`);
      await Zotero.Promise.delay(500);
    }
    if (!blocks.length) throw new Error(m("noText"));
    session.blocks = blocks;
    const hash = await sourceHash(session.pdf);
    if (session.disposed) return;
    if (forceNew) {
      session.generation++;
      session.record = newRecord(session.pdf, hash, blocks, session.settings.provider,
        session.settings.provider === "ollama" ? session.settings.ollamaModel : session.settings.provider,
        session.settings.targetLanguage, session.settings.sourceLanguage);
      await saveCheckpoint(session.pdf, session.record);
      showRecord(session);
      setStatus(session, `${m("restarting")} ${progress(session.record)}`);
      await startTranslation(session);
      return;
    }
    if (session.record && session.record.source.hash === hash &&
        session.record.targetLanguage === session.settings.targetLanguage &&
        (session.record.sourceLanguage || "auto") === session.settings.sourceLanguage &&
        session.record.blocks.length === blocks.length &&
        session.record.blocks.every((b, i) => b.id === blocks[i].id)) {
      showRecord(session);
      if (!session.record.complete && !session.running) await startTranslation(session);
      else setStatus(session, `${ui("已显示译文", "Translation shown")} ${progress(session.record)}`);
      return;
    }
    const saved = await loadSaved(session.pdf, hash, blocks,
      session.settings.targetLanguage, session.settings.sourceLanguage);
    if (saved.record) {
      session.record = saved.record;
      showRecord(session);
      setStatus(session, `${ui("已从 Zotero 附件恢复", "Restored from Zotero attachment")} ${progress(saved.record)}`);
      return;
    }
    session.record = await loadCheckpoint(session.pdf, hash, blocks,
      session.settings.targetLanguage, session.settings.sourceLanguage) ||
      newRecord(session.pdf, hash, blocks, session.settings.provider,
        session.settings.provider === "ollama" ? session.settings.ollamaModel : session.settings.provider,
        session.settings.targetLanguage, session.settings.sourceLanguage);
    await saveCheckpoint(session.pdf, session.record);
    showRecord(session);
    setStatus(session, saved.stale ? m("sourceChanged") : `${m("starting")} ${progress(session.record)}`);
    await startTranslation(session);
  } catch (error) {
    setStatus(session, String(error));
  } finally {
    try { delete session.wrapper.dataset.busy; } catch { /* toolbar document was destroyed */ }
  }
}

function findReaderForPDF(pdf: Zotero.Item): Reader | undefined {
  const existing = Array.from(sessions).find((session) => session.pdf.id === pdf.id);
  if (existing) return existing.reader;
  const readers = ((Zotero.Reader as any)._readers || []) as Reader[];
  return readers.find((reader) => (reader as any)._item?.id === pdf.id);
}

async function ensureReadingMode(session: Session): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (session.disposed) throw new Error(m("readerTimeout"));
    if (readingModeActive(session)) return;
    const docs: Document[] = [];
    try {
      const reader = session.reader as any;
      for (const candidate of [session.toolbarDoc, reader._iframeWindow?.document, reader._internalReader?._primaryView?._iframeWindow?.document, reader._internalReader?._secondaryView?._iframeWindow?.document]) {
        if (candidate && !docs.includes(candidate)) docs.push(candidate);
      }
    } catch { /* reader is being replaced */ }
    let toggled = false;
    for (const doc of docs) {
      try {
        const toggle = doc.getElementById("readingMode") as HTMLElement | null;
        if (!toggle) continue;
        const active = toggle.classList.contains("active") || toggle.getAttribute("aria-pressed") === "true" || toggle.getAttribute("checked") === "true";
        if (!active) {
          toggle.click();
          toggled = true;
        }
      } catch { /* this candidate document was just destroyed */ }
    }
    if (toggled) await Zotero.Promise.delay(500);
    else await Zotero.Promise.delay(250);
  }
  throw new Error(m("noReadingMode"));
}

async function openAndTranslatePDF(pdf: Zotero.Item, closeBackgroundReader = false): Promise<void> {
  const tabs = (globalThis as any).Zotero_Tabs;
  const previousTabID = tabs?.selectedID ?? tabs?.selectedId;
  let reader = findReaderForPDF(pdf);
  let openedByMenu = false;
  if (!reader) {
    reader = await Zotero.Reader.open(pdf.id, undefined, {
      openInBackground: true,
      allowDuplicate: false,
    }) as Reader | undefined;
    openedByMenu = true;
  }
  if (!reader) throw new Error(`${ui("无法打开 PDF：", "Could not open PDF: ")}${pdf.getField("title") || pdf.key}`);
  let session: Session | undefined;
  for (let attempt = 0; attempt < 120; attempt++) {
    session = byReader.get(reader as object);
    if (session) break;
    await Zotero.Promise.delay(250);
  }
  if (!session) throw new Error(m("readerTimeout"));
  try {
    await ensureReadingMode(session);
    await activate(session);
    if (!session.record?.complete) {
      let status = "";
      try { status = session.status.textContent || ""; } catch { /* toolbar was destroyed */ }
      throw new Error(status || m("translationIncomplete"));
    }
  } finally {
    if (openedByMenu && closeBackgroundReader) {
      await Zotero.Promise.delay(150);
      try {
        const tabs = (globalThis as any).Zotero_Tabs;
        const tabID = (reader as any).tabID;
        const selectedID = tabs?.selectedID ?? tabs?.selectedId;
        // Never close a tab unless Zotero exposes both IDs and confirms that
        // the reader is not the active library tab. Some Zotero 10 builds can
        // briefly return an undefined/stale reader.tabID while opening in the
        // background; closing that value can break the next library popup.
        if (typeof tabID === "string" && tabID && tabID !== "zotero-pane" &&
            typeof selectedID === "string" && tabID !== selectedID) {
          tabs.close(tabID);
        }
      } catch { /* keep the background reader if closing is unavailable */ }
    }
    // A background ReaderTab should not change focus, but restore the tab that
    // launched the command in case a Zotero build selected it while loading.
    try {
      const currentTabID = tabs?.selectedID ?? tabs?.selectedId;
      if (typeof previousTabID === "string" && previousTabID &&
          typeof currentTabID === "string" && currentTabID !== previousTabID) {
        tabs.select(previousTabID, false);
      }
    } catch { /* tab selection is unavailable during shutdown */ }
  }
}

function isPDFAttachment(item: Zotero.Item | undefined): boolean {
  if (!item) return false;
  try {
    if ((item as any).isPDFAttachment?.()) return true;
  } catch { /* fall through to MIME/path checks */ }
  try {
    const contentType = String((item as any).attachmentContentType || item.getField?.("mimeType") || "").toLowerCase();
    if (contentType === "application/pdf") return true;
  } catch { /* attachmentContentType is not available on regular items */ }
  try {
    const path = String((item as any).getFilePath?.() || "").toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return false;
  }
}

function pdfAttachmentsFromItems(items: Zotero.Item[] | undefined): Zotero.Item[] {
  const result: Zotero.Item[] = [];
  try {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item) continue;
      if (isPDFAttachment(item)) {
        result.push(item);
        continue;
      }
      // In the library item context menu Zotero normally supplies the parent
      // literature item. Include its PDF child attachments as well.
      try {
        for (const attachmentID of item.getAttachments?.() || []) {
          const attachment = Zotero.Items.get(attachmentID);
          if (isPDFAttachment(attachment)) result.push(attachment);
        }
      } catch { /* selected item has no attachment children */ }
    }
  } catch {
    // Menu callbacks must never throw: Zotero closes the entire popup when an
    // onShowing handler raises, which used to make the menu disappear after
    // the first invocation.
  }
  return Array.from(new Map(result.map((item) => [item.id, item])).values());
}

function contextItems(context: _ZoteroTypes.MenuManager.LibraryMenuContext | undefined): Zotero.Item[] {
  try {
    if (context && Array.isArray(context.items)) return context.items.filter(Boolean);
  } catch {
    // Zotero's library context exposes some fields as lazy getters. A getter
    // can throw briefly while the item tree is being rebuilt.
  }
  // A few Zotero 10 builds briefly omit context.items while rebuilding the
  // library popup. Reading the current selection keeps the second right-click
  // usable without relying on a stale context object.
  try {
    const pane = (Zotero as any).getActiveZoteroPane?.();
    const selected = pane?.getSelectedItems?.();
    return Array.isArray(selected) ? selected.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function setContextVisible(context: _ZoteroTypes.MenuManager.LibraryMenuContext | undefined, visible: boolean): void {
  try {
    context?.setVisible?.(!!visible);
  } catch {
    // A popup can be detached while Zotero is rebuilding it.
  }
}

function selectedPDFs(context: _ZoteroTypes.MenuManager.LibraryMenuContext | undefined): Zotero.Item[] {
  return pdfAttachmentsFromItems(contextItems(context));
}

function deferMenuAction(action: () => void): void {
  // MenuManager dispatches `command` before the popup has finished its own
  // popuphidden cleanup. Starting a reader, prompt, or attachment transaction
  // in the same stack can leave Zotero's library context menu unusable on the
  // next right-click. Capture the selection first, then run after the popup
  // event has returned to Zotero.
  void Zotero.Promise.delay(0).then(action).catch((error: unknown) => {
    try { Zotero.debug(`[${ADDON_ID}] deferred menu action failed: ${String(error)}`); } catch { /* logging unavailable */ }
  });
}

function collectionFromContext(context: _ZoteroTypes.MenuManager.LibraryMenuContext): Zotero.Collection | null {
  const row = context.collectionTreeRow as any;
  const ref = row?.ref;
  if (ref && typeof ref.getChildItems === "function") return ref as Zotero.Collection;
  if (row?.id && typeof Zotero.Collections?.get === "function") {
    const id = Number(String(row.id).replace(/[^0-9]/g, ""));
    if (id) return Zotero.Collections.get(id) || null;
  }
  return null;
}

async function batchTranslatePDFs(
  pdfs: Zotero.Item[],
  label: string,
  closeBackgroundReaders = true,
  confirmBefore = true,
): Promise<void> {
  if (batchRunning) return;
  const unique = Array.from(new Map(pdfs.map((pdf) => [pdf.id, pdf])).values());
  if (!unique.length) {
    Services.prompt.alert(Zotero.getMainWindow() as any, "Translate for ReadingMode", `${label}${m("noPDF")}`);
    return;
  }
  if (confirmBefore && !Services.prompt.confirm(
    Zotero.getMainWindow() as any,
    "Translate for ReadingMode",
    isChineseLocale()
      ? `将按顺序翻译 ${unique.length} 个 PDF。已完成的译文会直接恢复，是否继续？`
      : `Translate ${unique.length} PDFs in order. Existing completed translations will be restored. Continue?`,
  )) return;
  batchRunning = true;
  // Item-menu translation runs in the background without creating a second
  // XUL progress window. A progress window can retain focus after its timer
  // closes on some Zotero 10 builds, preventing the next library context menu
  // from opening. Folder batches still use it for multi-file progress.
  const progressWindow = closeBackgroundReaders
    ? new Zotero.ProgressWindow({ window: Zotero.getMainWindow(), closeOnClick: false })
    : null;
  progressWindow?.changeHeadline(m("batchHeadline"));
  progressWindow?.show();
  let completed = 0;
  let failed = 0;
  for (const pdf of unique) {
    const title = String(pdf.getField("title") || pdf.key);
    progressWindow?.addLines(`${completed + failed + 1}/${unique.length} ${title}`, "chrome://zotero/skin/treeitem-attachment.png");
    try {
      await openAndTranslatePDF(pdf, closeBackgroundReaders);
      completed++;
    } catch (error) {
      failed++;
      progressWindow?.addDescription(`${title}：${String(error)}`);
    }
  }
  progressWindow?.changeHeadline(isChineseLocale()
    ? `Translate for ReadingMode 批量翻译完成：成功 ${completed}，失败 ${failed}`
    : `Translate for ReadingMode batch translation complete: ${completed} succeeded, ${failed} failed`);
  progressWindow?.startCloseTimer(failed ? 10000 : 4000);
  batchRunning = false;
}

function actionButton(doc: Document, label: string, action: () => void): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = "display:block;width:100%;padding:5px 9px;border:0;background:transparent;text-align:left;cursor:pointer;white-space:nowrap;";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    try { action(); } catch (error) {
      try { Zotero.debug(`[${ADDON_ID}] toolbar action failed: ${String(error)}`); } catch { /* logging unavailable */ }
    }
  });
  return button;
}

function setMenuLabel(context: _ZoteroTypes.MenuManager.LibraryMenuContext, label: string): void {
  try {
    context.menuElem.setAttribute("label", label);
    (context.menuElem as any).label = label;
  } catch { /* menu manager may have detached the element during shutdown */ }
}

function collectionPDFs(collection: Zotero.Collection): Zotero.Item[] {
  const result: Zotero.Item[] = [];
  for (const item of collection.getChildItems()) {
    if (isPDFAttachment(item)) {
      result.push(item);
      continue;
    }
    for (const attachmentID of item.getAttachments?.() || []) {
      const attachment = Zotero.Items.get(attachmentID);
      if (isPDFAttachment(attachment)) result.push(attachment);
    }
  }
  return result;
}

function registerLibraryMenus(): void {
  const manager = (Zotero as any).MenuManager;
  if (!manager?.registerMenu) return;
  const itemMenuID = `${ADDON_ID}-translate-pdf-menu`;
  const itemMenu = manager.registerMenu({
    menuID: itemMenuID,
    pluginID: ADDON_ID,
    target: "main/library/item",
    menus: [{
      menuType: "menuitem",
      icon: MENU_ICON,
      darkIcon: MENU_ICON,
      enableForTabTypes: ["library"],
      onShowing: (_event: Event, context: _ZoteroTypes.MenuManager.LibraryMenuContext) => {
        try {
          const visible = selectedPDFs(context).length > 0;
          // Always set visibility on every popup opening. Zotero reuses the
          // same menu element, so a false value from a previous selection can
          // otherwise remain sticky on the next right-click.
          setContextVisible(context, visible);
          if (visible) setMenuLabel(context, m("translatePDF"));
        } catch (error) {
          setContextVisible(context, false);
          try { Zotero.debug(`[${ADDON_ID}] item menu onShowing failed: ${String(error)}`); } catch { /* logging unavailable */ }
        }
      },
      onCommand: (_event: Event, context: _ZoteroTypes.MenuManager.LibraryMenuContext) => {
        try {
          const pdfs = selectedPDFs(context);
          // Keep the background reader open for item-menu translation. This
          // avoids touching the library tab after the first translation and
          // lets the user inspect or close the translated reader normally.
          deferMenuAction(() => {
            void batchTranslatePDFs(pdfs, ui("选中的条目", "Selected items"), false, false);
          });
        } catch (error) {
          try { Zotero.debug(`[${ADDON_ID}] item menu onCommand failed: ${String(error)}`); } catch { /* logging unavailable */ }
        }
      },
    }],
  });
  if (itemMenu) registeredMenuIDs.push(itemMenu);

  const collectionMenuID = `${ADDON_ID}-translate-collection-menu`;
  const collectionMenu = manager.registerMenu({
    menuID: collectionMenuID,
    pluginID: ADDON_ID,
    target: "main/library/collection",
    menus: [{
      menuType: "menuitem",
      icon: MENU_ICON,
      darkIcon: MENU_ICON,
      enableForTabTypes: ["library"],
      onShowing: (_event: Event, context: _ZoteroTypes.MenuManager.LibraryMenuContext) => {
        try {
          const collection = collectionFromContext(context);
          setContextVisible(context, !!collection);
          if (collection) setMenuLabel(context, m("translateFolder"));
        } catch (error) {
          setContextVisible(context, false);
          try { Zotero.debug(`[${ADDON_ID}] collection menu onShowing failed: ${String(error)}`); } catch { /* logging unavailable */ }
        }
      },
      onCommand: (_event: Event, context: _ZoteroTypes.MenuManager.LibraryMenuContext) => {
        try {
          const collection = collectionFromContext(context);
          if (collection) {
            const pdfs = collectionPDFs(collection);
            deferMenuAction(() => {
              void batchTranslatePDFs(pdfs, isChineseLocale()
                ? `文件夹“${collection.name}”`
                : `Folder “${collection.name}”`);
            });
          }
        } catch (error) {
          try { Zotero.debug(`[${ADDON_ID}] collection menu onCommand failed: ${String(error)}`); } catch { /* logging unavailable */ }
        }
      },
    }],
  });
  if (collectionMenu) registeredMenuIDs.push(collectionMenu);
}

function disposeSession(session: Session): void {
  if (session.disposed) return;
  // Mark it before touching any DOM.  Pending translation requests can then
  // observe the generation change and stop without writing to old nodes.
  session.disposed = true;
  session.generation++;
  session.paused = true;
  sessions.delete(session);
  byReader.delete(session.reader);
  try { session.observer?.disconnect(); } catch { /* old iframe was destroyed */ }
  session.observer = null;
  try {
    if (session.viewDoc) renderTranslations(session.viewDoc, session.blocks, session.record, false);
  } catch { /* old reader document is no longer accessible */ }
  try {
    const win = session.toolbarDoc.defaultView;
    if (win && session.interval) win.clearInterval(session.interval);
    if (win && session.renderTimer !== null) win.clearTimeout(session.renderTimer);
  } catch { /* toolbar document was destroyed */ }
  session.interval = 0;
  session.renderTimer = null;
  try { session.wrapper.remove(); } catch { /* toolbar node was destroyed */ }
}

function attachToolbar(reader: Reader, doc: Document, append: (node: HTMLElement) => void): void {
  const pdf = (reader as any)._item as Zotero.Item | undefined;
  if (!pdf?.isPDFAttachment?.()) return;
  const previous = byReader.get(reader);
  if (previous && previous.toolbarDoc === doc && sessionAlive(previous)) return;
  if (previous) disposeSession(previous);
  const wrapper = doc.createElement("div");
  wrapper.className = "readtrans-toolbar";
  wrapper.style.cssText = "display:none;align-items:center;position:relative;gap:2px;margin-left:5px;font:12px system-ui,sans-serif;";
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = m("toolbarTranslate");
  button.title = m("toolbarTranslateTitle");
  button.style.cssText = "padding:4px 8px;border:1px solid #9eacc0;border-radius:5px;background:#e9eef5;color:#334b67;cursor:pointer;";
  button.setAttribute("aria-pressed", "false");
  const menuButton = doc.createElement("button");
  menuButton.type = "button";
  menuButton.textContent = "▾";
  menuButton.title = m("toolbarActions");
  menuButton.style.cssText = "padding:4px;border:1px solid #9eacc0;border-radius:4px;background:#e9eef5;cursor:pointer;";
  const statusDetails = doc.createElement("details");
  statusDetails.title = m("statusDetails");
  statusDetails.style.cssText = "position:relative;margin-left:2px;";
  const statusSummary = doc.createElement("summary");
  statusSummary.textContent = m("statusSummary");
  statusSummary.style.cssText = "list-style:none;padding:4px 6px;border:1px solid #c2ccd8;border-radius:4px;background:#f4f7fa;color:#536579;cursor:pointer;white-space:nowrap;";
  const status = doc.createElement("div");
  status.style.cssText = "position:absolute;top:calc(100% + 5px);right:0;z-index:10000;width:360px;max-width:min(80vw,360px);max-height:280px;overflow:auto;box-sizing:border-box;padding:10px 12px;background:#fff;color:#334155;border:1px solid #b9c5d2;border-radius:7px;box-shadow:0 5px 18px #0003;white-space:normal;line-height:1.45;";
  status.textContent = m("statusNotStarted");
  statusDetails.append(statusSummary, status);
  const menu = doc.createElement("div");
  menu.style.cssText = "display:none;position:absolute;top:100%;right:0;z-index:9999;min-width:125px;" +
    "padding:4px;background:#fff;border:1px solid #bec9d5;border-radius:6px;box-shadow:0 3px 12px #0003;";
  wrapper.append(button, menuButton, statusDetails, menu);
  append(wrapper);
  const session: Session = {
    reader, pdf, toolbarDoc: doc, viewDoc: null, wrapper, button, menu, status,
    observer: null, interval: 0, record: null, blocks: [], visible: false,
    running: false, paused: false, disposed: false, generation: 0, renderTimer: null, settings: loadSettings(),
  };
  sessions.add(session);
  byReader.set(reader, session);
  button.addEventListener("click", () => {
    if (session.disposed) return;
    if (session.visible) hideRecord(session);
    else void activate(session);
  });
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    try {
      if (session.disposed) return;
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    } catch { /* toolbar was rebuilt */ }
  });
  menu.append(
    actionButton(doc, m("hide"), () => { safeCloseMenu(session); hideRecord(session); }),
    actionButton(doc, m("pauseResume"), () => {
      safeCloseMenu(session);
      if (session.running) {
        session.paused = true;
        setStatus(session, m("pauseAfterBatch"));
      } else if (session.record && !session.record.complete) {
        void activate(session);
      }
    }),
    actionButton(doc, m("saveTranslation"), () => {
      safeCloseMenu(session);
      if (!session.record?.complete) {
        setStatus(session, m("saveAfterComplete"));
      } else {
        void saveAttachment(session.pdf, session.record)
          .then(() => setStatus(session, m("attachmentSaved")))
          .catch((e) => setStatus(session, String(e)));
      }
    }),
    actionButton(doc, m("retry"), () => { safeCloseMenu(session); void activate(session, true); }),
  );
  session.interval = doc.defaultView?.setInterval(() => syncMode(session), 800) ?? 0;
  doc.defaultView?.setTimeout(() => syncMode(session), 100);
}

function onRenderToolbar(event: ToolbarEvent): void {
  attachToolbar(event.reader, event.doc, event.append);
}

function backfillOpenToolbars(): void {
  const readers = ((Zotero.Reader as any)._readers || []) as Reader[];
  for (const reader of readers) {
    try {
      const doc = (reader as any)._iframeWindow?.document as Document | undefined;
      const container = doc?.querySelector(".toolbar > .end > .custom-sections");
      if (!doc || !container) continue;
      const previous = byReader.get(reader);
      if (previous && previous.toolbarDoc === doc && sessionAlive(previous)) continue;
      // Zotero's toolbar event is not replayed for readers restored before add-on startup.
      const section = doc.createElement("div");
      section.className = "section";
      container.append(section);
      attachToolbar(reader, doc, (node) => section.append(node));
      if (!section.hasChildNodes()) section.remove();
    } catch {
      // A reader can close or redraw between lookup and insertion.
    }
  }
}

async function registerPreferencePane(): Promise<void> {
  try {
    await Zotero.PreferencePanes.register({
      pluginID: ADDON_ID,
      id: "readtrans-preferences",
      src: "chrome://readtrans/content/preferences.xhtml",
      scripts: ["chrome://readtrans/content/scripts/preferences.js"],
      label: "Translate for ReadingMode",
      image: "chrome://readtrans/content/icons/icon-48.png",
    });
  } catch (error) {
    try {
      Zotero.debug(`[${ADDON_ID}] preference pane registration failed: ${String(error)}`);
    } catch {
      // Logging may be unavailable while Zotero is starting.
    }
  }
}

export async function startup(): Promise<void> {
  Zotero.Reader.registerEventListener("renderToolbar", onRenderToolbar, ADDON_ID);
  backfillOpenToolbars();
  registerLibraryMenus();
  await registerPreferencePane();
  backfillOpenToolbars();
}

export async function shutdown(): Promise<void> {
  Zotero.Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
  const manager = (Zotero as any).MenuManager;
  for (const menuID of registeredMenuIDs.splice(0)) {
    try { manager?.unregisterMenu?.(menuID); } catch { /* menu may already be gone */ }
  }
  for (const session of Array.from(sessions)) disposeSession(session);
}
