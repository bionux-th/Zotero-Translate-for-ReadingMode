import { MODEL, type SourceBlock, type TranslationSettings } from "./types";
import { ui } from "./i18n";

type ModelReply = {
  translations?: Array<{ id?: string; translation?: string }>;
  terms?: Record<string, string>;
};

export function makeBatches(blocks: SourceBlock[]): SourceBlock[][] {
  const batches: SourceBlock[][] = [];
  let current: SourceBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    const blockLength = (block.translationInput || block.text).length;
    if (current.length && (chars + blockLength > 1800 || current.length >= 4)) {
      batches.push(current); current = []; chars = 0;
    }
    current.push(block); chars += blockLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function translateBatch(
  batch: SourceBlock[], previous: SourceBlock[], following: SourceBlock | undefined,
  glossary: Record<string, string>, settings: TranslationSettings,
): Promise<{ translations: Map<string, string>; terms: Record<string, string> }> {
  if (settings.provider !== "ollama") {
    const texts = await translateExternal(batch, settings);
    if (texts.length !== batch.length || texts.some((value) => !value?.trim())) {
      throw new Error(`${settings.provider} ${ui("返回的段落数量不符或包含空译文", "returned an unexpected number of paragraphs or an empty translation")}`);
    }
    return { translations: new Map(batch.map((block, index) => [block.id, texts[index]])), terms: {} };
  }
  const instructions = [
    `Translate academic text from ${languageName(settings.sourceLanguage, true)} into accurate ${languageName(settings.targetLanguage)}.`,
    "Use the section heading and neighboring paragraphs only as context; translate only TARGETS.",
    "Preserve protein names, abbreviations, numbers, citations, formulas and factual uncertainty.",
    "Keep every [[RT1]] and [[/RT1]] style marker exactly unchanged and in the same order around the corresponding text; never translate, add spaces inside, remove, or invent markers.",
    "Keep terminology consistent with GLOSSARY. Do not add interpretations or omit claims.",
    "Return JSON only: {\"translations\":[{\"id\":\"...\",\"translation\":\"...\"}],\"terms\":{\"English term\":\"中文术语\"}}.",
    "Return exactly one translation for each target ID.",
  ].join(" ");
  const payload = {
    model: settings.ollamaModel || MODEL, stream: false, think: false, format: "json",
    options: { temperature: 0.1, num_ctx: 8192, num_predict: 2400 },
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: JSON.stringify({ sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, section: batch[0]?.section || "", previous: previous.slice(-2).map((b) => b.text), following: following?.text || "", glossary, targets: batch.map((b) => ({ id: b.id, text: b.translationInput || b.text })) }) },
    ],
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await requestJson(settings.ollamaEndpoint || "http://127.0.0.1:11434/api/chat", "POST", payload, undefined, 240_000);
      const reply = parseJson(response?.message?.content);
      return validateReply(reply, batch);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await Zotero.Promise.delay(1000 * (attempt + 1));
    }
  }
  throw new Error(`${ui("Ollama 翻译失败：", "Ollama translation failed: ")}${friendlyError(lastError)}`);
}

const baseLang = (value: string | undefined) => (value || "auto").split("-")[0];
const encoded = (value: string) => encodeURIComponent(value);
const sourceLanguage = (settings: TranslationSettings) => settings.sourceLanguage || "auto";
const targetLanguage = (settings: TranslationSettings) => settings.targetLanguage || "zh-CN";
const googleLanguage = (value: string) => value === "auto" ? "auto" : value;
const bingLanguage = (value: string) => value === "zh-CN" ? "zh-Hans" : value === "zh-TW" ? "zh-Hant" : baseLang(value);
const deepLLanguage = (value: string) => {
  if (value === "auto") return "auto";
  if (value === "zh-CN") return "ZH";
  if (value === "zh-TW") return "ZH-HANT";
  return baseLang(value).toUpperCase();
};
const libreLanguage = (value: string) => value === "auto" ? "auto" : baseLang(value);
const nllbLanguage = (value: string) => ({
  en: "eng_Latn", "zh-CN": "zho_Hans", "zh-TW": "zho_Hant", ja: "jpn_Jpan", ko: "kor_Hang",
  fr: "fra_Latn", de: "deu_Latn", es: "spa_Latn", ru: "rus_Cyrl", ar: "arb_Arab",
}[value] || `${baseLang(value)}_Latn`);
function languageName(code: string | undefined, source = false): string {
  const names: Record<string, string> = { auto: "the detected source language", "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese", en: "English", ja: "Japanese", ko: "Korean", fr: "French", de: "German", es: "Spanish", it: "Italian", pt: "Portuguese", ru: "Russian", ar: "Arabic", hi: "Hindi", nl: "Dutch", pl: "Polish", tr: "Turkish", vi: "Vietnamese", th: "Thai", id: "Indonesian" };
  return names[code || (source ? "auto" : "zh-CN")] || code || (source ? "the detected source language" : "the selected target language");
}

