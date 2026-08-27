/**
 * Offline sync: mirror all document metadata into SQLite and download every
 * blob into the app's private storage. Runs on demand ("Sync now") and as an
 * expo-background-task (WorkManager) at the user-chosen cadence.
 */
import * as BackgroundTask from "expo-background-task";
import { Directory, File, Paths } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import {
  ApiError,
  listDeletedDocuments,
  listDocuments,
  documentFileUrl,
  notifyIfOffline,
  type PapraDocument,
} from "~/lib/papra";
import {
  getCachedDocument,
  getMeta,
  listCachedDocuments,
  setActiveOrg,
  pruneDocuments,
  setDocumentFileUri,
  setMeta,
  upsertDocuments,
  clearCache,
  clearFileUris,
} from "~/lib/db";
import { authStorageKeys, getAuthClient } from "~/lib/auth";
import { getSettings, isConnected, saveSettings, type Settings } from "~/lib/settings";
import { updateRecentDocumentsWidget } from "~/widgets/widgets";
import { flushUploads } from "~/lib/uploads";
import {
  clearSyncNotification,
  notifyNewDocuments,
  notifySessionExpired,
  notifySyncFailures,
  notifyTrashPurge,
  startSyncService,
  stopSyncService,
  updateSyncProgress,
} from "~/lib/notifications";

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
  updateRecentDocumentsWidget().catch(() => {});
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
  try {
    await task.downloadAsync();
  } catch (e) {
    // Downloads bypass papraRequest; give the same offline toast here.
    await notifyIfOffline();
    throw e;
  }
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
/**
 * Keep the export folder out of the phone's gallery: a `.nomedia` file makes
 * Android's media scanner skip the directory. Written once per folder.
 */
export async function ensureNoMedia(exportDirUri: string): Promise<void> {
  if (!exportDirUri) return;
  const key = `nomedia:${exportDirUri}`;
  if (getMeta(key)) return;
  try {
    await FileSystemLegacy.StorageAccessFramework.createFileAsync(
      exportDirUri,
      ".nomedia",
      "application/octet-stream",
    );
  } catch {
    /* exists already */
  }
  setMeta(key, "1");
}

/** Names currently present in the export folder, or null when unreadable. */
async function listExportNames(exportDirUri: string): Promise<Set<string> | null> {
  try {
    const entries = await FileSystemLegacy.StorageAccessFramework.readDirectoryAsync(exportDirUri);
    return new Set(entries.map((uri) => decodeURIComponent(uri.split("%2F").pop() ?? "")));
  } catch {
    return null; // folder revoked/offline — don't force re-exports on bad info
  }
}

async function exportCopy(id: string, exportDirUri: string, existingNames: Set<string> | null): Promise<void> {
  if (!exportDirUri) return;
  const cached = getCachedDocument(id);
  if (!cached?.fileUri) return;
  const metaKey = `exported:${id}`;
  // Skip only when the exported copy is verifiably still there — a manually
  // deleted file gets re-exported on the next sync.
  if (getMeta(metaKey) === exportDirUri && (!existingNames || existingNames.has(displayFileName(cached)))) return;
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
  const named = displayFileName(getCachedDocument(id)!);
  const dir = new Directory(Paths.cache, "share");
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, named);
  if (target.exists) target.delete();
  new File(uri).copy(target);
  return target.uri;
}

/** Set by the Settings "Pause" button; checked between and inside downloads. */
let pauseRequested = false;

export function requestSyncPause(): void {
  pauseRequested = true;
}

/** Thrown to unwind the download loop on user pause or background offline. */
class SyncInterrupted extends Error {}

async function isOffline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return state?.isConnected === false;
}

