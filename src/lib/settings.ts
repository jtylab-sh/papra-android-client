/**
 * App settings, stored in SecureStore (everything is small strings, and the
 * API key must be there anyway — one store keeps it simple).
 */
import * as SecureStore from "expo-secure-store";
import { setActiveOrg } from "./db";

export type AuthMode = "session" | "apiKey";

export interface Settings {
  serverUrl: string; // normalized, no trailing slash
  authMode: AuthMode;
  apiKey: string;
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
}

const DEFAULTS: Settings = {
  serverUrl: "",
  authMode: "session",
  apiKey: "",
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
  return Boolean(s.serverUrl && (s.authMode === "apiKey" ? s.apiKey : true) && s.organizationId);
}