async function translateExternal(batch: SourceBlock[], settings: TranslationSettings): Promise<string[]> {
  const texts = batch.map((block) => block.translationInput || block.text);
  switch (settings.provider) {
    case "google": return googleCloud(texts, settings);
    case "google-web": return mapSequential(texts, (text) => googleWeb(text, settings));
    case "deepl": return deepL(texts, settings);
    case "deeplx": return mapSequential(texts, (text) => deepLX(text, settings));
    case "bing": return bingAzure(texts, settings);
    case "bing-web": return mapSequential(texts, (text) => bingWeb(text, settings));
    case "youdao-web": return mapSequential(texts, (text) => youdao(text, settings));
    case "caiyun": return caiyun(texts, settings);
    case "tencent-web": return mapSequential(texts, (text) => tencent(text, settings));
    case "mymemory": return mapSequential(texts, (text) => myMemory(text, settings));
    case "libretranslate": return libre(texts, settings);
    case "mtranserver": return mapSequential(texts, (text) => mtran(text, settings));
    case "nllb": return mapSequential(texts, (text) => nllb(text, settings));
    case "pot": return mapSequential(texts, (text) => pot(text, settings));
    case "cnki": return mapSequential(texts, (text) => cnki(text, settings));
    case "openl": return mapSequential(texts, (text) => openL(text, settings));
    case "baidu": return mapSequential(texts, (text) => baidu(text, settings, false));
    case "baidu-field": return mapSequential(texts, (text) => baidu(text, settings, true));
    case "aliyun": return mapSequential(texts, (text) => aliyun(text, settings));
    case "volcengine": return mapSequential(texts, (text) => volcengine(text, settings));
    case "niutrans": return mapSequential(texts, (text) => niutrans(text, settings));
    case "qwenmt": {
      const configured = (settings.qwenmtEndpoint || "https://dashscope.aliyuncs.com/compatible-mode").replace(/\/$/, "");
      const endpoint = configured.includes("/chat/completions") ? configured : `${configured}/v1/chat/completions`;
      return mapSequential(texts, (text) => qwenMt(text, endpoint, settings));
    }
    case "gemini": return mapSequential(texts, (text) => gemini(text, settings));
    case "claude": return mapSequential(texts, (text) => claude(text, settings));
    case "youdao-llm": return mapSequential(texts, (text) => youdaoLlm(text, settings));
    case "openai": return mapSequential(texts, (text) => openAICompatible(text, settings.openaiEndpoint, settings.openaiModel, settings.openaiApiKey, settings));
    default: throw new Error(`${ui("未知翻译源：", "Unknown translation source: ")}${settings.provider}`);
  }
}

async function mapSequential<T>(values: string[], fn: (value: string) => Promise<string>): Promise<string[]> {
  const out: string[] = [];
  for (const value of values) out.push(await fn(value));
  return out;
}

async function googleCloud(texts: string[], settings: TranslationSettings): Promise<string[]> {
  requireValue(settings.googleApiKey, "Google Cloud API Key");
  const endpoint = `${settings.googleEndpoint || "https://translation.googleapis.com/language/translate/v2"}?key=${encoded(settings.googleApiKey.trim())}`;
  const body: Record<string, unknown> = { q: texts, target: googleLanguage(targetLanguage(settings)), format: "text" };
  if (sourceLanguage(settings) !== "auto") body.source = googleLanguage(sourceLanguage(settings));
  const response = await requestJson(endpoint, "POST", body);
  const values = response?.data?.translations;
  if (!Array.isArray(values) || values.length !== texts.length) throw new Error("Google Cloud 返回段落数量不匹配");
  return values.map((item: any) => String(item.translatedText || "").trim());
}

function googleToken(text: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push((c >> 6) | 192, (c & 63) | 128);
    else if ((c & 0xfc00) === 0xd800 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      c = 0x10000 + ((c & 0x3ff) << 10) + (text.charCodeAt(++i) & 0x3ff);
      bytes.push((c >> 18) | 240, ((c >> 12) & 63) | 128, ((c >> 6) & 63) | 128, (c & 63) | 128);
    } else bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
  }
  const rotate = (a: number, b: string) => {
    for (let c = 0; c < b.length - 2; c += 3) {
      const d = b.charAt(c + 2); const n = d >= "a" ? d.charCodeAt(0) - 87 : Number(d);
      const shifted = b.charAt(c + 1) === "+" ? a >>> n : a << n;
      a = b.charAt(c) === "+" ? (a + shifted) >>> 0 : a ^ shifted;
    }
    return a;
  };
  let a = 406644;
  for (const byte of bytes) a = rotate((a + byte) >>> 0, "+-a^+6");
  a = rotate(a, "+-3^+b+-f"); a ^= 3293161072; if (a < 0) a = (a & 2147483647) + 2147483648;
  a %= 1_000_000; return `${a}.${a ^ 406644}`;
}

