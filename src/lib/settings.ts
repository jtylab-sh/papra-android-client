/**
 * App settings, stored in SecureStore (everything is small strings).
 */
import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { setActiveOrg } from "~/lib/db";

export interface Settings {
  serverUrl: string; // normalized, no trailing slash
  /** email of the signed-in better-auth account (display only) */
  accountEmail: string;
  organizationId: string;
  organizationName: string;
  syncEnabled: boolean;
  biometricLock: boolean;
  /** minutes the app stays unlocked after leaving it; 0 = lock immediately */
  lockGraceMinutes: number;
  /** SAF tree URI; when set, offline copies are also exported there ("" = off) */
  offlineExportDirUri: string;
  /**
   * Mirror of the server's deletedDocumentsRetentionDays (not readable via the
   * API). Only affects countdowns shown in this app — never the server.
   */
  trashRetentionDays: number;
  /**
   * Ongoing progress notification during manual syncs. Doubles as the switch
   * for the dataSync foreground service that keeps a sync alive when the app
   * is left mid-sync (Android requires a visible notification for that).
   */
  notifySyncProgress: boolean;
  /** opt-in GitHub release check on start; off by default (Obtainium/store users) */
  updateCheckEnabled: boolean;
  /** how dates render across the app; "system" follows the phone's locale */
  dateFormat: DateFormat;
}

export type DateFormat = "system" | "dmy" | "mdy" | "ymd";

// Mirrors the persisted setting so the synchronous date formatter (used in
// every list row) never needs to await SecureStore.
let activeDateFormat: DateFormat = "system";
// React Compiler memoizes by visible deps, so a plain module read goes stale
// in already-rendered rows — components must subscribe via useDateFormat().
const dateFormatListeners = new Set<() => void>();
function setDateFormatMirror(f: DateFormat): void {
  if (f === activeDateFormat) return;
  activeDateFormat = f;
  dateFormatListeners.forEach((l) => l());
}
export function useDateFormat(): DateFormat {
  return useSyncExternalStore(
    (cb) => {
      dateFormatListeners.add(cb);
      return () => dateFormatListeners.delete(cb);
    },
    () => activeDateFormat,
  );
}

export function getActiveDateFormat(): DateFormat {
  return activeDateFormat;
}

export const DEFAULTS: Settings = {
  serverUrl: "",
  accountEmail: "",
  organizationId: "",
  organizationName: "",
  syncEnabled: false,
  biometricLock: false,
  lockGraceMinutes: 5,
  offlineExportDirUri: "",
  trashRetentionDays: 30,
  notifySyncProgress: false,
  updateCheckEnabled: false,
  dateFormat: "system",
};

const KEY = "papra.settings";

export async function getSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync(KEY);
  let settings: Settings;
  try {
    settings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    settings = { ...DEFAULTS };
  }
  setActiveOrg(settings.organizationId);
  setDateFormatMirror(settings.dateFormat);
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  if (next.serverUrl) next.serverUrl = normalizeServerUrl(next.serverUrl);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  setActiveOrg(next.organizationId);
  setDateFormatMirror(next.dateFormat);
  return next;
}

export function normalizeServerUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/** Configured enough to talk to a server (org may still be unpicked). */
export function isConnected(s: Settings): boolean {
  return Boolean(s.serverUrl && s.organizationId);
}
