/**
 * App settings, stored in SecureStore (everything is small strings).
 */
import * as SecureStore from "expo-secure-store";
import { setActiveOrg } from "./db";

export interface Settings {
  serverUrl: string; // normalized, no trailing slash
  /** email of the signed-in better-auth account (display only) */
  accountEmail: string;
  organizationId: string;
  organizationName: string;
  syncEnabled: boolean;
  /** minutes between background syncs */
  syncIntervalMinutes: number;
  syncWifiOnly: boolean;
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
  /** notification toggles — all opt-in; enabling the first one asks for permission */
  notifyNewDocuments: boolean;
  notifySyncFailures: boolean;
  notifySessionExpired: boolean;
  notifyTrashPurge: boolean;
  /**
   * Ongoing progress notification during manual syncs. Doubles as the switch
   * for the dataSync foreground service that keeps a sync alive when the app
   * is left mid-sync (Android requires a visible notification for that).
   */
  notifySyncProgress: boolean;
}

const DEFAULTS: Settings = {
  serverUrl: "",
  accountEmail: "",
  organizationId: "",
  organizationName: "",
  syncEnabled: false,
  syncIntervalMinutes: 720,
  syncWifiOnly: true,
  biometricLock: false,
  lockGraceMinutes: 5,
  offlineExportDirUri: "",
  trashRetentionDays: 30,
  notifyNewDocuments: false,
  notifySyncFailures: false,
  notifySessionExpired: false,
  notifyTrashPurge: false,
  notifySyncProgress: false,
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
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  if (next.serverUrl) next.serverUrl = normalizeServerUrl(next.serverUrl);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  setActiveOrg(next.organizationId);
  return next;
}

export async function clearSettings(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
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