async function googleWeb(text: string, settings: TranslationSettings): Promise<string> {
  const root = (settings.googleWebEndpoint || "https://translate.google.com").replace(/\/$/, "");
  const response = await requestJson(`${root}/translate_a/single?client=gtx&sl=${encoded(googleLanguage(sourceLanguage(settings)))}&tl=${encoded(googleLanguage(targetLanguage(settings)))}&hl=en&dt=t&dt=bd&tk=${googleToken(text)}&q=${encoded(text)}`, "GET");
  const result = Array.isArray(response?.[0]) ? response[0].map((x: any) => x?.[0] || "").join("") : "";
  if (!result) throw new Error("Google 网页翻译没有返回文本");
  return result;
}

async function deepL(texts: string[], settings: TranslationSettings): Promise<string[]> {
  requireValue(settings.deeplApiKey, "DeepL API Key");
  const endpoint = settings.deeplEndpoint || (settings.deeplApiKey.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate");
  const body: Record<string, unknown> = { text: texts, target_lang: deepLLanguage(targetLanguage(settings)) };
  if (sourceLanguage(settings) !== "auto") body.source_lang = deepLLanguage(sourceLanguage(settings));
  const response = await requestJson(endpoint, "POST", body, { Authorization: `DeepL-Auth-Key ${settings.deeplApiKey.trim()}` });
  const values = response?.translations;
  if (!Array.isArray(values) || values.length !== texts.length) throw new Error("DeepL 返回段落数量不匹配");
  return values.map((item: any) => String(item.text || "").trim());
}

async function deepLX(text: string, settings: TranslationSettings): Promise<string> {
  const endpoint = settings.deeplxEndpoint || "https://www2.deepl.com/jsonrpc";
  const id = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  const response = await requestJson(`${endpoint}?client=chrome-extension,1.28.0&method=LMT_handle_jobs`, "POST", { jsonrpc: "2.0", method: "LMT_handle_texts", id, params: { texts: [{ text, requestAlternatives: 0 }], splitting: "newlines", lang: { source_lang_user_selected: deepLLanguage(sourceLanguage(settings)), target_lang: deepLLanguage(targetLanguage(settings)) }, timestamp: Date.now(), commonJobParams: { wasSpoken: false, transcribe_as: "" } } }, { Origin: "chrome-extension://cofdbpoegempjloogbagkncekinflcnj" });
  const result = response?.result?.texts?.[0]?.text;
  if (!result) throw new Error("DeepLX 返回为空；请检查自建端点或服务状态");
  return String(result);
}

async function bingAzure(texts: string[], settings: TranslationSettings): Promise<string[]> {
  requireValue(settings.bingApiKey, "Bing/Azure API Key");
  const base = settings.bingEndpoint || "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0";
  const from = sourceLanguage(settings) === "auto" ? "" : `&from=${encoded(bingLanguage(sourceLanguage(settings)))}`;
  const endpoint = `${base}${base.includes("?") ? "&" : "?"}to=${encoded(bingLanguage(targetLanguage(settings)))}${from}`;
  const headers: Record<string, string> = { "Ocp-Apim-Subscription-Key": settings.bingApiKey.trim() };
  if (settings.bingRegion.trim()) headers["Ocp-Apim-Subscription-Region"] = settings.bingRegion.trim();
  const response = await requestJson(endpoint, "POST", texts.map((Text) => ({ Text })), headers);
  if (!Array.isArray(response) || response.length !== texts.length) throw new Error("Bing/Azure 返回段落数量不匹配");
  return response.map((item: any) => String(item?.translations?.[0]?.text || "").trim());
}

async function bingWeb(text: string, settings: TranslationSettings): Promise<string> {
  const endpoint = settings.bingWebEndpoint || "https://edge.microsoft.com/translate/translatetext";
  const from = sourceLanguage(settings) === "auto" ? "" : bingLanguage(sourceLanguage(settings));
  const to = bingLanguage(targetLanguage(settings));
  const url = `${endpoint}?from=${encoded(from)}&to=${encoded(to)}&isEnterpriseClient=false`;
  const response = await requestJson(url, "POST", [text], { "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" });
  const result = response?.[0]?.translations?.[0]?.text;
  if (!result) throw new Error("Bing 网页翻译没有返回文本");
  return String(result);
}

async function youdao(text: string, settings: TranslationSettings): Promise<string> {
  const params = new URLSearchParams({ from: sourceLanguage(settings), to: targetLanguage(settings) === "zh-CN" ? "zh-CHS" : baseLang(targetLanguage(settings)), q: text });
  const response = await requestJson(settings.youdaoEndpoint || "https://aidemo.youdao.com/trans", "POST", params.toString(), { "Content-Type": "application/x-www-form-urlencoded" });
  const result = Array.isArray(response?.translation) ? response.translation.join("\n") : "";
  if (!result) throw new Error(`有道网页翻译失败（错误码 ${response?.errorCode || "未知"}）`);
  return result;
}

async function caiyun(texts: string[], settings: TranslationSettings): Promise<string[]> {
  requireValue(settings.caiyunToken, "彩云小译 Token");
  const from = sourceLanguage(settings) === "auto" ? "auto" : caiyunLanguage(sourceLanguage(settings));
  const to = caiyunLanguage(targetLanguage(settings));
  const response = await requestJson("https://api.interpreter.caiyunai.com/v1/translator", "POST", { source: texts, trans_type: `${from}2${to}`, request_id: Date.now() / 10000, detect: sourceLanguage(settings) === "auto" }, { "x-authorization": `token ${settings.caiyunToken.trim()}` });
  const values = response?.target;
  if (!Array.isArray(values) || values.length !== texts.length) throw new Error("彩云小译返回段落数量不匹配");
  return values.map((v: any) => String(v).trim());
}

function caiyunLanguage(value: string): string {
  const code = baseLang(value);
  if (code === "zh") return "zh";
  if (["en", "ja", "es"].includes(code)) return code;
  throw new Error(`彩云小译暂不支持目标或原文语言：${value}`);
}

async function tencent(text: string, settings: TranslationSettings): Promise<string> {
  const response = await requestJson(settings.tencentEndpoint || "https://transmart.qq.com/api/imt", "POST", { header: { fn: "auto_translation", client_key: "readtrans-zotero" }, type: "plain", model_category: "normal", source: { lang: baseLang(sourceLanguage(settings)), text_list: [text] }, target: { lang: baseLang(targetLanguage(settings)) } });
  const result = response?.auto_translation?.join("\n");
  if (!result) throw new Error("腾讯交互翻译没有返回文本");
  return String(result).trim();
}

async function myMemory(text: string, settings: TranslationSettings): Promise<string> {
  const email = settings.mymemoryEmail.trim();
  const query = `${"https://api.mymemory.translated.net/get"}?q=${encoded(text)}&langpair=${encoded(sourceLanguage(settings))}|${encoded(targetLanguage(settings))}${email ? `&de=${encoded(email)}` : ""}`;
  const response = await requestJson(query, "GET");
  const result = response?.responseData?.translatedText;
  if (!result) throw new Error(`MyMemory 翻译失败：${response?.responseDetails || "返回为空"}`);
  return String(result).trim();
}

async function libre(texts: string[], settings: TranslationSettings): Promise<string[]> {
  const endpoint = `${(settings.libretranslateEndpoint || "http://127.0.0.1:5000").replace(/\/$/, "")}/translate`;
  return mapSequential(texts, async (text) => {
    const body: Record<string, string> = { q: text, source: libreLanguage(sourceLanguage(settings)), target: libreLanguage(targetLanguage(settings)), format: "text" };
    if (settings.libretranslateApiKey.trim()) body.api_key = settings.libretranslateApiKey.trim();
    const response = await requestJson(endpoint, "POST", body);
    if (response?.error) throw new Error(`LibreTranslate：${response.error}`);
    return requireResult(response?.translatedText, "LibreTranslate");
  });
}

async function mtran(text: string, settings: TranslationSettings): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.mtranserverToken.trim()) headers.Authorization = settings.mtranserverToken.trim();
  const response = await requestJson(settings.mtranserverEndpoint || "http://127.0.0.1:8989/translate", "POST", { text, from: sourceLanguage(settings), to: targetLanguage(settings) }, headers);
  return requireResult(response?.result, "MTranServer");
}

