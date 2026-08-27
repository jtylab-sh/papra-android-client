/**
 * Offline upload queue: files picked while the server is unreachable are
 * copied here (blob + sidecar json with name/mime) and sent on the next app
 * start or reconnect. Legacy FS API on purpose — copyAsync accepts the
 * content:// uris the share sheet hands over, the new File API does not.
 */
import * as FS from "expo-file-system/legacy";
import { AppState, ToastAndroid } from "react-native";
import { ApiError, uploadDocument } from "~/lib/papra";
import { notifyUploadsComplete, stopUploadNotification, updateUploadProgress } from "~/lib/notifications";
import { syncMetadata } from "~/lib/sync";

const DIR = `${FS.documentDirectory}upload-queue/`;

interface QueuedMeta {
  name: string;
  mimeType?: string;
}

export interface QueuedUpload {
  key: string;
  name: string;
  mimeType?: string;
  queuedAt: number;
  size: number | null;
}

export async function listQueuedUploads(): Promise<QueuedUpload[]> {
  const names = await FS.readDirectoryAsync(DIR).catch(() => [] as string[]);
  const out: QueuedUpload[] = [];
  for (const n of names.filter((x) => !x.endsWith(".json"))) {
    const metaRaw = await FS.readAsStringAsync(`${DIR}${n}.json`).catch(() => null);
    const meta: QueuedMeta = metaRaw ? JSON.parse(metaRaw) : { name: n };
    const info = await FS.getInfoAsync(`${DIR}${n}`).catch(() => null);
    out.push({
      key: n,
      name: meta.name,
      mimeType: meta.mimeType,
      queuedAt: Number(n.split("-")[0]) || 0,
      size: info?.exists ? (info.size ?? null) : null,
    });
  }
  return out.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function removeQueuedUpload(key: string): Promise<void> {
  await FS.deleteAsync(`${DIR}${key}`, { idempotent: true });
  await FS.deleteAsync(`${DIR}${key}.json`, { idempotent: true });
}

export async function clearQueuedUploads(): Promise<void> {
  await FS.deleteAsync(DIR, { idempotent: true }); // enqueue recreates it
}

export async function countQueuedUploads(): Promise<number> {
  const names = await FS.readDirectoryAsync(DIR).catch(() => [] as string[]);
  return names.filter((n) => !n.endsWith(".json")).length;
}

export async function enqueueUpload(file: { uri: string; name: string; mimeType?: string }): Promise<string> {
  await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await FS.copyAsync({ from: file.uri, to: `${DIR}${base}` });
  const meta: QueuedMeta = { name: file.name, mimeType: file.mimeType };
  await FS.writeAsStringAsync(`${DIR}${base}.json`, JSON.stringify(meta));
  return base;
}

export interface FlushResult {
  sent: number;
  dropped: number;
  /** Message of the failure that stopped the flush, null when none did. */
  failedError: string | null;
  sentKeys: string[];
  droppedKeys: { key: string; message: string }[];
}

/** Send everything in the queue. Safe to call any time; null when already running. */
let flushing = false; // foreground + reconnect + manual can overlap
export async function flushUploads(): Promise<FlushResult | null> {
  if (flushing) return null;
  flushing = true;
  try {
    return await doFlush();
  } finally {
    flushing = false;
  }
}

async function doFlush(): Promise<FlushResult> {
  const names = await FS.readDirectoryAsync(DIR).catch(() => [] as string[]);
  const entries = names.filter((n) => !n.endsWith(".json"));
  let sent = 0;
  let dropped = 0;
  let failedError: string | null = null;
  const sentKeys: string[] = [];
  const droppedKeys: { key: string; message: string }[] = [];
  // Android 12+ forbids starting a foreground service from the background;
  // background flushes show a plain progress notification instead.
  const asService = AppState.currentState === "active";
  let index = 0;
  for (const n of entries) {
    const metaRaw = await FS.readAsStringAsync(`${DIR}${n}.json`).catch(() => null);
    const meta: QueuedMeta = metaRaw ? JSON.parse(metaRaw) : { name: n };
    updateUploadProgress(index++, entries.length, meta.name, asService).catch(() => {});
    try {
      await uploadDocument({ uri: `${DIR}${n}`, name: meta.name, mimeType: meta.mimeType });
      sent++;
      sentKeys.push(n);
    } catch (e) {
      // 4xx = the server refused this file (duplicate, too big) — retrying
      // can never succeed, so drop it. Anything else (offline, 5xx): stop
      // and keep the rest for the next flush.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        dropped++;
        droppedKeys.push({ key: n, message: e.message });
      } else {
        failedError = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    await FS.deleteAsync(`${DIR}${n}`, { idempotent: true });
    await FS.deleteAsync(`${DIR}${n}.json`, { idempotent: true });
  }
  if (entries.length > 0) await stopUploadNotification();
  // The ongoing progress notification is gone in a second for small files;
  // when the app is not on screen, leave a visible "uploaded" note behind.
  if (sent > 0 && AppState.currentState !== "active") notifyUploadsComplete(sent).catch(() => {});
  if (sent > 0) {
    ToastAndroid.show(`Uploaded ${sent} queued document${sent === 1 ? "" : "s"}`, ToastAndroid.SHORT);
    syncMetadata().catch(() => {});
  }
  if (dropped > 0) {
    ToastAndroid.show(`${dropped} queued upload${dropped === 1 ? "" : "s"} rejected by the server`, ToastAndroid.LONG);
  }
  return { sent, dropped, failedError, sentKeys, droppedKeys };
}
