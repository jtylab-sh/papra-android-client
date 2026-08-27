/**
 * Offline sync: mirror all document metadata into SQLite and download every
 * blob into the app's private storage. Runs on demand ("Sync now") and as an
 * expo-background-task (WorkManager) at the user-chosen cadence.
 */
import * as BackgroundTask from "expo-background-task";
import { Directory, File, Paths } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Network from "expo-network";
import * as TaskManager from "expo-task-manager";
import { listDocuments, documentFileUrl, type PapraDocument } from "./papra";
import {
  getCachedDocument,
  getMeta,
  pruneDocuments,
  setDocumentFileUri,
  setMeta,
  upsertDocuments,
  clearCache,
} from "./db";
import { getSettings, isConnected, type Settings } from "./settings";

export const SYNC_TASK = "papra-sync";

function docsDir(): Directory {
  const dir = new Directory(Paths.document, "docs");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function safeDelete(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

function extensionFor(doc: { name: string; mimeType: string }): string {
  const fromName = doc.name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "text/plain": "txt",
  };
  return map[doc.mimeType] ?? "bin";
}

/** Fetch every metadata page and mirror it locally. Returns all remote ids. */
export async function syncMetadata(settings?: Settings): Promise<string[]> {
  const s = settings ?? (await getSettings());
  const ids: string[] = [];
  const pageSize = 100;
  for (let pageIndex = 0; ; pageIndex++) {
    const { documents, documentsCount } = await listDocuments({ pageIndex, pageSize }, s);
    upsertDocuments(documents);
    ids.push(...documents.map((d: PapraDocument) => d.id));
    if (documents.length < pageSize || ids.length >= documentsCount) break;
  }
  for (const uri of pruneDocuments(ids)) safeDelete(uri);
  return ids;
}

/** Ensure a document's blob is on disk; returns the local file uri. */
export async function ensureLocalFile(id: string): Promise<string> {
  const cached = getCachedDocument(id);
  if (!cached) throw new Error("Document not in local cache");
  if (cached.fileUri) {
    const f = new File(cached.fileUri);
    if (f.exists) return cached.fileUri;
  }
  const { url, headers } = await documentFileUrl(id);
  const file = new File(docsDir(), `${id}.${extensionFor(cached)}`);
  if (file.exists) file.delete();
  const task = File.createDownloadTask(url, file, { headers });
  await task.downloadAsync();
  setDocumentFileUri(id, file.uri);
  return file.uri;
}

function displayFileName(cached: { name: string; mimeType: string }): string {
  const ext = extensionFor(cached);
  const base = (cached.name || `document.${ext}`)
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
    .slice(0, 120);
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/**
 * Best-effort export of one offline blob into the user-chosen SAF folder
 * (Settings -> "Export copies to folder"). The private mirror stays the
 * source of truth; export failures never fail a sync.
 * ponytail: base64 round-trip through the legacy FS API — the only way to
 * write SAF content:// URIs; fine for scanned documents, slow for huge files.
 */
async function exportCopy(id: string, exportDirUri: string): Promise<void> {
  if (!exportDirUri) return;
  const cached = getCachedDocument(id);
  if (!cached?.fileUri) return;
  const metaKey = `exported:${id}`;
  if (getMeta(metaKey) === exportDirUri) return; // already exported to this folder
  try {
    const data = await FileSystemLegacy.readAsStringAsync(cached.fileUri, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });
    const target = await FileSystemLegacy.StorageAccessFramework.createFileAsync(
      exportDirUri,
      displayFileName(cached),
      cached.mimeType || "application/octet-stream",
    );
    await FileSystemLegacy.writeAsStringAsync(target, data, { encoding: FileSystemLegacy.EncodingType.Base64 });
    setMeta(metaKey, exportDirUri);
  } catch {
    /* folder revoked/full — retried next sync */
  }
}

/**
 * The mirror stores blobs as <id>.<ext> (stable, collision-free). Anything
 * user-visible (share sheet, "open with") gets a cache copy carrying the
 * document's display name so the receiving app sees the real filename.
 */
export async function localFileNamedForUser(id: string): Promise<string> {
  const uri = await ensureLocalFile(id);
  const cached = getCachedDocument(id);
  const ext = extensionFor(cached!);
  const base = (cached!.name || `document.${ext}`)
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
    .slice(0, 120);
  const named = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  const dir = new Directory(Paths.cache, "share");
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, named);
  if (target.exists) target.delete();
  new File(uri).copy(target);
  return target.uri;
}

export interface SyncResult {
  skipped?: "not-configured" | "wifi";
  documents: number;
  downloaded: number;
  failed: number;
}

export async function syncNow(opts: { respectWifiOnly?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<SyncResult> {
  const s = await getSettings();
  if (!isConnected(s)) return { skipped: "not-configured", documents: 0, downloaded: 0, failed: 0 };
  if (opts.respectWifiOnly && s.syncWifiOnly) {
    const state = await Network.getNetworkStateAsync();
    if (state.type !== Network.NetworkStateType.WIFI) {
      return { skipped: "wifi", documents: 0, downloaded: 0, failed: 0 };
    }
  }
  const ids = await syncMetadata(s);
  let downloaded = 0;
  let failed = 0;
  let done = 0;
  for (const id of ids) {
    const cached = getCachedDocument(id);
    const needsFile = !cached?.fileUri || !new File(cached.fileUri).exists;
    if (needsFile) {
      try {
        await ensureLocalFile(id);
        downloaded++;
      } catch {
        failed++;
      }
    }
    await exportCopy(id, s.offlineExportDirUri);
    opts.onProgress?.(++done, ids.length);
  }
  setMeta("lastSyncAt", new Date().toISOString());
  setMeta("lastSyncResult", JSON.stringify({ documents: ids.length, downloaded, failed }));
  return { documents: ids.length, downloaded, failed };
}

// Must be defined at module scope so the background task can run headlessly.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    const s = await getSettings();
    if (!s.syncEnabled) return BackgroundTask.BackgroundTaskResult.Success;
    await syncNow({ respectWifiOnly: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** (Re-)register or unregister the background job to match settings. */
export async function applySyncRegistration(): Promise<void> {
  const s = await getSettings();
  if (s.syncEnabled) {
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: s.syncIntervalMinutes });
  } else {
    await BackgroundTask.unregisterTaskAsync(SYNC_TASK).catch(() => {});
  }
}

/** Server switch / sign-out: drop the mirror and every blob. */
export function wipeLocalData(): void {
  for (const uri of clearCache()) safeDelete(uri);
  try {
    docsDir().delete();
  } catch {
    /* fine */
  }
}
