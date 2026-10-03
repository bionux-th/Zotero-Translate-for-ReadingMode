export const ADDON_ID = "zotero-readtrans@github.com";
export const MODEL = "qwen3:14b";
export const TARGET_LANGUAGE = "zh-CN";
export const PROMPT_VERSION = 1;
export const FORMAT_VERSION = 1;

/** Common language choices shown in the ReadTrans preferences. */
export const LANGUAGES = [
  ["auto", "自动检测"],
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁体中文"],
  ["en", "英语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["es", "西班牙语"],
  ["it", "意大利语"],
  ["pt", "葡萄牙语"],
  ["ru", "俄语"],
  ["ar", "阿拉伯语"],
  ["hi", "印地语"],
  ["nl", "荷兰语"],
  ["pl", "波兰语"],
  ["tr", "土耳其语"],
  ["vi", "越南语"],
  ["th", "泰语"],
  ["id", "印尼语"],
] as const;
/**
 * Translation backends exposed by the reader toolbar.  The IDs intentionally
 * describe the transport rather than promising a particular quota or uptime:
 * public web endpoints can change without notice, while the cloud entries use
 * the provider's documented API.
 */
export type TranslationProvider =
  | "ollama"
  | "google"
  | "google-web"
  | "deepl"
  | "deeplx"
  | "bing"
  | "bing-web"
  | "youdao-web"
  | "caiyun"
  | "tencent-web"
  | "mymemory"
  | "libretranslate"
  | "mtranserver"
  | "nllb"
  | "pot"
  | "cnki"
  | "openl"
  | "baidu"
  | "baidu-field"
  | "aliyun"
  | "volcengine"
  | "niutrans"
  | "qwenmt"
  | "gemini"
  | "claude"
  | "youdao-llm"
  | "openai";

export type TranslationSettings = {
  provider: TranslationProvider;
  sourceLanguage: string;
  targetLanguage: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  googleApiKey: string;
  googleEndpoint: string;
  deeplApiKey: string;
  deeplEndpoint: string;
  bingApiKey: string;
  bingRegion: string;
  bingEndpoint: string;
  googleWebEndpoint: string;
  bingWebEndpoint: string;
  youdaoEndpoint: string;
  caiyunToken: string;
  tencentEndpoint: string;
  mymemoryEmail: string;
  libretranslateEndpoint: string;
  libretranslateApiKey: string;
  mtranserverEndpoint: string;
  mtranserverToken: string;
  nllbEndpoint: string;
  potEndpoint: string;
  deeplxEndpoint: string;
  openlServices: string;
  openlApiKey: string;
  baiduAppId: string;
  baiduKey: string;
  baiduField: string;
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
  aliyunEndpoint: string;
  volcengineAccessKey: string;
  volcengineSecretKey: string;
  niutransApiKey: string;
  niutransEndpoint: string;
  qwenmtApiKey: string;
  qwenmtEndpoint: string;
  qwenmtModel: string;
  geminiApiKey: string;
  geminiEndpoint: string;
  geminiModel: string;
  claudeApiKey: string;
  claudeEndpoint: string;
  claudeModel: string;
  youdaoLlmAppId: string;
  youdaoLlmKey: string;
  youdaoLlmEndpoint: string;
  openaiApiKey: string;
  openaiEndpoint: string;
  openaiModel: string;
};

export type SourceBlock = {
  id: string;
  refPath: string;
  hash: string;
  text: string;
  kind: string;
  section: string;
  /** Text sent to the translator with protected inline-format markers. */
  translationInput?: string;
  /** Inline wrappers used to restore superscript, links, bold, etc. */
  formats?: FormatToken[];
  element: HTMLElement;
};

export type FormatToken = {
  id: string;
  tag: "sup" | "sub" | "strong" | "em" | "a" | "span";
  href?: string;
  style?: Partial<Pick<CSSStyleDeclaration,
    "fontWeight" | "fontStyle" | "fontSize">>;
};

export type SavedBlock = Omit<SourceBlock, "element"> & {
  translation?: string;
};

export type TranslationRecord = {
  format: "zotero-readtrans";
  version: number;
  source: {
    libraryID: number;
    key: string;
    hash: string;
  };
  targetLanguage: string;
  /** Language detected at runtime when omitted by older records. */
  sourceLanguage?: string;
  model: string;
  provider?: TranslationProvider;
  promptVersion: number;
  createdAt: string;
  updatedAt: string;
  complete: boolean;
  glossary: Record<string, string>;
  blocks: SavedBlock[];
};

export function hashText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
