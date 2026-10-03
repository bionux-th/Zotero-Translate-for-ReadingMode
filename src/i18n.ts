import type { TranslationProvider } from "./types";

/** ReadTrans follows Zotero's UI locale: Chinese locales use Chinese text,
 * while every other locale uses English text. */
export function isChineseLocale(): boolean {
  return String((Zotero as any).locale || "en-US").toLowerCase().startsWith("zh");
}

export function ui(chinese: string, english: string): string {
  return isChineseLocale() ? chinese : english;
}

export const messages = {
  readerModeRequired: ["请先开启 Zotero 阅读模式", "Please enable Zotero reading mode first"],
  readingParsing: ["阅读模式正在解析正文…已等待", "Reading mode is parsing the text… waited"],
  readingGenerating: ["阅读模式正在生成段落…已等待", "Reading mode is generating paragraphs… waited"],
  readingTimeout: ["阅读模式正文解析超时；请确认该 PDF 支持阅读模式，或重新打开阅读模式", "Reading-mode parsing timed out. Check that this PDF supports reading mode, then reopen it"],
  noText: ["阅读模式没有生成可翻译的文字", "Reading mode did not produce translatable text"],
  pauseContinue: ["已暂停", "Paused"],
  continueFromMenu: ["菜单可继续", "Use the menu to continue"],
  translating: ["翻译中", "Translating"],
  incomplete: ["仍有段落未翻译；可从当前进度继续", "Some paragraphs remain untranslated; you can continue from the current progress"],
  sourceUpdated: ["源 PDF 已更新；请重新翻译", "The source PDF changed; please translate again"],
  completedSaved: ["已完成并保存", "Completed and saved"],
  restarting: ["重新翻译", "Translating again"],
  sourceChanged: ["原 PDF 已变化，开始新的翻译", "The source PDF changed; starting a new translation"],
  starting: ["开始翻译", "Starting translation"],
  noReadingMode: ["无法自动进入 Zotero 阅读模式；请先手动打开一次该 PDF 的阅读模式", "Could not enter Zotero reading mode automatically; open reading mode for this PDF once manually"],
  readerTimeout: ["PDF 阅读器初始化超时", "PDF reader initialization timed out"],
  translationIncomplete: ["翻译未完成", "Translation did not finish"],
  hidden: ["译文已隐藏", "Translation hidden"],
  pauseAfterBatch: ["将在当前段落批次完成后暂停", "Will pause after the current batch"],
  saveAfterComplete: ["整篇翻译完成后才能保存附件", "The attachment can be saved after the full translation is complete"],
  attachmentSaved: ["译文已保存到 Zotero 附件", "Translation saved as a Zotero attachment"],
  notConnected: ["无法连接翻译服务；请检查地址、网络或本地服务状态", "Could not connect to the translation service; check the endpoint, network, or local service"],
  noDataDirectory: ["无法定位 Zotero 数据目录", "Could not locate the Zotero data directory"],
  noSourceHash: ["无法读取源 PDF 的内容指纹", "Could not read the source PDF fingerprint"],
  attachmentIncomplete: ["译文尚未完成，无法保存附件", "The translation is incomplete and cannot be saved as an attachment"],
  noTempDirectory: ["无法定位临时目录", "Could not locate the temporary directory"],
  attachmentVerificationFailed: ["新译文附件写入后校验失败", "The new translation attachment failed verification after writing"],
  noPDF: ["中没有 PDF 附件。", " has no PDF attachments."],
  batchConfirm: ["将按顺序翻译", "PDFs will be translated in order"],
  batchConfirmSuffix: [" 个 PDF。已完成的译文会直接恢复，是否继续？", " PDFs. Existing completed translations will be restored. Continue?"],
  batchHeadline: ["Translate for ReadingMode 批量翻译", "Translate for ReadingMode Batch Translation"],
  batchDone: ["Translate for ReadingMode 批量翻译完成：成功", "Translate for ReadingMode batch translation complete: "],
  success: ["成功", " succeeded"],
  failed: ["失败", " failed"],
  translatePDF: ["翻译此 PDF", "Translate this PDF"],
  translateFolder: ["批量翻译此文件夹中的 PDF", "Translate PDFs in this folder"],
  toolbarTranslate: ["翻译", "Translate"],
  toolbarTranslateTitle: ["翻译整篇／显示已保存译文", "Translate the full paper / show the saved translation"],
  toolbarActions: ["Translate for ReadingMode 操作", "Translate for ReadingMode actions"],
  statusDetails: ["展开查看翻译运行情况", "Expand to view translation status"],
  statusSummary: ["ⓘ 状态", "ⓘ Status"],
  statusNotStarted: ["尚未开始翻译", "Translation has not started"],
  hide: ["隐藏译文", "Hide translation"],
  editTranslation: ["编辑 Markdown", "Edit Markdown"],
  saveEdit: ["保存修改", "Save edits"],
  cancelEdit: ["取消", "Cancel"],
  editSaved: ["译文修改已保存", "Translation edit saved"],
  emptyEdit: ["译文不能为空", "The translation cannot be empty"],
  translationUnavailable: ["当前译文记录不可用，请重新显示译文", "The translation record is unavailable; show the translation again"],
  pauseResume: ["暂停／继续", "Pause / resume"],
  saveTranslation: ["保存译文", "Save translation"],
  retry: ["重新翻译", "Translate again"],
  settingsTitle: ["Translate for ReadingMode 设置", "Translate for ReadingMode Settings"],
  settingsIntro: ["翻译只会在阅读模式按钮或条目右键菜单中手动启动。API Key 只保存在 Zotero 本地偏好中。", "Translation starts only when you click the reading-mode button or an item context-menu command. API keys are stored only in Zotero's local preferences."],
  languageSection: ["语言", "Languages"],
  sourceLanguage: ["原文语言", "Source language"],
  targetLanguage: ["目标语言", "Target language"],
  languageHint: ["自动检测适合多语言论文；指定语言可提高部分服务的稳定性。", "Automatic detection suits multilingual papers; selecting a source language can improve stability for some services."],
  providerSection: ["翻译源", "Translation source"],
  provider: ["翻译源", "Translation source"],
  providerHint: ["免 Key 服务放在前面；需要密钥的服务放在后面。", "Key-free services are listed first; services requiring credentials are listed afterward."],
  configSection: ["当前翻译源配置", "Selected source configuration"],
  saveSettings: ["保存设置", "Save settings"],
  settingsSaved: ["设置已保存；下次翻译时生效", "Settings saved; they will apply to the next translation"],
  settingsLoadFailed: ["Translate for ReadingMode 设置页加载失败：", "Translate for ReadingMode settings page failed to load: "],
} as const;

