[简体中文](README.md) | English

# Translate for ReadingMode

Translate for ReadingMode is a Zotero 10 add-on for translating PDF text in
Zotero's own reading mode with local or online services. Translation starts
only when the user chooses it.

![Bilingual translation in Zotero reading mode](Picture.png)

## Development

```bash
npm install
npm run typecheck
npm run build
```

The build produces `translate-for-readingmode-1.1.0.xpi`. Install that file from Zotero's
**Tools → Add-ons** page and restart Zotero. The source PDF remains untouched.

## Use

1. Open a PDF and turn on Zotero's reading mode.
2. Click **翻译** (or **Translate**) in the reading-mode toolbar.
3. The first run translates the structured reading-mode paragraphs in batches.
   The current batch is cached as it completes and the completed JSON is added
   as a child attachment of the PDF's parent item.
4. Later, click the button again to load the matching attachment. The add-on
   checks the PDF attachment hash and every paragraph identity before showing a
   saved translation.

The menu can hide the translation, pause/resume an incomplete run, save a
completed translation, or start a fresh translation. The default model is
`qwen3:14b` at `http://127.0.0.1:11434` and the default target language is
Simplified Chinese.

Each displayed translation block also has an **Edit Markdown** control.
The editor is a normal multiline text area, so deletion and keyboard editing
work reliably. It accepts common Markdown such as `**bold**`, `*italic*`,
inline code, strikethrough, and `<sup>/<sub>`; the reading view renders
those forms instead of showing the markup literally. Link labels remain plain
text, while link destinations and click behavior are removed from translations.
Save writes the change to
the local checkpoint; once the paper is complete, the add-on verifies and
replaces its JSON attachment. Cancel restores the last saved text. The source
PDF and original reading-mode text are unchanged.

You can also right-click a PDF attachment and choose **翻译此 PDF**.
Right-clicking a collection provides **批量翻译此文件夹中的 PDF**;
it processes the folder's PDFs one at a time, opens each reader in the
background to obtain Zotero's structured reading-mode text, resumes saved
progress, and closes a background reader only when Zotero reports a stable,
non-active tab ID. Item-menu translation leaves its background reader open so
the library tab and its context menu remain unaffected.

## Persistence and safety

Incomplete work is kept in Zotero's data directory under `readtrans/` so a
restart can continue. Completed work is saved as a JSON attachment named
`Translate for ReadingMode <attachment key> <target-language>.json`. The add-on
also reads existing `ReadTrans …json` attachments and replaces them only after
a new attachment has been verified. The plugin ID, settings keys, cache path,
and record format remain unchanged, so earlier translations remain available.
The PDF itself is never rewritten.

Open Zotero's **Settings → Translate for ReadingMode** page to choose the source language,
target language, translation source, endpoint, model, and credentials. The
toolbar only starts or controls translation; it no longer contains provider
configuration. Source and target languages include automatic detection,
Simplified/Traditional Chinese, English, Japanese, Korean, French, German,
Spanish, Italian, Portuguese, Russian, Arabic, Hindi, Dutch, Polish, Turkish,
Vietnamese, Thai, and Indonesian.

The supported sources are:

- **Ollama**: local `qwen3:14b` (default), with editable endpoint and model.
- **Google Cloud**: Google Cloud Translation v2 API Key and endpoint.
- **Google 网页接口**: no key is required, but the public endpoint is an
  unofficial web interface and can be rate limited or changed by Google.
- **DeepL**: API Key; a key ending in `:fx` automatically uses the free API
  endpoint, otherwise the pro endpoint is used. A custom endpoint is allowed.
- **Bing Translator**: Azure Translator API Key, optional Azure region, and
  editable endpoint.
- **Bing 网页接口、有道网页接口、腾讯交互翻译**: public web endpoints that
  normally work without a key, subject to service-side throttling and changes.
- **彩云小译**: token-based API; free trials or quotas depend on the account.
- **DeepLX**: DeepL-compatible public or self-hosted endpoint.
- **MyMemory**: public translation memory API; the anonymous quota is limited
  (an optional email can raise the quota).
- **LibreTranslate、MTranServer、NLLB、Pot**: local or self-hosted services;
  configure the endpoint in the dialog.
- **CNKI**: uses the public CNKI dictionary translation endpoint and refreshes
  its short-lived token automatically. CNKI may require browser human
  verification after repeated requests.
- **OpenL、百度（通用/领域）、阿里云、火山引擎、NiuTrans、通义千问、
  Gemini、Claude、有道大模型、OpenAI 兼容接口**: credential-based services with provider-specific
  free quotas where offered.

The cloud services require their own API credentials and may charge according
to their provider terms. The add-on sends only the current translation batch to
the selected endpoint through Zotero's privileged HTTP client.

The HTTP adapter layer was implemented using the public API
formats documented or exercised by the reference project
[`windingwind/zotero-pdf-translate`](https://github.com/windingwind/zotero-pdf-translate).
That project is AGPL-licensed; this add-on does not bundle its source files.

The reader toolbar keeps only a compact **ⓘ 状态** control. Expand it to
see the latest progress or error message; the message is no longer rendered
inline after the translation button.

The toolbar, settings page, progress messages, and library context-menu
commands follow Zotero's locale: Chinese locales use Chinese text, and other
locales use English text. The two library commands use the bundled SVG icon
without a product-name prefix.

The runtime check in this environment confirmed that Zotero 10.0.3 exposes the
reading-mode `#sdt-content` structure and that the local Ollama `qwen3:14b`
endpoint returns the required JSON response. A full GUI PDF interaction still
requires installing the XPI in a normal Zotero window with a test PDF.