async function nllb(text: string, settings: TranslationSettings): Promise<string> {
  const response = await requestJson(settings.nllbEndpoint || "http://127.0.0.1:6060/translate", "POST", { source: text, src_lang: nllbLanguage(sourceLanguage(settings) === "auto" ? "en" : sourceLanguage(settings)), tgt_lang: nllbLanguage(targetLanguage(settings)) });
  return requireResult(response?.translation?.[0] ?? response?.result, "NLLB");
}

async function pot(text: string, settings: TranslationSettings): Promise<string> {
  const response = await requestText(settings.potEndpoint || "http://127.0.0.1:23119/translate", "POST", text, { "Content-Type": "text/plain;charset=UTF-8" });
  return requireResult(response, "Pot");
}

let cnkiToken = "";
let cnkiTokenExpires = 0;

async function cnki(text: string, settings: TranslationSettings): Promise<string> {
  if (targetLanguage(settings) !== "zh-CN" ||
      (sourceLanguage(settings) !== "auto" && sourceLanguage(settings) !== "en")) {
    throw new Error("CNKI 接口目前只支持英语/自动检测 → 简体中文");
  }
  if (!cnkiToken || Date.now() >= cnkiTokenExpires) {
    const tokenResponse = await requestJson("https://dict.cnki.net/fyzs-front-api/getToken", "GET");
    if (tokenResponse?.code !== 200 || !tokenResponse?.data) throw new Error("CNKI 翻译 Token 获取失败");
    cnkiToken = String(tokenResponse.data);
    cnkiTokenExpires = Date.now() + 4 * 60 * 1000;
  }
  const words = await cnkiEncrypt(text);
  const response = await requestJson("https://dict.cnki.net/fyzs-front-api/translate/literaltranslation", "POST", { words, translateType: null }, { Token: cnkiToken, "Content-Type": "application/json;charset=UTF-8" });
  if (response?.data?.isInputVerificationCode) throw new Error("CNKI 接口要求人工验证，请先在 dict.cnki.net 页面完成验证后再重试");
  const result = String(response?.data?.mResult || "").replace(/\s+$/g, "").trim();
  return requireResult(result, "CNKI 翻译");
}