export type MessageKey = keyof typeof messages;
export function m(key: MessageKey): string {
  const [chinese, english] = messages[key];
  return ui(chinese, english);
}

const languageNames: Record<string, [string, string]> = {
  auto: ["自动检测", "Automatic detection"],
  "zh-CN": ["简体中文", "Simplified Chinese"],
  "zh-TW": ["繁体中文", "Traditional Chinese"],
  en: ["英语", "English"], ja: ["日语", "Japanese"], ko: ["韩语", "Korean"],
  fr: ["法语", "French"], de: ["德语", "German"], es: ["西班牙语", "Spanish"],
  it: ["意大利语", "Italian"], pt: ["葡萄牙语", "Portuguese"], ru: ["俄语", "Russian"],
  ar: ["阿拉伯语", "Arabic"], hi: ["印地语", "Hindi"], nl: ["荷兰语", "Dutch"],
  pl: ["波兰语", "Polish"], tr: ["土耳其语", "Turkish"], vi: ["越南语", "Vietnamese"],
  th: ["泰语", "Thai"], id: ["印尼语", "Indonesian"],
};

export function languageLabel(code: string): string {
  const pair = languageNames[code];
  return pair ? ui(pair[0], pair[1]) : code;
}

const providerNames: Record<string, [string, string]> = {
  ollama: ["Ollama 本地模型", "Ollama local model"],
  "google-web": ["Google 网页接口（免 Key）", "Google web endpoint (no key)"],
  "bing-web": ["Bing 网页接口（免 Key）", "Bing web endpoint (no key)"],
  "youdao-web": ["有道网页接口（免 Key）", "Youdao web endpoint (no key)"],
  "tencent-web": ["腾讯交互翻译（网页接口）", "Tencent web endpoint"],
  mymemory: ["MyMemory（免费额度）", "MyMemory (free quota)"],
  deeplx: ["DeepLX（公共/自建）", "DeepLX (public/self-hosted)"],
  libretranslate: ["LibreTranslate（本地/自建）", "LibreTranslate (local/self-hosted)"],
  mtranserver: ["MTranServer（本地）", "MTranServer (local)"],
  nllb: ["NLLB（本地服务）", "NLLB (local service)"],
  pot: ["Pot（本地应用）", "Pot (local app)"],
  cnki: ["CNKI（免 Key，仅支持中文目标）", "CNKI (no key; Chinese target only)"],
  google: ["Google Cloud（需 Key）", "Google Cloud (API key)"],
  deepl: ["DeepL（需 Key）", "DeepL (API key)"],
  bing: ["Bing/Azure（需 Key）", "Bing/Azure (API key)"],
  caiyun: ["彩云小译（Token）", "Caiyun (token)"],
  openl: ["OpenL 聚合（需 Key）", "OpenL aggregator (API key)"],
  baidu: ["百度通用（需 Key）", "Baidu general (API key)"],
  "baidu-field": ["百度领域（需 Key）", "Baidu domain (API key)"],
  aliyun: ["阿里云（需 Key）", "Alibaba Cloud (credentials)"],
  volcengine: ["火山引擎（需 Key）", "Volcengine (credentials)"],
  niutrans: ["NiuTrans（需 Key）", "NiuTrans (API key)"],
  qwenmt: ["通义千问机器翻译（需 Key）", "Qwen machine translation (API key)"],
  gemini: ["Gemini（需 Key）", "Gemini (API key)"],
  claude: ["Claude（需 Key）", "Claude (API key)"],
  "youdao-llm": ["有道大模型翻译（需 Key）", "Youdao LLM translation (API key)"],
  openai: ["OpenAI 兼容接口（需 Key）", "OpenAI-compatible endpoint (API key)"],
};

export function providerLabel(provider: TranslationProvider | string): string {
  const pair = providerNames[provider];
  return pair ? ui(pair[0], pair[1]) : provider;
}
