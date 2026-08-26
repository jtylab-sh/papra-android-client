/**
 * Offline sync: mirror all document metadata into SQLite and download every
 * blob into the app's private storage. Runs on demand ("Sync now") and as an
 * expo-background-task (WorkManager) at the user-chosen cadence.
 */
import * as BackgroundTask from "expo-background-task";
import { Directory, File, Paths } from "expo-file-system";
import * as Network from "expo-network";
import * as TaskManager from "expo-task-manager";
import { listDocuments, documentFileUrl, type PapraDocument } from "./papra";
import {
  getCachedDocument,
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