/** CNKI web client uses AES-ECB semantics implemented as one-block CBC calls. */
async function cnkiEncrypt(text: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode("4e87183cfd3a45fe"), { name: "AES-CBC" }, false, ["encrypt"]);
  const source = new TextEncoder().encode(text);
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < source.length; offset += 16) blocks.push(source.slice(offset, offset + 16));
  if (!blocks.length || blocks[blocks.length - 1].length === 16) { const padding = new Uint8Array(16); padding.fill(16); blocks.push(padding); }
  else {
    const last = blocks[blocks.length - 1]; const padded = new Uint8Array(16); padded.set(last);
    padded.fill(16 - last.length, last.length); blocks[blocks.length - 1] = padded;
  }
  const encrypted: number[] = [];
  for (const block of blocks) {
    const cipher = await globalThis.crypto.subtle.encrypt({ name: "AES-CBC", iv: block as unknown as BufferSource }, key, new Uint8Array(16) as unknown as BufferSource);
    encrypted.push(...new Uint8Array(cipher).slice(0, 16));
  }
  return btoa(String.fromCharCode(...encrypted)).replace(/\//g, "_").replace(/\+/g, "-");
}

async function openL(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.openlApiKey, "OpenL API Key");
  const services = (settings.openlServices || "google").split(",").map((v) => v.trim()).filter(Boolean);
  const response = await requestJson("https://api.openl.club/group/translate", "POST", { apikey: settings.openlApiKey.trim(), services, text, source_lang: sourceLanguage(settings), target_lang: targetLanguage(settings) });
  if (!response?.status) throw new Error(`OpenL：${JSON.stringify(response)}`);
  for (const name of Object.keys(response)) if (response[name]?.status && response[name]?.result) return String(response[name].result);
  throw new Error("OpenL 所有子服务均失败");
}

async function baidu(text: string, settings: TranslationSettings, field: boolean): Promise<string> {
  requireValue(settings.baiduAppId, "百度翻译 AppID"); requireValue(settings.baiduKey, "百度翻译密钥");
  const salt = Date.now().toString();
  const action = field ? `&domain=${encoded(settings.baiduField || "default")}` : "";
  const signText = field ? settings.baiduAppId + text + salt + (settings.baiduField || "default") + settings.baiduKey : settings.baiduAppId + text + salt + settings.baiduKey;
  const sign = Zotero.Utilities.Internal.md5(signText, false);
  const path = field ? "fieldtranslate" : "translate";
  const response = await requestJson(`https://api.fanyi.baidu.com/api/trans/vip/${path}?q=${encoded(text)}&appid=${encoded(settings.baiduAppId)}&from=${encoded(baseLang(sourceLanguage(settings)))}&to=${encoded(baseLang(targetLanguage(settings)))}&salt=${salt}&sign=${sign}${action}`, "GET");
  if (response?.error_code) throw new Error(`百度翻译：${response.error_code} ${response.error_msg || ""}`);
  const result = response?.trans_result?.map((item: any) => item.dst).join("");
  return requireResult(result, "百度翻译");
}

