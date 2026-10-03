import {
  FORMAT_VERSION, MODEL, PROMPT_VERSION, TARGET_LANGUAGE,
  type SourceBlock, type TranslationRecord, type TranslationProvider,
} from "./types";
import { m } from "./i18n";

declare const IOUtils: {
  readUTF8(path: string): Promise<string>;
  writeUTF8(path: string, text: string, options?: { tmpPath?: string }): Promise<void>;
  makeDirectory(path: string, options?: { ignoreExisting?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
};
declare const PathUtils: { join(...parts: string[]): string };

function titleFor(pdf: Zotero.Item, targetLanguage = TARGET_LANGUAGE): string {
  return `Translate for ReadingMode ${pdf.key} ${targetLanguage}.json`;
}

function legacyTitleFor(pdf: Zotero.Item, targetLanguage = TARGET_LANGUAGE): string {
  return `ReadTrans ${pdf.key} ${targetLanguage}.json`;
}

function checkpointPath(pdf: Zotero.Item): string {
  const dataDir = (Zotero as any).DataDirectory?.dir;
  if (!dataDir) throw new Error(m("noDataDirectory"));
  return PathUtils.join(dataDir, "readtrans", `${pdf.libraryID}-${pdf.key}.json`);
}

export async function sourceHash(pdf: Zotero.Item): Promise<string> {
  const hash = await pdf.attachmentHash;
  if (!hash || typeof hash !== "string") throw new Error(m("noSourceHash"));
  return hash;
}

export function newRecord(
  pdf: Zotero.Item,
  hash: string,
  blocks: SourceBlock[],
  provider: TranslationProvider = "ollama",
  model = MODEL,
  targetLanguage = TARGET_LANGUAGE,
  sourceLanguage = "auto",
): TranslationRecord {
  const now = new Date().toISOString();
  return {
    format: "zotero-readtrans",
    version: FORMAT_VERSION,
    source: { libraryID: pdf.libraryID, key: pdf.key, hash },
    targetLanguage,
    sourceLanguage,
    model,
    provider,
    promptVersion: PROMPT_VERSION,
    createdAt: now,
    updatedAt: now,
    complete: false,
    glossary: {},
    blocks: blocks.map(({ element: _element, ...block }) => block),
  };
}

function validRecord(value: unknown): value is TranslationRecord {
  const r = value as TranslationRecord;
  return !!r && r.format === "zotero-readtrans" && r.version === FORMAT_VERSION &&
    !!r.source && typeof r.source.key === "string" &&
    typeof r.source.hash === "string" && Array.isArray(r.blocks) &&
    r.blocks.every((b) => typeof b.id === "string" && typeof b.text === "string" &&
      typeof b.hash === "string" && (!b.translation || typeof b.translation === "string"));
}

function matches(
  record: TranslationRecord, pdf: Zotero.Item, hash: string, blocks: SourceBlock[],
  targetLanguage = TARGET_LANGUAGE,
  sourceLanguage = "auto",
): boolean {
  return record.source.libraryID === pdf.libraryID && record.source.key === pdf.key &&
    record.source.hash === hash && record.targetLanguage === targetLanguage &&
    (record.sourceLanguage || "auto") === sourceLanguage &&
    record.blocks.length === blocks.length &&
    record.blocks.every((saved, index) => saved.id === blocks[index].id &&
      saved.hash === blocks[index].hash);
}

export async function loadCheckpoint(
  pdf: Zotero.Item, hash: string, blocks: SourceBlock[],
  targetLanguage = TARGET_LANGUAGE,
  sourceLanguage = "auto",
): Promise<TranslationRecord | null> {
  try {
    const value = JSON.parse(await IOUtils.readUTF8(checkpointPath(pdf)));
    return validRecord(value) && matches(value, pdf, hash, blocks, targetLanguage, sourceLanguage) ? value : null;
  } catch {
    return null;
  }
}

export async function saveCheckpoint(pdf: Zotero.Item, record: TranslationRecord): Promise<void> {
  const path = checkpointPath(pdf);
  const dir = PathUtils.join((Zotero as any).DataDirectory.dir, "readtrans");
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  record.updatedAt = new Date().toISOString();
  await IOUtils.writeUTF8(path, JSON.stringify(record), { tmpPath: `${path}.tmp` });
}

async function candidateAttachments(pdf: Zotero.Item, targetLanguage = TARGET_LANGUAGE): Promise<Zotero.Item[]> {
  const parentID = pdf.parentItemID;
  const titles = [titleFor(pdf, targetLanguage), legacyTitleFor(pdf, targetLanguage)];
  let ids: number[];
  if (parentID) {
    ids = Zotero.Items.get(parentID)?.getAttachments() || [];
  } else {
    ids = [];
    for (const title of titles) {
      const search = new Zotero.Search();
      (search as any).libraryID = pdf.libraryID;
      search.addCondition("title", "is", title);
      ids.push(...await search.search());
    }
  }
  return ids.map((id) => Zotero.Items.get(id)).filter((item): item is Zotero.Item =>
    !!item && item.isAttachment() && titles.includes(String(item.getField("title"))));
}

async function readAttachment(item: Zotero.Item): Promise<TranslationRecord | null> {
  try {
    const path = await item.getFilePathAsync();
    if (!path) return null;
    const value = JSON.parse(await IOUtils.readUTF8(path));
    return validRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export async function loadSaved(
  pdf: Zotero.Item, hash: string, blocks: SourceBlock[],
  targetLanguage = TARGET_LANGUAGE,
  sourceLanguage = "auto",
): Promise<{ record: TranslationRecord | null; stale: boolean }> {
  let stale = false;
  const candidates = await candidateAttachments(pdf, targetLanguage);
  candidates.sort((a, b) => String(b.dateModified).localeCompare(String(a.dateModified)));
  for (const item of candidates) {
    const record = await readAttachment(item);
    if (!record || record.source.key !== pdf.key ||
        record.source.libraryID !== pdf.libraryID || !record.complete) continue;
    if (matches(record, pdf, hash, blocks, targetLanguage, sourceLanguage)) return { record, stale };
    stale = true;
  }
  return { record: null, stale };
}

export async function saveAttachment(pdf: Zotero.Item, record: TranslationRecord): Promise<void> {
  if (!record.complete || record.blocks.some((b) => !b.translation)) {
    throw new Error(m("attachmentIncomplete"));
  }
  const old = await candidateAttachments(pdf, record.targetLanguage);
  const tempDir = Zotero.getTempDirectory()?.path;
  if (!tempDir) throw new Error(m("noTempDirectory"));
  const path = PathUtils.join(tempDir, `readtrans-${pdf.libraryID}-${pdf.key}-${Date.now()}.json`);
  await IOUtils.writeUTF8(path, JSON.stringify(record, null, 2));
  let added: Zotero.Item | null = null;
  try {
    added = await Zotero.Attachments.importFromFile({
      file: path,
      parentItemID: pdf.parentItemID || undefined,
      libraryID: pdf.libraryID,
      title: titleFor(pdf, record.targetLanguage),
      contentType: "application/json",
    });
    const reread = await readAttachment(added);
    if (!reread || reread.source.hash !== record.source.hash ||
        reread.blocks.length !== record.blocks.length || !reread.complete) {
      throw new Error(m("attachmentVerificationFailed"));
    }
    const replaceIDs: number[] = [];
    for (const item of old) {
      const prior = await readAttachment(item);
      if (prior?.source.key === pdf.key && prior.source.libraryID === pdf.libraryID) {
        replaceIDs.push(item.id);
      }
    }
    if (replaceIDs.length) await Zotero.Items.trashTx(replaceIDs);
  } catch (error) {
    if (added) {
      try { await Zotero.Items.trashTx(added.id); } catch { /* report original failure */ }
    }
    throw error;
  } finally {
    try { await IOUtils.remove(path); } catch { /* temporary file is harmless */ }
  }
}
