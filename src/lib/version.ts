/**
 * App version + update check against this repo's GitHub releases. This is the
 * app's only network call not aimed at the user's Papra server: a plain
 * unauthenticated GET carrying no identifying data. Prompts at most once per
 * available version (remembered in SecureStore).
 */
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Alert, Linking } from "react-native";

const RELEASES_LATEST = "https://api.github.com/repos/jtylab-sh/papra-android-client/releases/latest";
const RELEASES_PAGE = "https://github.com/jtylab-sh/papra-android-client/releases";
const PROMPTED_KEY = "papra.updatePrompted";

/** CI writes the release version into app.json before prebuild. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function maybePromptUpdate(): Promise<void> {
  try {
    const res = await fetch(RELEASES_LATEST);
    if (!res.ok) return;
    const json = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = (json.tag_name ?? "").replace(/^v/, "");
    if (!latest || !newer(latest, appVersion())) return;
    if ((await SecureStore.getItemAsync(PROMPTED_KEY)) === latest) return;
    await SecureStore.setItemAsync(PROMPTED_KEY, latest);
    Alert.alert(`Update available: v${latest}`, `You have v${appVersion()}. Download the new APK from GitHub?`, [
      { text: "Later", style: "cancel" },
      {
        text: "Download",
        onPress: () => {
          Linking.openURL(json.html_url ?? RELEASES_PAGE).catch(() => {});
        },
      },
    ]);
  } catch {
    /* offline or GitHub unreachable: try again next start */
  }
}
