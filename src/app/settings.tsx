import * as LocalAuthentication from "expo-local-authentication";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Button, Card, KeyValue, Muted, Row } from "../components/ui";
import { colors, radius, spacing } from "../constants/theme";
import { getAuthClient } from "../lib/auth";
import { getMeta } from "../lib/db";
import { clearSettings, getSettings, saveSettings, type Settings } from "../lib/settings";
import { applySyncRegistration, syncNow, wipeLocalData } from "../lib/sync";

const INTERVALS: { label: string; minutes: number }[] = [
  { label: "15 min", minutes: 15 },
  { label: "1 h", minutes: 60 },
  { label: "6 h", minutes: 360 },
  { label: "12 h", minutes: 720 },
  { label: "24 h", minutes: 1440 },
];

export default function SettingsScreen() {
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

  if (!settings) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      <Stack.Screen options={{ title: "Settings" }} />

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
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>Offline sync</Text>
          <Switch
            value={settings.syncEnabled}
            onValueChange={(v) => update({ syncEnabled: v }, true)}
            trackColor={{ true: colors.primaryDim, false: colors.border }}
            thumbColor={settings.syncEnabled ? colors.primary : colors.textMuted}
          />
        </Row>
        <Muted>Mirrors every document to this phone in the background.</Muted>

        {settings.syncEnabled && (
          <>
            <Text style={{ color: colors.textMuted, marginTop: spacing.md, marginBottom: 6, fontSize: 12 }}>
              CADENCE (Android decides the exact moment)
            </Text>
            <Row style={{ flexWrap: "wrap" }}>
              {INTERVALS.map((opt) => {
                const active = settings.syncIntervalMinutes === opt.minutes;
                return (
                  <Pressable
                    key={opt.minutes}
                    onPress={() => update({ syncIntervalMinutes: opt.minutes }, true)}
                    style={{
                      backgroundColor: active ? colors.primary : colors.surfaceHigh,
                      borderRadius: radius.sm,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      marginBottom: 6,
                    }}
                  >
                    <Text style={{ color: active ? "#06231a" : colors.text, fontWeight: "600", fontSize: 13 }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
            <Row style={{ justifyContent: "space-between", marginTop: spacing.sm }}>
              <Text style={{ color: colors.text }}>Wi-Fi only</Text>
              <Switch
                value={settings.syncWifiOnly}
                onValueChange={(v) => update({ syncWifiOnly: v })}
                trackColor={{ true: colors.primaryDim, false: colors.border }}
                thumbColor={settings.syncWifiOnly ? colors.primary : colors.textMuted}
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
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>Biometric lock</Text>
          <Switch
            value={settings.biometricLock}
            onValueChange={toggleBiometric}
            trackColor={{ true: colors.primaryDim, false: colors.border }}
            thumbColor={settings.biometricLock ? colors.primary : colors.textMuted}
          />
        </Row>
        <Muted>Require fingerprint / face unlock when the app opens.</Muted>
      </Card>

      <Button label="Sign out" kind="danger" onPress={signOut} />
    </ScrollView>
  );
}
