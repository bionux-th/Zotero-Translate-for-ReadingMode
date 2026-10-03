import { LANGUAGES, type TranslationSettings } from "./types";
import { loadSettings, saveSettings } from "./settings";
import { languageLabel, m, providerLabel } from "./i18n";

const HTML_NS = "http://www.w3.org/1999/xhtml";

const providers: string[] = [
  "ollama", "google-web", "bing-web", "youdao-web", "tencent-web", "mymemory", "deeplx",
  "libretranslate", "mtranserver", "nllb", "pot", "cnki", "google", "deepl", "bing", "caiyun",
  "openl", "baidu", "baidu-field", "aliyun", "volcengine", "niutrans", "qwenmt", "gemini",
  "claude", "youdao-llm", "openai",
];

type Field = [string, string, "text" | "password", string[]];
const fields: Field[] = [
  ["ollamaEndpoint", "Ollama 地址", "text", ["ollama"]],
  ["ollamaModel", "Ollama 模型", "text", ["ollama"]],
  ["googleWebEndpoint", "Google 网页接口地址", "text", ["google-web"]],
  ["bingWebEndpoint", "Bing 网页接口地址", "text", ["bing-web"]],
  ["youdaoEndpoint", "有道网页接口地址", "text", ["youdao-web"]],
  ["tencentEndpoint", "腾讯交互翻译地址", "text", ["tencent-web"]],
  ["mymemoryEmail", "MyMemory 邮箱（可选）", "text", ["mymemory"]],
  ["deeplxEndpoint", "DeepLX 地址", "text", ["deeplx"]],
  ["libretranslateEndpoint", "LibreTranslate 地址", "text", ["libretranslate"]],
  ["libretranslateApiKey", "LibreTranslate API Key（可选）", "password", ["libretranslate"]],
  ["mtranserverEndpoint", "MTranServer 地址", "text", ["mtranserver"]],
  ["mtranserverToken", "MTranServer Token（可选）", "password", ["mtranserver"]],
  ["nllbEndpoint", "NLLB 服务地址", "text", ["nllb"]],
  ["potEndpoint", "Pot 地址", "text", ["pot"]],
  ["googleApiKey", "Google Cloud API Key", "password", ["google"]],
  ["googleEndpoint", "Google Cloud API 地址", "text", ["google"]],
  ["deeplApiKey", "DeepL API Key", "password", ["deepl"]],
  ["deeplEndpoint", "DeepL API 地址（可选）", "text", ["deepl"]],
  ["bingApiKey", "Bing/Azure API Key", "password", ["bing"]],
  ["bingRegion", "Bing 区域（可选）", "text", ["bing"]],
  ["bingEndpoint", "Bing/Azure API 地址", "text", ["bing"]],
  ["caiyunToken", "彩云小译 Token", "password", ["caiyun"]],
  ["openlServices", "OpenL 子服务（逗号分隔）", "text", ["openl"]],
  ["openlApiKey", "OpenL API Key", "password", ["openl"]],
  ["baiduAppId", "百度 AppID", "text", ["baidu", "baidu-field"]],
  ["baiduKey", "百度密钥", "password", ["baidu", "baidu-field"]],
  ["baiduField", "百度领域代码", "text", ["baidu-field"]],
  ["aliyunAccessKeyId", "阿里云 AccessKey ID", "text", ["aliyun"]],
  ["aliyunAccessKeySecret", "阿里云 AccessKey Secret", "password", ["aliyun"]],
  ["aliyunEndpoint", "阿里云地址", "text", ["aliyun"]],
  ["volcengineAccessKey", "火山引擎 AccessKey", "text", ["volcengine"]],
  ["volcengineSecretKey", "火山引擎 SecretKey", "password", ["volcengine"]],
  ["niutransApiKey", "NiuTrans API Key", "password", ["niutrans"]],
  ["niutransEndpoint", "NiuTrans 地址", "text", ["niutrans"]],
  ["qwenmtApiKey", "通义千问 API Key", "password", ["qwenmt"]],
  ["qwenmtEndpoint", "通义千问地址", "text", ["qwenmt"]],
  ["qwenmtModel", "通义千问模型", "text", ["qwenmt"]],
  ["geminiApiKey", "Gemini API Key", "password", ["gemini"]],
  ["geminiEndpoint", "Gemini 地址", "text", ["gemini"]],
  ["geminiModel", "Gemini 模型", "text", ["gemini"]],
  ["claudeApiKey", "Claude API Key", "password", ["claude"]],
  ["claudeEndpoint", "Claude 地址", "text", ["claude"]],
  ["claudeModel", "Claude 模型", "text", ["claude"]],
  ["youdaoLlmAppId", "有道大模型 AppID", "text", ["youdao-llm"]],
  ["youdaoLlmKey", "有道大模型密钥", "password", ["youdao-llm"]],
  ["youdaoLlmEndpoint", "有道大模型地址", "text", ["youdao-llm"]],
  ["openaiApiKey", "OpenAI 兼容 API Key", "password", ["openai"]],
  ["openaiEndpoint", "OpenAI 兼容地址", "text", ["openai"]],
  ["openaiModel", "OpenAI 兼容模型", "text", ["openai"]],
];

