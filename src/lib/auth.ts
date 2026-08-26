/**
 * better-auth client against the user's own Papra server.
 *
 * Papra ships better-auth with the expo() server plugin and trusts the
 * `papra://` app scheme by default (TRUSTED_APP_SCHEMES), so email/password
 * sign-in works against any self-hosted instance with no server changes.
 * The client is created per server URL (better-auth fixes baseURL at creation).
 */
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

type AuthClient = ReturnType<typeof buildClient>;

function buildClient(serverUrl: string) {
  return createAuthClient({
    baseURL: serverUrl,
    plugins: [
      expoClient({
        scheme: "papra",
        storagePrefix: "papra",
        storage: SecureStore,
      }),
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
