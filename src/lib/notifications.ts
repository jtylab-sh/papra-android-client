/**
 * Local notifications (no push infra — Papra has no FCM sender). Every event
 * has its own opt-in toggle in Settings; the POST_NOTIFICATIONS permission is
 * requested when the user enables the first toggle, never at app start.
 * Channels: `sync` (silent) and `alerts` (default importance) — mutable per
 * channel from Android settings. See docs/NOTIFICATIONS.md.
 */
import * as Notifications from "expo-notifications";
import notifee, { AndroidForegroundServiceType, AndroidImportance, EventType } from "react-native-notify-kit";
import { getSettings } from "~/lib/settings";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let channelsReady = false;

async function ensureChannels(): Promise<void> {
  if (channelsReady) return;
  await Notifications.setNotificationChannelAsync("sync", {
    name: "Sync results",
    importance: Notifications.AndroidImportance.LOW,
  });
  await Notifications.setNotificationChannelAsync("alerts", {
    name: "Action needed",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  channelsReady = true;
}

/** Ask for POST_NOTIFICATIONS (Android 13+). Returns whether we may notify. */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** `url` is the in-app route a tap navigates to (see wireNotificationNavigation). */
async function post(channelId: "sync" | "alerts", title: string, body: string, url: string): Promise<void> {
  try {
    await ensureChannels();
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { url } },
      trigger: { channelId },
    });
  } catch {
    /* notifications must never break a sync */
  }
}

export async function notifyNewDocuments(count: number, firstName: string): Promise<void> {
  if (!(await getSettings()).notifyNewDocuments) return;
  const title = count === 1 ? "1 new document" : `${count} new documents`;
  await post("sync", title, count === 1 ? firstName : `${firstName}, …`, "/documents");
}

export async function notifySyncFailures(streak: number): Promise<void> {
  if (!(await getSettings()).notifySyncFailures) return;
  await post("alerts", "Background sync keeps failing", `${streak} runs in a row. Open the app to check.`, "/settings");
}

export async function notifySessionExpired(): Promise<void> {
  if (!(await getSettings()).notifySessionExpired) return;
  await post(
    "alerts",
    "Sign in again",
    "The Papra session expired; background sync is paused until you sign in.",
    "/sign-in",
  );
}

export async function notifyTrashPurge(count: number, withinDays: number): Promise<void> {
  if (!(await getSettings()).notifyTrashPurge) return;
  await post(
    "alerts",
    "Trash purge soon",
    `${count} trashed document${count === 1 ? "" : "s"} will be permanently deleted within ${withinDays} day${withinDays === 1 ? "" : "s"}.`,
    "/trash",
  );
}

/**
 * Tap-to-navigate for every notification this app posts: expo-notifications
 * carry their route in data.url; the sync-progress (notifee) notification
 * always leads to Settings. Covers warm taps and cold starts from a tap.
 * Returns the unsubscribe for both sources.
 */
export function wireNotificationNavigation(navigate: (url: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const url = resp.notification.request.content.data?.url;
    if (typeof url === "string") navigate(url);
  });
  Notifications.getLastNotificationResponseAsync()
    .then((resp) => {
      const url = resp?.notification.request.content.data?.url;
      if (typeof url === "string") navigate(url);
    })
    .catch(() => {});
  const unsubNotifee = notifee.onForegroundEvent(({ type, detail }) => {
    if (type !== EventType.PRESS) return;
    if (detail.pressAction?.id === SYNC_PROGRESS_ID) navigate("/settings");
    if (detail.pressAction?.id === UPLOAD_PROGRESS_ID) navigate("/queue");
  });
  notifee
    .getInitialNotification()
    .then((initial) => {
      if (initial?.pressAction?.id === SYNC_PROGRESS_ID) navigate("/settings");
      if (initial?.pressAction?.id === UPLOAD_PROGRESS_ID) navigate("/queue");
    })
    .catch(() => {});
  return () => {
    sub.remove();
    unsubNotifee();
  };
}