const fieldLabels: Record<string, [string, string]> = {
  ollamaEndpoint: ["Ollama 地址", "Ollama endpoint"], ollamaModel: ["Ollama 模型", "Ollama model"],
  googleWebEndpoint: ["Google 网页接口地址", "Google web endpoint"], bingWebEndpoint: ["Bing 网页接口地址", "Bing web endpoint"],
  youdaoEndpoint: ["有道网页接口地址", "Youdao web endpoint"], tencentEndpoint: ["腾讯交互翻译地址", "Tencent endpoint"],
  mymemoryEmail: ["MyMemory 邮箱（可选）", "MyMemory email (optional)"], deeplxEndpoint: ["DeepLX 地址", "DeepLX endpoint"],
  libretranslateEndpoint: ["LibreTranslate 地址", "LibreTranslate endpoint"], libretranslateApiKey: ["LibreTranslate API Key（可选）", "LibreTranslate API key (optional)"],
  mtranserverEndpoint: ["MTranServer 地址", "MTranServer endpoint"], mtranserverToken: ["MTranServer Token（可选）", "MTranServer token (optional)"],
  nllbEndpoint: ["NLLB 服务地址", "NLLB service endpoint"], potEndpoint: ["Pot 地址", "Pot endpoint"],
  googleApiKey: ["Google Cloud API Key", "Google Cloud API key"], googleEndpoint: ["Google Cloud API 地址", "Google Cloud endpoint"],
  deeplApiKey: ["DeepL API Key", "DeepL API key"], deeplEndpoint: ["DeepL API 地址（可选）", "DeepL endpoint (optional)"],
  bingApiKey: ["Bing/Azure API Key", "Bing/Azure API key"], bingRegion: ["Bing 区域（可选）", "Bing region (optional)"], bingEndpoint: ["Bing/Azure API 地址", "Bing/Azure endpoint"],
  caiyunToken: ["彩云小译 Token", "Caiyun token"], openlServices: ["OpenL 子服务（逗号分隔）", "OpenL services (comma-separated)"], openlApiKey: ["OpenL API Key", "OpenL API key"],
  baiduAppId: ["百度 AppID", "Baidu App ID"], baiduKey: ["百度密钥", "Baidu secret key"], baiduField: ["百度领域代码", "Baidu domain code"],
  aliyunAccessKeyId: ["阿里云 AccessKey ID", "Alibaba Cloud access key ID"], aliyunAccessKeySecret: ["阿里云 AccessKey Secret", "Alibaba Cloud access key secret"], aliyunEndpoint: ["阿里云地址", "Alibaba Cloud endpoint"],
  volcengineAccessKey: ["火山引擎 AccessKey", "Volcengine access key"], volcengineSecretKey: ["火山引擎 SecretKey", "Volcengine secret key"],
  niutransApiKey: ["NiuTrans API Key", "NiuTrans API key"], niutransEndpoint: ["NiuTrans 地址", "NiuTrans endpoint"],
  qwenmtApiKey: ["通义千问 API Key", "Qwen API key"], qwenmtEndpoint: ["通义千问地址", "Qwen endpoint"], qwenmtModel: ["通义千问模型", "Qwen model"],
  geminiApiKey: ["Gemini API Key", "Gemini API key"], geminiEndpoint: ["Gemini 地址", "Gemini endpoint"], geminiModel: ["Gemini 模型", "Gemini model"],
  claudeApiKey: ["Claude API Key", "Claude API key"], claudeEndpoint: ["Claude 地址", "Claude endpoint"], claudeModel: ["Claude 模型", "Claude model"],
  youdaoLlmAppId: ["有道大模型 AppID", "Youdao LLM app ID"], youdaoLlmKey: ["有道大模型密钥", "Youdao LLM secret key"], youdaoLlmEndpoint: ["有道大模型地址", "Youdao LLM endpoint"],
  openaiApiKey: ["OpenAI 兼容 API Key", "OpenAI-compatible API key"], openaiEndpoint: ["OpenAI 兼容地址", "OpenAI-compatible endpoint"], openaiModel: ["OpenAI 兼容模型", "OpenAI-compatible model"],
};

