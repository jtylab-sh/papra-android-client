/**
 * App settings, stored in SecureStore (everything is small strings, and the
 * API key must be there anyway — one store keeps it simple).
 */
import * as SecureStore from "expo-secure-store";

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
};

const KEY = "papra.settings";

export async function getSettings(): Promise<Settings> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  if (next.serverUrl) next.serverUrl = normalizeServerUrl(next.serverUrl);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
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