async function aliyun(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.aliyunAccessKeyId, "阿里云 AccessKey ID"); requireValue(settings.aliyunAccessKeySecret, "阿里云 AccessKey Secret");
  const endpoint = settings.aliyunEndpoint || "https://mt.aliyuncs.com/";
  const params: Record<string, string> = { AccessKeyId: settings.aliyunAccessKeyId.trim(), Action: "TranslateGeneral", Format: "JSON", FormatType: "text", Scene: "general", SignatureMethod: "HMAC-SHA1", SignatureNonce: randomString(16), SignatureVersion: "1.0", SourceLanguage: baseLang(sourceLanguage(settings)), SourceText: text, TargetLanguage: baseLang(targetLanguage(settings)), Timestamp: new Date().toISOString(), Version: "2018-10-12" };
  const canonical = Object.keys(params).sort().map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`).join("&");
  const signature = await hmacBase64(`POST&%2F&${rfc3986(canonical)}`, `${settings.aliyunAccessKeySecret.trim()}&`);
  const body = `${canonical}&Signature=${rfc3986(signature)}`;
  const response = await requestJson(endpoint, "POST", body, { "Content-Type": "application/x-www-form-urlencoded" });
  if (response?.Code !== "200") throw new Error(`阿里云机器翻译：${response?.Code || "未知"} ${response?.Message || ""}`);
  return requireResult(response?.Data?.Translated, "阿里云机器翻译");
}

async function volcengine(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.volcengineAccessKey, "火山引擎 AccessKey"); requireValue(settings.volcengineSecretKey, "火山引擎 SecretKey");
  const host = "translate.volcengineapi.com"; const path = "/"; const query = "Action=TranslateText&Version=2020-06-01"; const now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const body = JSON.stringify({ SourceLanguage: baseLang(sourceLanguage(settings)), TargetLanguage: baseLang(targetLanguage(settings)), TextList: [text] });
  const contentHash = await sha256Hex(body);
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Date": date, "X-Content-Sha256": contentHash };
  const signedHeaders = "content-type;x-content-sha256;x-date";
  const canonicalHeaders = `content-type:application/json\nx-content-sha256:${contentHash}\nx-date:${date}\n`;
  const canonicalRequest = `POST\n${path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${contentHash}`;
  const scope = `${date}/cn-north-1/translate/request`; const credential = await hmacChain(settings.volcengineSecretKey.trim(), [date, "cn-north-1", "translate", "request"]);
  const signing = `HMAC-SHA256\n${date}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const signature = await hmacHex(signing, credential);
  headers.Authorization = `HMAC-SHA256 Credential=${settings.volcengineAccessKey.trim()}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await requestJson(`https://${host}/?${query}`, "POST", body, headers);
  return requireResult(response?.TranslationList?.[0]?.Translation, "火山引擎翻译");
}

async function niutrans(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.niutransApiKey, "NiuTrans API Key");
  const root = (settings.niutransEndpoint || "https://niutrans.com/niuInterface").replace(/\/$/, "");
  const response = await requestJson(`${root}/textTranslation?pluginType=readtrans&apikey=${encoded(settings.niutransApiKey)}`, "POST", { from: sourceLanguage(settings), to: targetLanguage(settings), source: "zotero", src_text: text });
  if (response?.code && response.code !== 200) throw new Error(`NiuTrans：${response.msg || response.code}`);
  return requireResult(response?.data?.tgt_text, "NiuTrans");
}

async function qwenMt(text: string, endpoint: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.qwenmtApiKey, "通义千问机器翻译 API Key");
  const response = await requestJson(endpoint, "POST", {
    model: settings.qwenmtModel || "qwen-mt-plus",
    messages: [{ role: "user", content: text }],
    translation_options: { source_lang: languageName(sourceLanguage(settings), true), target_lang: languageName(targetLanguage(settings)) },
  }, { Authorization: `Bearer ${settings.qwenmtApiKey.trim()}` });
  return requireResult(response?.choices?.[0]?.message?.content, "通义千问机器翻译");
}