function fieldLabel(key: string): string {
  const pair = fieldLabels[key];
  return pair ? (Zotero as any).locale?.toLowerCase?.().startsWith("zh") ? pair[0] : pair[1] : key;
}

function element(doc: Document, name: string): HTMLElement {
  return doc.createElementNS(HTML_NS, name) as unknown as HTMLElement;
}

function text(doc: Document, value: string, tag = "span"): HTMLElement {
  const node = element(doc, tag); node.textContent = value; return node;
}

function option(doc: Document, value: string, label: string): HTMLOptionElement {
  const node = element(doc, "option") as unknown as HTMLOptionElement;
  node.value = value; node.textContent = label; return node;
}

function renderSettings(event: Event): void {
  const host = (event.currentTarget as HTMLElement | null) ||
    (event.target as HTMLElement | null);
  const doc = host?.ownerDocument;
  if (!host || !doc) return;
  // Preference panes are loaded as XUL fragments. Keep the XUL host intact
  // and render the dynamic HTML controls into the namespaced mount element.
  const root = (doc.getElementById("readtrans-settings-root") as HTMLElement | null) || host;
  const settings = loadSettings();
  root.replaceChildren();
  root.setAttribute("style", "display:block;box-sizing:border-box;width:100%;padding:14px;max-width:820px;color:FieldText;font:12px system-ui,sans-serif;");

  const title = text(doc, m("settingsTitle"), "h2");
  title.setAttribute("style", "font-size:17px;margin:0 0 5px;");
  const intro = text(doc, m("settingsIntro"), "p");
  intro.setAttribute("style", "color:GrayText;line-height:1.45;margin:0 0 14px;");
  root.append(title, intro);

  const form = element(doc, "div");
  form.setAttribute("style", "display:grid;gap:12px;");
  const settingsMap = new Map<string, HTMLInputElement | HTMLSelectElement>();

  const section = (heading: string): HTMLElement => {
    const box = element(doc, "section");
    box.setAttribute("style", "display:grid;gap:8px;padding:11px;border:1px solid ThreeDLightShadow;border-radius:7px;background:color-mix(in srgb, Field 92%, transparent);");
    box.append(text(doc, heading, "h3"));
    (box.lastChild as HTMLElement).setAttribute("style", "font-size:13px;margin:0;font-weight:600;");
    form.append(box); return box;
  };
  const row = (parent: HTMLElement, label: string, control: HTMLElement, hint = "") => {
    const wrap = element(doc, "label");
    wrap.setAttribute("style", "display:grid;grid-template-columns:180px minmax(0,1fr);gap:8px;align-items:center;");
    wrap.append(text(doc, label), control);
    if (hint) {
      const note = text(doc, hint, "small");
      note.setAttribute("style", "grid-column:2;color:GrayText;line-height:1.35;");
      wrap.append(note);
    }
    parent.append(wrap);
  };

  const languageSection = section(m("languageSection"));
  const source = element(doc, "select") as unknown as HTMLSelectElement;
  const target = element(doc, "select") as unknown as HTMLSelectElement;
  source.append(...LANGUAGES.map(([value]) => option(doc, value, languageLabel(value))));
  target.append(...LANGUAGES.filter(([value]) => value !== "auto").map(([value]) => option(doc, value, languageLabel(value))));
  source.value = settings.sourceLanguage; target.value = settings.targetLanguage;
  source.setAttribute("style", "padding:5px;"); target.setAttribute("style", "padding:5px;");
  settingsMap.set("sourceLanguage", source); settingsMap.set("targetLanguage", target);
  row(languageSection, m("sourceLanguage"), source, m("languageHint"));
  row(languageSection, m("targetLanguage"), target);

  const providerSection = section(m("providerSection"));
  const provider = element(doc, "select") as unknown as HTMLSelectElement;
  provider.append(...providers.map((value) => option(doc, value, providerLabel(value))));
  provider.value = settings.provider; provider.setAttribute("style", "padding:5px;");
  settingsMap.set("provider", provider);
  row(providerSection, m("provider"), provider, m("providerHint"));

  const configSection = section(m("configSection"));
  const configRows: Array<{ wrap: HTMLElement; keys: string[] }> = [];
  for (const [key, label, type, serviceIDs] of fields) {
    const input = element(doc, "input") as unknown as HTMLInputElement;
    input.type = type; input.value = String((settings as any)[key] || ""); input.setAttribute("style", "padding:5px;min-width:0;");
    settingsMap.set(key, input);
    const wrap = element(doc, "label");
    wrap.setAttribute("style", "display:grid;grid-template-columns:180px minmax(0,1fr);gap:8px;align-items:center;");
    wrap.append(text(doc, fieldLabel(key)), input); configSection.append(wrap);
    configRows.push({ wrap, keys: serviceIDs });
  }
  const updateVisibility = () => {
    for (const item of configRows) item.wrap.style.display = item.keys.includes(provider.value) ? "grid" : "none";
  };
  provider.addEventListener("change", updateVisibility); updateVisibility();

  const footer = element(doc, "div"); footer.setAttribute("style", "display:flex;align-items:center;gap:10px;justify-content:flex-end;");
  const status = text(doc, "", "span"); status.setAttribute("style", "color:GrayText;margin-right:auto;");
  const save = element(doc, "button"); save.textContent = m("saveSettings"); save.setAttribute("style", "padding:6px 14px;font-weight:600;");
  save.addEventListener("click", () => {
    const next: any = { ...settings };
    for (const [key, control] of settingsMap) next[key] = control.value.trim();
    saveSettings(next);
    status.textContent = m("settingsSaved");
  });
  footer.append(status, save); form.append(footer); root.append(form);
}

export function initialize(event: Event): void {
  try {
    renderSettings(event);
  } catch (error) {
    const host = (event.currentTarget as HTMLElement | null) ||
      (event.target as HTMLElement | null);
    const doc = host?.ownerDocument;
    const root = doc?.getElementById("readtrans-settings-root") || host;
    if (!root || !doc) return;
    root.replaceChildren();
    const message = doc.createElementNS(HTML_NS, "p");
    message.textContent = `${m("settingsLoadFailed")}${String(error)}`;
    message.setAttribute("style", "padding:14px;color:#b42318;white-space:pre-wrap;");
    root.append(message);
    try { Zotero.debug(`[ReadTrans] preference pane render failed: ${String(error)}`); } catch { /* logging unavailable */ }
  }
}

// Zotero loads preference-pane scripts into a per-pane sandbox. Imported XUL
// event attributes execute in the preference window scope, so expose the
// small entry point through the shared Zotero namespace instead of relying on
// the sandbox's top-level `ReadTransPreferences` variable.
const preferenceAPI = ((Zotero as any).ReadTransPreferences ||= {}) as {
  initialize: (event: Event) => void;
};
preferenceAPI.initialize = initialize;
