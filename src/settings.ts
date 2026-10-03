import { LANGUAGES, MODEL, type TranslationProvider, type TranslationSettings } from "./types";

const PREFIX = "extensions.zotero.readtrans.";
const languageCodes = new Set<string>(LANGUAGES.map(([code]) => code));
const defaults: TranslationSettings = {
  provider: "ollama",
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
  ollamaEndpoint: "http://127.0.0.1:11434/api/chat",
  ollamaModel: MODEL,
  googleApiKey: "",
  googleEndpoint: "https://translation.googleapis.com/language/translate/v2",
  deeplApiKey: "",
  deeplEndpoint: "",
  bingApiKey: "",
  bingRegion: "",
  bingEndpoint: "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0",
  googleWebEndpoint: "https://translate.google.com",
  bingWebEndpoint: "https://edge.microsoft.com/translate/translatetext",
  youdaoEndpoint: "https://aidemo.youdao.com/trans",
  caiyunToken: "",
  tencentEndpoint: "https://transmart.qq.com/api/imt",
  mymemoryEmail: "",
  libretranslateEndpoint: "http://127.0.0.1:5000",
  libretranslateApiKey: "",
  mtranserverEndpoint: "http://127.0.0.1:8989/translate",
  mtranserverToken: "",
  nllbEndpoint: "http://127.0.0.1:6060/translate",
  potEndpoint: "http://127.0.0.1:23119/translate",
  deeplxEndpoint: "https://www2.deepl.com/jsonrpc",
  openlServices: "google,microsoft",
  openlApiKey: "",
  baiduAppId: "",
  baiduKey: "",
  baiduField: "",
  aliyunAccessKeyId: "",
  aliyunAccessKeySecret: "",
  aliyunEndpoint: "https://mt.aliyuncs.com/",
  volcengineAccessKey: "",
  volcengineSecretKey: "",
  niutransApiKey: "",
  niutransEndpoint: "https://niutrans.com/niuInterface",
  qwenmtApiKey: "",
  qwenmtEndpoint: "https://dashscope.aliyuncs.com/compatible-mode",
  qwenmtModel: "qwen-mt-plus",
  geminiApiKey: "",
  geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  geminiModel: "gemini-2.0-flash",
  claudeApiKey: "",
  claudeEndpoint: "https://api.anthropic.com/v1/messages",
  claudeModel: "claude-3-5-haiku-latest",
  youdaoLlmAppId: "",
  youdaoLlmKey: "",
  youdaoLlmEndpoint: "https://openapi.youdao.com/llm_trans",
  openaiApiKey: "",
  openaiEndpoint: "https://api.openai.com/v1/chat/completions",
  openaiModel: "gpt-4o-mini",
};