function translationPrompt(text: string, settings?: TranslationSettings): string { return `Translate the following academic text from ${languageName(settings?.sourceLanguage, true)} to ${languageName(settings?.targetLanguage)}. Preserve formulas, citations and names. Return only the translation.\n\n${text}`; }
async function openAICompatible(text: string, endpoint: string, model: string, key: string, settings: TranslationSettings): Promise<string> {
  requireValue(key, "OpenAI API Key");
  const response = await requestJson(endpoint || "https://api.openai.com/v1/chat/completions", "POST", { model: model || "gpt-4o-mini", messages: [{ role: "user", content: translationPrompt(text, settings) }], temperature: 0.1 }, { Authorization: `Bearer ${key.trim()}` });
  return requireResult(response?.choices?.[0]?.message?.content, "OpenAI 兼容接口");
}

async function gemini(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.geminiApiKey, "Gemini API Key");
  const root = (settings.geminiEndpoint || "https://generativelanguage.googleapis.com/v1beta/models").replace(/\/$/, "");
  const response = await requestJson(`${root}/${settings.geminiModel || "gemini-2.0-flash"}:generateContent?key=${encoded(settings.geminiApiKey)}`, "POST", { contents: [{ role: "user", parts: [{ text: translationPrompt(text, settings) }] }] });
  return requireResult(response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join(""), "Gemini");
}

