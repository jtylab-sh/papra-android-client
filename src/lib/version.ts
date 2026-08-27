/**
 * App version + update check against this repo's GitHub releases. This is the
 * app's only network call not aimed at the user's Papra server: a plain
 * unauthenticated GET carrying no identifying data. Prompts at most once per
 * available version (remembered in SecureStore).
 */
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as SecureStore from "expo-secure-store";
import { Alert, Linking } from "react-native";

const RELEASES_LATEST = "https://api.github.com/repos/jtylab-sh/papra-android-client/releases/latest";
const RELEASES_PAGE = "https://github.com/jtylab-sh/papra-android-client/releases";
const PROMPTED_KEY = "papra.updatePrompted";

/** CI writes the release version into app.json before prebuild. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/**
 * Download the APK and hand it to the Android package installer. Falls back to
 * the release page in the browser on any failure (download or intent).
 */
async function downloadAndInstall(apkUrl: string, fallbackUrl: string): Promise<void> {
  try {
    const target = new File(Paths.cache, "papra-update.apk");
    if (target.exists) target.delete();
    await File.createDownloadTask(apkUrl, target).downloadAsync();
    const contentUri = await FileSystemLegacy.getContentUriAsync(target.uri);
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: "application/vnd.android.package-archive",
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch {
    Linking.openURL(fallbackUrl).catch(() => {});
  }
}

interface LatestRelease {
  tag_name?: string;
  html_url?: string;
  assets?: { name: string; browser_download_url: string }[];
}

export async function maybePromptUpdate(): Promise<void> {
  try {
    const res = await fetch(RELEASES_LATEST);
    if (!res.ok) return;
    const json = (await res.json()) as LatestRelease;
    const latest = (json.tag_name ?? "").replace(/^v/, "");
    // Numeric collation orders version segments correctly (1.10.0 > 1.9.0).
    if (!latest || latest.localeCompare(appVersion(), undefined, { numeric: true }) <= 0) return;
    if ((await SecureStore.getItemAsync(PROMPTED_KEY)) === latest) return;
    await SecureStore.setItemAsync(PROMPTED_KEY, latest);
    const pageUrl = json.html_url ?? RELEASES_PAGE;
    const apkUrl = json.assets?.find((a) => a.name.endsWith(".apk"))?.browser_download_url;
    Alert.alert(`Update available: v${latest}`, `You have v${appVersion()}. Install the new version?`, [
      { text: "Later", style: "cancel" },
      apkUrl
        ? {
            text: "Install",
            onPress: () => {
              Alert.alert("Downloading", "The update is downloading; the installer opens when it finishes.");
              downloadAndInstall(apkUrl, pageUrl);
            },
          }
        : {
            text: "Download",
            onPress: () => {
              Linking.openURL(pageUrl).catch(() => {});
            },
          },
    ]);
  } catch {
    /* offline or GitHub unreachable: try again next start */
  }
}