function read(key: string, fallback: string): string {
  try {
    const value = Zotero.Prefs.get(`${PREFIX}${key}`, true);
    return typeof value === "string" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings(): TranslationSettings {
  const provider = read("provider", defaults.provider) as TranslationProvider;
  const sourceLanguage = read("sourceLanguage", defaults.sourceLanguage);
  const targetLanguage = read("targetLanguage", defaults.targetLanguage);
  return {
    provider: [
      "ollama", "google", "google-web", "deepl", "deeplx", "bing", "bing-web",
      "youdao-web", "caiyun", "tencent-web", "mymemory", "libretranslate",
      "mtranserver", "nllb", "pot", "cnki", "openl", "baidu", "baidu-field", "aliyun",
      "volcengine", "niutrans", "qwenmt", "gemini", "claude", "youdao-llm", "openai",
    ].includes(provider) ? provider : "ollama",
    sourceLanguage: languageCodes.has(sourceLanguage) ? sourceLanguage : defaults.sourceLanguage,
    targetLanguage: languageCodes.has(targetLanguage) && targetLanguage !== "auto"
      ? targetLanguage : defaults.targetLanguage,
    ollamaEndpoint: read("ollamaEndpoint", defaults.ollamaEndpoint),
    ollamaModel: read("ollamaModel", defaults.ollamaModel),
    googleApiKey: read("googleApiKey", defaults.googleApiKey),
    googleEndpoint: read("googleEndpoint", defaults.googleEndpoint),
    deeplApiKey: read("deeplApiKey", defaults.deeplApiKey),
    deeplEndpoint: read("deeplEndpoint", defaults.deeplEndpoint),
    bingApiKey: read("bingApiKey", defaults.bingApiKey),
    bingRegion: read("bingRegion", defaults.bingRegion),
    bingEndpoint: read("bingEndpoint", defaults.bingEndpoint),
    googleWebEndpoint: read("googleWebEndpoint", defaults.googleWebEndpoint),
    bingWebEndpoint: read("bingWebEndpoint", defaults.bingWebEndpoint),
    youdaoEndpoint: read("youdaoEndpoint", defaults.youdaoEndpoint),
    caiyunToken: read("caiyunToken", defaults.caiyunToken),
    tencentEndpoint: read("tencentEndpoint", defaults.tencentEndpoint),
    mymemoryEmail: read("mymemoryEmail", defaults.mymemoryEmail),
    libretranslateEndpoint: read("libretranslateEndpoint", defaults.libretranslateEndpoint),
    libretranslateApiKey: read("libretranslateApiKey", defaults.libretranslateApiKey),
    mtranserverEndpoint: read("mtranserverEndpoint", defaults.mtranserverEndpoint),
    mtranserverToken: read("mtranserverToken", defaults.mtranserverToken),
    nllbEndpoint: read("nllbEndpoint", defaults.nllbEndpoint),
    potEndpoint: read("potEndpoint", defaults.potEndpoint),
    deeplxEndpoint: read("deeplxEndpoint", defaults.deeplxEndpoint),
    openlServices: read("openlServices", defaults.openlServices),
    openlApiKey: read("openlApiKey", defaults.openlApiKey),
    baiduAppId: read("baiduAppId", defaults.baiduAppId),
    baiduKey: read("baiduKey", defaults.baiduKey),
    baiduField: read("baiduField", defaults.baiduField),
    aliyunAccessKeyId: read("aliyunAccessKeyId", defaults.aliyunAccessKeyId),
    aliyunAccessKeySecret: read("aliyunAccessKeySecret", defaults.aliyunAccessKeySecret),
    aliyunEndpoint: read("aliyunEndpoint", defaults.aliyunEndpoint),
    volcengineAccessKey: read("volcengineAccessKey", defaults.volcengineAccessKey),
    volcengineSecretKey: read("volcengineSecretKey", defaults.volcengineSecretKey),
    niutransApiKey: read("niutransApiKey", defaults.niutransApiKey),
    niutransEndpoint: read("niutransEndpoint", defaults.niutransEndpoint),
    qwenmtApiKey: read("qwenmtApiKey", defaults.qwenmtApiKey),
    qwenmtEndpoint: read("qwenmtEndpoint", defaults.qwenmtEndpoint),
    qwenmtModel: read("qwenmtModel", defaults.qwenmtModel),
    geminiApiKey: read("geminiApiKey", defaults.geminiApiKey),
    geminiEndpoint: read("geminiEndpoint", defaults.geminiEndpoint),
    geminiModel: read("geminiModel", defaults.geminiModel),
    claudeApiKey: read("claudeApiKey", defaults.claudeApiKey),
    claudeEndpoint: read("claudeEndpoint", defaults.claudeEndpoint),
    claudeModel: read("claudeModel", defaults.claudeModel),
    youdaoLlmAppId: read("youdaoLlmAppId", defaults.youdaoLlmAppId),
    youdaoLlmKey: read("youdaoLlmKey", defaults.youdaoLlmKey),
    youdaoLlmEndpoint: read("youdaoLlmEndpoint", defaults.youdaoLlmEndpoint),
    openaiApiKey: read("openaiApiKey", defaults.openaiApiKey),
    openaiEndpoint: read("openaiEndpoint", defaults.openaiEndpoint),
    openaiModel: read("openaiModel", defaults.openaiModel),
  };
}

export function saveSettings(settings: TranslationSettings): void {
  for (const [key, value] of Object.entries(settings)) {
    Zotero.Prefs.set(`${PREFIX}${key}`, String(value), true);
  }
}
