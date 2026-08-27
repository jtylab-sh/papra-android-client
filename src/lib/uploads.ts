/**
 * Offline upload queue: files picked while the server is unreachable are
 * copied here (blob + sidecar json with name/mime) and sent on the next app
 * start or reconnect. Legacy FS API on purpose — copyAsync accepts the
 * content:// uris the share sheet hands over, the new File API does not.
 */
import * as FS from "expo-file-system/legacy";
import { ToastAndroid } from "react-native";
import { ApiError, uploadDocument } from "~/lib/papra";
import { syncMetadata } from "~/lib/sync";

const DIR = `${FS.documentDirectory}upload-queue/`;

interface QueuedMeta {
  name: string;
  mimeType?: string;
}

export async function countQueuedUploads(): Promise<number> {
  const names = await FS.readDirectoryAsync(DIR).catch(() => [] as string[]);
  return names.filter((n) => !n.endsWith(".json")).length;
}

export async function enqueueUpload(file: { uri: string; name: string; mimeType?: string }): Promise<void> {
  await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const base = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await FS.copyAsync({ from: file.uri, to: `${DIR}${base}` });
  const meta: QueuedMeta = { name: file.name, mimeType: file.mimeType };
  await FS.writeAsStringAsync(`${DIR}${base}.json`, JSON.stringify(meta));
}

/** Send everything in the queue. Safe to call any time; no-op when empty. */
export async function flushUploads(): Promise<void> {
  const names = await FS.readDirectoryAsync(DIR).catch(() => [] as string[]);
  const entries = names.filter((n) => !n.endsWith(".json"));
  let sent = 0;
  let dropped = 0;
  for (const n of entries) {
    const metaRaw = await FS.readAsStringAsync(`${DIR}${n}.json`).catch(() => null);
    const meta: QueuedMeta = metaRaw ? JSON.parse(metaRaw) : { name: n };
    try {
      await uploadDocument({ uri: `${DIR}${n}`, name: meta.name, mimeType: meta.mimeType });
      sent++;
    } catch (e) {
      // 4xx = the server refused this file (duplicate, too big) — retrying
      // can never succeed, so drop it. Anything else (offline, 5xx): stop
      // and keep the rest for the next flush.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) dropped++;
      else break;
    }
    await FS.deleteAsync(`${DIR}${n}`, { idempotent: true });
    await FS.deleteAsync(`${DIR}${n}.json`, { idempotent: true });
  }
  if (sent > 0) {
    ToastAndroid.show(`Uploaded ${sent} queued document${sent === 1 ? "" : "s"}`, ToastAndroid.SHORT);
    syncMetadata().catch(() => {});
  }
  if (dropped > 0) {
    ToastAndroid.show(`${dropped} queued upload${dropped === 1 ? "" : "s"} rejected by the server`, ToastAndroid.LONG);
  }
}