async function claude(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.claudeApiKey, "Claude API Key");
  const response = await requestJson(settings.claudeEndpoint || "https://api.anthropic.com/v1/messages", "POST", {
    model: settings.claudeModel || "claude-3-5-haiku-latest", max_tokens: 2400,
    system: `Translate academic text from ${languageName(sourceLanguage(settings), true)} to ${languageName(targetLanguage(settings))}. Preserve formulas, citations, names and uncertainty. Return only the translation.`,
    messages: [{ role: "user", content: text }],
  }, { "x-api-key": settings.claudeApiKey.trim(), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
  return requireResult(response?.content?.map((part: any) => part.text || "").join(""), "Claude");
}

async function youdaoLlm(text: string, settings: TranslationSettings): Promise<string> {
  requireValue(settings.youdaoLlmAppId, "有道大模型翻译 AppID"); requireValue(settings.youdaoLlmKey, "有道大模型翻译密钥");
  const salt = Date.now().toString(); const curtime = Math.round(Date.now() / 1000).toString();
  const truncated = text.length <= 20 ? text : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
  const sign = await sha256Hex(settings.youdaoLlmAppId + truncated + salt + curtime + settings.youdaoLlmKey);
  const query = `i=${encoded(text)}&appKey=${encoded(settings.youdaoLlmAppId)}&salt=${salt}&from=${encoded(sourceLanguage(settings))}&to=${encoded(targetLanguage(settings) === "zh-CN" ? "zh-CHS" : baseLang(targetLanguage(settings)))}&sign=${sign}&signType=v3&curtime=${curtime}&handleOption=0&prompt=&streamType=full`;
  const raw = await requestText(`${settings.youdaoLlmEndpoint || "https://openapi.youdao.com/llm_trans"}?${query}`, "POST", "", { "Content-Type": "application/x-www-form-urlencoded" });
  const matches = [...raw.matchAll(/"transFull"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
  if (!matches.length) throw new Error(`有道大模型翻译返回异常：${raw.slice(0, 200)}`);
  try { return JSON.parse(`"${matches[matches.length - 1][1]}"`); } catch { return matches[matches.length - 1][1]; }
}

const credentialLabels: Record<string, string> = {
  "彩云小译 Token": "Caiyun token", "Google Cloud API Key": "Google Cloud API key",
  "DeepL API Key": "DeepL API key", "Bing/Azure API Key": "Bing/Azure API key",
  "LibreTranslate API Key（可选）": "LibreTranslate API key (optional)", "MyMemory 邮箱（可选）": "MyMemory email (optional)",
  "OpenL API Key": "OpenL API key", "百度翻译 AppID": "Baidu App ID", "百度翻译密钥": "Baidu secret key",
  "阿里云 AccessKey ID": "Alibaba Cloud access key ID", "阿里云 AccessKey Secret": "Alibaba Cloud access key secret",
  "火山引擎 AccessKey": "Volcengine access key", "火山引擎 SecretKey": "Volcengine secret key",
  "NiuTrans API Key": "NiuTrans API key", "通义千问机器翻译 API Key": "Qwen machine translation API key",
  "Gemini API Key": "Gemini API key", "Claude API Key": "Claude API key",
  "有道大模型翻译 AppID": "Youdao LLM app ID", "有道大模型翻译密钥": "Youdao LLM secret key",
  "OpenAI API Key": "OpenAI API key",
};
function requireValue(value: string, label: string): void {
  if (!value.trim()) throw new Error(ui(`请先在设置中填写${label}`, `Enter ${credentialLabels[label] || label} in Translate for ReadingMode settings first`));
}
function requireResult(value: unknown, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(ui(`${label}返回为空`, `${label} returned no translation`));
  return result;
}
function friendlyError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function parseJson(value: unknown): any { if (typeof value === "string") { try { return JSON.parse(value); } catch { throw new Error(ui("服务返回的不是有效 JSON", "The service returned invalid JSON")); } } return value; }

async function requestJson(url: string, method: string, body?: unknown, headers?: Record<string, string>, timeout = 60_000): Promise<any> {
  const payload = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders: Record<string, string> = typeof body === "object" && body !== null
    ? { "Content-Type": "application/json", ...headers } : { ...headers };
  let response;
  try {
    response = await Zotero.HTTP.request(method, url, { body: payload, headers: requestHeaders, responseType: "text", timeout });
  } catch (error) {
    // Zotero's HTTP exception can include a complete URL containing a key.
    // Surface only a safe status message in the reader toolbar.
    const status = (error as any)?.status;
    if (status === 429) throw new Error(ui("服务限流（HTTP 429），稍后可继续翻译", "The service rate-limited the request (HTTP 429); try again later"));
    if (status === 401 || status === 403) throw new Error(ui(`认证或额度错误（HTTP ${status}），请检查密钥和账户`, `Authentication or quota error (HTTP ${status}); check the key and account`));
    if (status) throw new Error(ui(`翻译服务请求失败（HTTP ${status}）`, `Translation service request failed (HTTP ${status})`));
    throw new Error(ui("无法连接翻译服务；请检查地址、网络或本地服务状态", "Could not connect to the translation service; check the endpoint, network, or local service"));
  }
  return parseJson(response.responseText ?? response.response);
}
async function requestText(url: string, method: string, body: string, headers?: Record<string, string>): Promise<string> {
  let response;
  try { response = await Zotero.HTTP.request(method, url, { body, headers: headers || {}, responseType: "text", timeout: 60_000 }); }
  catch (error) { const status = (error as any)?.status; throw new Error(status ? ui(`翻译服务请求失败（HTTP ${status}）`, `Translation service request failed (HTTP ${status})`) : ui("无法连接翻译服务", "Could not connect to the translation service")); }
  return String(response.responseText ?? response.response ?? "");
}
function rfc3986(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }
function randomString(length: number): string { const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let out = ""; for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }
async function bytes(value: string): Promise<ArrayBuffer> { return new TextEncoder().encode(value).buffer; }
async function hmacRaw(value: string, key: string | ArrayBuffer, algorithm: "HMAC-SHA-1" | "HMAC-SHA-256"): Promise<ArrayBuffer> { const cryptoKey = await globalThis.crypto.subtle.importKey("raw", typeof key === "string" ? await bytes(key) : key, { name: "HMAC", hash: algorithm }, false, ["sign"]); return globalThis.crypto.subtle.sign("HMAC", cryptoKey, await bytes(value)); }
async function hmacBase64(value: string, key: string): Promise<string> { return btoa(String.fromCharCode(...new Uint8Array(await hmacRaw(value, key, "HMAC-SHA-1")))); }
async function hmacHex(value: string, key: string | ArrayBuffer): Promise<string> { return Array.from(new Uint8Array(await hmacRaw(value, key, "HMAC-SHA-256"))).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function hmacChain(key: string, values: string[]): Promise<ArrayBuffer> { let current: string | ArrayBuffer = key; for (const value of values) current = await hmacRaw(value, current, "HMAC-SHA-256"); return current as ArrayBuffer; }
async function sha256Hex(value: string): Promise<string> { const digest = await globalThis.crypto.subtle.digest("SHA-256", await bytes(value)); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }

function validateReply(reply: ModelReply, batch: SourceBlock[]) {
  if (!Array.isArray(reply.translations) || reply.translations.length !== batch.length) throw new Error(ui("模型返回的段落数量不匹配", "The model returned an unexpected number of paragraphs"));
  const translations = new Map<string, string>();
  for (const item of reply.translations) {
    if (!item.id || !batch.some((b) => b.id === item.id) || typeof item.translation !== "string" || !item.translation.trim() || translations.has(item.id)) throw new Error(ui("模型返回了缺失、重复或无效的段落", "The model returned a missing, duplicate, or invalid paragraph"));
    translations.set(item.id, item.translation.trim());
  }
  const terms: Record<string, string> = {};
  if (reply.terms && typeof reply.terms === "object") for (const [source, target] of Object.entries(reply.terms).slice(0, 20)) if (source.length <= 80 && typeof target === "string" && target.length <= 80) terms[source] = target;
  return { translations, terms };
}
