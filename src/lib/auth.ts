/**
 * better-auth client against the user's own Papra server.
 *
 * Papra ships better-auth with the expo() server plugin and trusts the
 * `papra://` app scheme by default (TRUSTED_APP_SCHEMES), so email/password
 * sign-in works against any self-hosted instance with no server changes.
 * The client is created per server URL (better-auth fixes baseURL at creation).
 */
import { expoClient } from "@better-auth/expo/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

type AuthClient = ReturnType<typeof buildClient>;

/**
 * SecureStore prefix derived from the server host, so a session cookie for
 * server A is never attached to requests aimed at server B.
 */
function storagePrefixFor(serverUrl: string): string {
  const host = serverUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return `papra_${host.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/** Every SecureStore key that may hold session material for this server. */
export function authStorageKeys(serverUrl: string): string[] {
  const p = storagePrefixFor(serverUrl);
  // The unkeyed "papra" prefix is the pre-1.13 slot; clear it too.
  return [`${p}_cookie`, `${p}_session_data`, "papra_cookie", "papra_session_data"];
}

function buildClient(serverUrl: string) {
  return createAuthClient({
    baseURL: serverUrl,
    plugins: [
      expoClient({
        scheme: "papra",
        storagePrefix: storagePrefixFor(serverUrl),
        storage: SecureStore,
      }),
      // Papra's server always registers better-auth's twoFactor plugin; this is
      // the client half (signIn.email -> twoFactorRedirect -> verifyTotp).
      twoFactorClient(),
    ],
  });
}

let client: AuthClient | null = null;
let clientUrl = "";

export function getAuthClient(serverUrl: string): AuthClient {
  if (!client || clientUrl !== serverUrl) {
    client = buildClient(serverUrl);
    clientUrl = serverUrl;
  }
  return client;
}

/** Session cookie header value for authenticated requests, or empty string. */
export async function getAuthCookie(serverUrl: string): Promise<string> {
  return (await getAuthClient(serverUrl).getCookie()) ?? "";
}
