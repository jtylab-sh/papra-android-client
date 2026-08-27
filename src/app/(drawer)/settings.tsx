import * as FileSystemLegacy from "expo-file-system/legacy";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Chip, Switch, Text, useTheme } from "react-native-paper";
import { Button, Card, KeyValue, Muted, Row } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { getAuthClient } from "../../lib/auth";
import { getMeta } from "../../lib/db";
import { clearSettings, getSettings, saveSettings, type Settings } from "../../lib/settings";
import { applySyncRegistration, syncNow, wipeLocalData } from "../../lib/sync";

const GRACE: { label: string; minutes: number }[] = [
  { label: "Immediately", minutes: 0 },
  { label: "1 min", minutes: 1 },
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "1 h", minutes: 60 },
];

const INTERVALS: { label: string; minutes: number }[] = [
  { label: "15 min", minutes: 15 },
  { label: "1 h", minutes: 60 },
  { label: "6 h", minutes: 360 },
  { label: "12 h", minutes: 720 },
  { label: "24 h", minutes: 1440 },
];

export default function SettingsScreen() {
  const theme = useTheme<AppTheme>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const lastSyncAt = getMeta("lastSyncAt");

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const update = useCallback(async (patch: Partial<Settings>, reRegister = false) => {
    const next = await saveSettings(patch);
    setSettings(next);
    if (reRegister) await applySyncRegistration();
  }, []);

  const toggleBiometric = useCallback(
    async (value: boolean) => {
      if (value) {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!hw || !enrolled) {
          Alert.alert("Unavailable", "No biometric hardware or nothing enrolled on this device.");
          return;
        }
      }
      update({ biometricLock: value });
    },
    [update],
  );

  const runSync = useCallback(async () => {
    setSyncing(true);
    setProgress("Fetching metadata…");
    try {
      const result = await syncNow({
        onProgress: (done, total) => setProgress(`Files ${done}/${total}`),
      });
      setProgress(
        result.skipped
          ? `Skipped (${result.skipped})`
          : `Done: ${result.documents} documents, ${result.downloaded} downloaded${result.failed ? `, ${result.failed} failed` : ""}`,
      );
    } catch (e) {
      setProgress(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "Removes the account, settings and every offline document from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          const s = await getSettings();
          if (s.authMode === "session" && s.serverUrl) {
            await getAuthClient(s.serverUrl)
              .signOut()
              .catch(() => {});
          }
          wipeLocalData();
          await clearSettings();
          await applySyncRegistration().catch(() => {});
          router.replace("/sign-in");
        },
      },
    ]);
  }, []);

  if (!settings) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
    >

      <Card>
        <Muted>Server</Muted>
        <View style={{ marginTop: 8 }}>
          <KeyValue label="URL" value={settings.serverUrl} />
          <KeyValue label="Organization" value={settings.organizationName || settings.organizationId} />
          <KeyValue label="Auth" value={settings.authMode === "apiKey" ? "API key" : "Email & password"} />
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="titleMedium">Offline sync</Text>
          <Switch value={settings.syncEnabled} onValueChange={(v: boolean) => update({ syncEnabled: v }, true)} />
        </Row>
        <Muted>Mirrors every document to this phone in the background.</Muted>

        {settings.syncEnabled && (
          <>
            <Text
              variant="labelMedium"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: spacing.md, marginBottom: 6 }}
            >
              CADENCE (Android decides the exact moment)
            </Text>
            <Row style={{ flexWrap: "wrap" }}>
              {INTERVALS.map((opt) => (
                <Chip
                  key={opt.minutes}
                  compact
                  showSelectedCheck={false}
                  selected={settings.syncIntervalMinutes === opt.minutes}
                  onPress={() => update({ syncIntervalMinutes: opt.minutes }, true)}
                  style={{ marginBottom: 6 }}
                >
                  {opt.label}
                </Chip>
              ))}
            </Row>
            <Row style={{ justifyContent: "space-between", marginTop: spacing.sm }}>
              <Text variant="bodyLarge">Wi-Fi only</Text>
              <Switch value={settings.syncWifiOnly} onValueChange={(v: boolean) => update({ syncWifiOnly: v })} />
            </Row>
            <Row style={{ justifyContent: "space-between", marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyLarge">Export copies to folder</Text>
                <Muted>
                  {settings.offlineExportDirUri
                    ? decodeURIComponent(settings.offlineExportDirUri.split("%3A").pop() ?? "chosen folder")
                    : "Offline copies stay in app storage; pick a folder to also get browsable copies."}
                </Muted>
              </View>
              <Button
                label={settings.offlineExportDirUri ? "Clear" : "Choose"}
                kind="ghost"
                onPress={async () => {
                  if (settings.offlineExportDirUri) {
                    update({ offlineExportDirUri: "" });
                    return;
                  }
                  const perm = await FileSystemLegacy.StorageAccessFramework.requestDirectoryPermissionsAsync();
                  if (perm.granted) update({ offlineExportDirUri: perm.directoryUri });
                }}
              />
            </Row>
          </>
        )}

        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Button label="Sync now" kind="ghost" onPress={runSync} loading={syncing} />
          {progress ? <Muted>{progress}</Muted> : null}
          {lastSyncAt ? <Muted>Last sync: {new Date(lastSyncAt).toLocaleString()}</Muted> : null}
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="titleMedium">Biometric lock</Text>
          <Switch value={settings.biometricLock} onValueChange={toggleBiometric} />
        </Row>
        <Muted>Require fingerprint / face unlock when the app opens.</Muted>
        {settings.biometricLock && (
          <>
            <Text
              variant="labelMedium"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: spacing.md, marginBottom: 6 }}
            >
              LOCK AFTER LEAVING THE APP FOR
            </Text>
            <Row style={{ flexWrap: "wrap" }}>
              {GRACE.map((opt) => (
                <Chip
                  key={opt.minutes}
                  compact
                  showSelectedCheck={false}
                  selected={settings.lockGraceMinutes === opt.minutes}
                  onPress={() => update({ lockGraceMinutes: opt.minutes })}
                  style={{ marginBottom: 6 }}
                >
                  {opt.label}
                </Chip>
              ))}
            </Row>
          </>
        )}
      </Card>

      <Button label="Sign out" kind="danger" onPress={signOut} />
    </ScrollView>
  );
}