/** Block until connectivity returns (or the user pauses). Foreground only. */
async function waitForNetwork(): Promise<void> {
  while (!pauseRequested && (await isOffline())) {
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/**
 * Download with resilience. Offline mid-sync is a pause, not a failure:
 * foreground runs wait for connectivity and retry the same document;
 * background runs interrupt (WorkManager tries again later). Genuine online
 * failures get one retry after a second.
 */
async function downloadWithRetry(id: string, background: boolean): Promise<void> {
  let failures = 0;
  for (;;) {
    if (pauseRequested) throw new SyncInterrupted("paused");
    try {
      await ensureLocalFile(id);
      return;
    } catch (e) {
      if (await isOffline()) {
        if (background) throw new SyncInterrupted("offline");
        await waitForNetwork();
        continue;
      }
      if (++failures >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Drop one document's private offline copy. The next full sync downloads it again. */
export function removeLocalCopy(id: string): void {
  const cached = getCachedDocument(id);
  if (cached?.fileUri) safeDelete(cached.fileUri);
  setDocumentFileUri(id, null);
}

/**
 * Disk is the only source of truth for "offline": count the blob files that
 * are actually on the device and belong to a document known from Papra, and
 * heal the db pointers both ways while at it (file deleted: pointer dropped;
 * file present: pointer restored). Cheap: one directory listing + one pass.
 */
export function countOfflineOnDisk(): number {
  const onDisk = new Map<string, string>(); // document id -> file uri
  try {
    const dir = new Directory(Paths.document, "docs");
    if (dir.exists) {
      for (const entry of dir.list()) {
        if (entry instanceof File) {
          const id = entry.name.split(".")[0];
          if (id) onDisk.set(id, entry.uri);
        }
      }
    }
  } catch {
    /* unreadable dir = nothing offline */
  }
  let count = 0;
  for (const doc of listCachedDocuments()) {
    const uri = onDisk.get(doc.id);
    if (uri) {
      count++;
      if (doc.fileUri !== uri) setDocumentFileUri(doc.id, uri);
    } else if (doc.fileUri) {
      setDocumentFileUri(doc.id, null);
    }
  }
  return count;
}

export interface SyncResult {
  skipped?: "not-configured" | "wifi";
  documents: number;
  downloaded: number;
  failed: number;
  /** user paused, or a background run lost connectivity; the next run continues */
  paused?: boolean;
  /** message of the last failed download — the only clue when many fail */
  lastError?: string;
}

export async function syncNow(
  opts: {
    respectWifiOnly?: boolean;
    onProgress?: (done: number, total: number) => void;
    /** background runs may notify; foreground runs never do (user sees the UI) */
    background?: boolean;
  } = {},
): Promise<SyncResult> {
  const s = await getSettings();
  pauseRequested = false;
  if (!isConnected(s)) return { skipped: "not-configured", documents: 0, downloaded: 0, failed: 0 };
  if (opts.respectWifiOnly && s.syncWifiOnly) {
    const state = await Network.getNetworkStateAsync();
    if (state.type !== Network.NetworkStateType.WIFI) {
      return { skipped: "wifi", documents: 0, downloaded: 0, failed: 0 };
    }
  }
  const knownIds = opts.background ? new Set(listCachedDocuments().map((d) => d.id)) : null;
  const ids = await syncMetadata(s);
  countOfflineOnDisk(); // reconcile pointers with the files actually on disk
  if (opts.background && knownIds && knownIds.size > 0) {
    const fresh = ids.filter((docId) => !knownIds.has(docId));
    if (fresh.length > 0) {
      const first = getCachedDocument(fresh[0])?.name ?? "";
      notifyNewDocuments(fresh.length, first).catch(() => {});
    }
  }
  if (opts.background) await checkTrashPurge(s.trashRetentionDays).catch(() => {});
  let downloaded = 0;
  let failed = 0;
  let done = 0;
  let lastError = "";
  let paused = false;
  // Foreground service + progress notification: keeps a manual sync running
  // when the user leaves the app. Never from background tasks — Android 12+
  // forbids starting a foreground service from the background.
  const exportNames = s.offlineExportDirUri ? await listExportNames(s.offlineExportDirUri) : null;
  if (s.offlineExportDirUri) await ensureNoMedia(s.offlineExportDirUri).catch(() => {});
  const useService = !opts.background && s.notifySyncProgress;
  const plainProgress = Boolean(opts.background) && s.notifySyncProgress;
  if (useService) await startSyncService().catch(() => {});
  const processed = new Set<string>();
  let queue = ids;
  let total = ids.length;
  try {
    // Rounds: when the queue drains, refresh metadata once more so documents
    // added while the sync ran are picked up in the same run (capped so a
    // constant stream of uploads can't keep the loop alive forever).
    for (let round = 0; round < 3 && queue.length > 0 && !paused; round++) {
      for (const id of queue) {
        if (pauseRequested) {
          paused = true;
          break;
        }
        processed.add(id);
        const cached = getCachedDocument(id);
        const needsFile = !cached?.fileUri || !new File(cached.fileUri).exists;
        if (needsFile) {
          try {
            await downloadWithRetry(id, Boolean(opts.background));
            downloaded++;
          } catch (e) {
            if (e instanceof SyncInterrupted) {
              paused = true;
              break;
            }
            failed++;
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        await exportCopy(id, s.offlineExportDirUri, exportNames);
        opts.onProgress?.(++done, total);
        if (useService || plainProgress) updateSyncProgress(done, total, useService).catch(() => {});
      }
      if (paused) break;
      const latest = await syncMetadata(s).catch(() => [] as string[]);
      queue = latest.filter((docId) => !processed.has(docId));
      total += queue.length;
    }
  } finally {
    if (useService) await stopSyncService().catch(() => {});
    if (plainProgress) await clearSyncNotification();
  }
  setMeta("lastSyncAt", new Date().toISOString());
  return { documents: total, downloaded, failed, paused: paused || undefined, lastError: lastError || undefined };
}

/**
 * Warn (channel `alerts`, at most once a day) when trashed documents are close
 * to the server's permanent purge. Retention mirrors the Settings value.
 */
const PURGE_WARN_DAYS = 3;

async function checkTrashPurge(retentionDays: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (getMeta("lastPurgeWarnDay") === today) return;
  const { documents } = await listDeletedDocuments({ pageIndex: 0 });
  const day = 24 * 60 * 60 * 1000;
  const soon = documents.filter((d) => {
    if (!d.deletedAt) return false;
    const daysLeft = (new Date(d.deletedAt).getTime() + retentionDays * day - Date.now()) / day;
    return daysLeft <= PURGE_WARN_DAYS;
  });
  if (soon.length > 0) {
    await notifyTrashPurge(soon.length, PURGE_WARN_DAYS);
    setMeta("lastPurgeWarnDay", today);
  }
}

// Must be defined at module scope so the background task can run headlessly.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    // Files queued while the app was gone go out even without a UI session.
    await flushUploads().catch(() => {});
    const s = await getSettings();
    if (!s.syncEnabled) return BackgroundTask.BackgroundTaskResult.Success;
    await syncNow({ respectWifiOnly: true, background: true });
    setMeta("syncFailStreak", "0");
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      notifySessionExpired().catch(() => {});
    } else {
      const streak = Number(getMeta("syncFailStreak") ?? "0") + 1;
      setMeta("syncFailStreak", String(streak));
      if (streak === 3) notifySyncFailures(streak).catch(() => {});
    }
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

/**
 * Delete every offline copy (blobs + pointers + exported folder copies) but
 * keep the metadata mirror. Offered when the user turns offline sync off.
 * Only files matching our documents' export names are removed from the
 * user-picked folder — anything else in there is untouched.
 */
export async function wipeOfflineFiles(exportDirUri: string): Promise<void> {
  if (exportDirUri) {
    try {
      const expected = new Set(
        listCachedDocuments()
          .filter((d) => d.fileUri)
          .map((d) => displayFileName(d)),
      );
      const entries = await FileSystemLegacy.StorageAccessFramework.readDirectoryAsync(exportDirUri);
      for (const uri of entries) {
        const name = decodeURIComponent(uri.split("%2F").pop() ?? "");
        if (expected.has(name)) {
          await FileSystemLegacy.deleteAsync(uri, { idempotent: true }).catch(() => {});
        }
      }
    } catch {
      /* folder revoked — blobs still wiped below */
    }
  }
  for (const uri of clearFileUris()) safeDelete(uri);
  try {
    docsDir().delete();
  } catch {
    /* fine */
  }
}

/** Full sign-out: server session (best effort), settings, mirrors, blobs, background job. */
export async function signOutEverything(): Promise<void> {
  const s = await getSettings();
  if (s.serverUrl) {
    await getAuthClient(s.serverUrl)
      .signOut()
      .catch(() => {});
    // An offline sign-out never reaches the server, so the stored cookie
    // would stay valid. Delete the session material unconditionally.
    for (const key of authStorageKeys(s.serverUrl)) {
      await SecureStore.deleteItemAsync(key).catch(() => {});
    }
  }
  wipeLocalData();
  // Only the account is forgotten — device preferences (sync, biometric lock,
  // notifications, date format...) survive until the app is uninstalled.
  await saveSettings({ accountEmail: "", organizationId: "", organizationName: "" });
  await applySyncRegistration().catch(() => {});
}

/** Sign-out: drop every organization's mirror (all papra*.db files) and every blob. */
export function wipeLocalData(): void {
  for (const uri of clearCache()) safeDelete(uri);
  setActiveOrg(""); // close the open database before deleting files
  try {
    const sqliteDir = new Directory(Paths.document, "SQLite");
    if (sqliteDir.exists) {
      for (const entry of sqliteDir.list()) {
        if (entry instanceof File && entry.name.startsWith("papra")) {
          try {
            entry.delete();
          } catch {
            /* locked journal — ignored */
          }
        }
      }
    }
  } catch {
    /* fine */
  }
  try {
    docsDir().delete();
  } catch {
    /* fine */
  }
}