/**
 * Sync progress: an ongoing notification bound to a dataSync foreground
 * service (react-native-notify-kit), so a manual sync keeps running when the
 * user leaves the app. The service runner lives in index.js; stopping the
 * service is what ends it.
 */
const SYNC_PROGRESS_ID = "sync-progress";

/** Shared shape of the ongoing progress notifications (sync and upload). */
function fgsAndroid(channelId: string) {
  return {
    channelId,
    asForegroundService: true,
    foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC],
    ongoing: true,
    onlyAlertOnce: true,
    // Tap opens the app; wireNotificationNavigation routes by pressAction id.
    pressAction: { id: channelId, launchActivity: "default" },
  };
}

const FGS_ANDROID = fgsAndroid(SYNC_PROGRESS_ID);
let lastProgressAt = 0;

export async function startSyncService(): Promise<void> {
  await notifee.createChannel({
    id: SYNC_PROGRESS_ID,
    name: "Sync progress",
    importance: AndroidImportance.LOW,
  });
  await notifee.displayNotification({
    id: SYNC_PROGRESS_ID,
    title: "Syncing documents",
    body: "Fetching metadata\u2026",
    android: { ...FGS_ANDROID, progress: { indeterminate: true } },
  });
}

/**
 * Progress update. asService=true rides the foreground service (manual syncs);
 * asService=false is a plain ongoing notification — all a background
 * WorkManager run may show (Android 12+ forbids starting a service from there).
 */
export async function updateSyncProgress(done: number, total: number, asService = true): Promise<void> {
  const now = Date.now();
  if (done < total && now - lastProgressAt < 1000) return; // at most 1 update/s
  lastProgressAt = now;
  const { asForegroundService, foregroundServiceTypes, ...plain } = FGS_ANDROID;
  await notifee.displayNotification({
    id: SYNC_PROGRESS_ID,
    title: "Syncing documents",
    body: `Checked ${done} of ${total}`,
    android: { ...(asService ? FGS_ANDROID : plain), progress: { max: total, current: done } },
  });
}

/** Remove the plain progress notification after a background sync. */
export async function clearSyncNotification(): Promise<void> {
  await notifee.cancelNotification(SYNC_PROGRESS_ID).catch(() => {});
}

export async function stopSyncService(): Promise<void> {
  await notifee.stopForegroundService();
  await notifee.cancelNotification(SYNC_PROGRESS_ID).catch(() => {});
}

/**
 * Upload progress: same foreground-service pattern as sync so an upload keeps
 * running when the user switches apps. Taps lead to the queue page.
 */
const UPLOAD_PROGRESS_ID = "upload-progress";
const UPLOAD_FGS_ANDROID = fgsAndroid(UPLOAD_PROGRESS_ID);

/** asService=false for background runs (Android 12+ forbids starting one there). */
export async function updateUploadProgress(done: number, total: number, name: string, asService = true): Promise<void> {
  try {
    await notifee.createChannel({
      id: UPLOAD_PROGRESS_ID,
      name: "Upload progress",
      importance: AndroidImportance.LOW,
    });
    const { asForegroundService, foregroundServiceTypes, ...plain } = UPLOAD_FGS_ANDROID;
    await notifee.displayNotification({
      id: UPLOAD_PROGRESS_ID,
      title: `Uploading ${Math.min(done + 1, total)} of ${total}`,
      body: name,
      android: { ...(asService ? UPLOAD_FGS_ANDROID : plain), progress: { max: total, current: done } },
    });
  } catch {
    /* notifications must never break an upload */
  }
}

/** Lingering note for uploads that finish while the app is out of sight. */
export async function notifyUploadsComplete(count: number): Promise<void> {
  const title = count === 1 ? "1 document uploaded" : `${count} documents uploaded`;
  await post("sync", title, "", "/documents");
}

export async function stopUploadNotification(): Promise<void> {
  // ponytail: stopForegroundService stops the one shared service; a manual
  // sync running at the same moment degrades to a plain notification.
  await notifee.stopForegroundService().catch(() => {});
  await notifee.cancelNotification(UPLOAD_PROGRESS_ID).catch(() => {});
}
