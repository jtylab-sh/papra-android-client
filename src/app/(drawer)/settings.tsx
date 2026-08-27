import * as FileSystemLegacy from "expo-file-system/legacy";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import {
  Button as PaperButton,
  Chip,
  Dialog,
  Portal,
  RadioButton,
  Switch,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { Button, Card, KeyValue, Muted, Row } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { getAuthClient } from "../../lib/auth";
import { requestNotificationPermission } from "../../lib/notifications";
import { createOrganization, listOrganizations, type PapraOrganization } from "../../lib/papra";
import { getMeta } from "../../lib/db";
import { clearSettings, getSettings, saveSettings, type Settings } from "../../lib/settings";
import { applySyncRegistration, syncMetadata, syncNow, wipeLocalData } from "../../lib/sync";

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
    getSettings().then((s) => {
      setSettings(s);
      // Installs from before accountEmail existed: read it from the session once.
      if (!s.accountEmail && s.serverUrl) {
        getAuthClient(s.serverUrl)
          .getSession()
          .then(({ data }) => {
            const email = data?.user?.email;
            if (email) saveSettings({ accountEmail: email }).then(setSettings);
          })
          .catch(() => {});
      }
    });
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

  // --- organizations (switch / create, like Papra's org picker) ---
  const [orgDialog, setOrgDialog] = useState(false);
  const [orgs, setOrgs] = useState<PapraOrganization[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);

  const openOrgDialog = useCallback(async () => {
    try {
      setOrgs(await listOrganizations());
      setOrgDialog(true);
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const switchOrg = useCallback(
    async (org: PapraOrganization) => {
      if (org.id === settings?.organizationId) return;
      // Each org has its own local mirror (papra-<orgId>.db) — nothing is wiped.
      setOrgDialog(false);
      const next = await saveSettings({ organizationId: org.id, organizationName: org.name });
      setSettings(next);
      syncMetadata().catch(() => {});
    },
    [settings?.organizationId],
  );

  const createOrg = useCallback(async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setOrgBusy(true);
    try {
      const org = await createOrganization(name);
      setNewOrgName("");
      setOrgs(await listOrganizations().catch(() => [...orgs, org]));
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setOrgBusy(false);
    }
  }, [newOrgName, orgs]);

  const toggleNotification = useCallback(
    async (key: "notifyNewDocuments" | "notifySyncFailures" | "notifySessionExpired" | "notifyTrashPurge", value: boolean) => {
      if (value && !(await requestNotificationPermission())) {
        Alert.alert("No permission", "Allow notifications for Papra in Android settings first.");
        return;
      }
      update({ [key]: value });
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
          : `Done: ${result.documents} documents, ${result.downloaded} downloaded${
              result.failed ? `, ${result.failed} failed (${result.lastError})` : ""
            }`,
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
          if (s.serverUrl) {
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
          <KeyValue label="Signed in as" value={settings.accountEmail || "\u2014"} />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Button label="Manage organizations" kind="ghost" onPress={openOrgDialog} />
        </View>
      </Card>

      <Portal>
        <Dialog visible={orgDialog} onDismiss={() => setOrgDialog(false)}>
          <Dialog.Title>Organizations</Dialog.Title>
          <Dialog.Content>
            <RadioButton.Group value={settings.organizationId} onValueChange={() => {}}>
              {orgs.map((org) => (
                <RadioButton.Item
                  key={org.id}
                  label={org.name}
                  value={org.id}
                  onPress={() => switchOrg(org)}
                />
              ))}
            </RadioButton.Group>
            <Row style={{ marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  mode="outlined"
                  dense
                  label="New organization"
                  value={newOrgName}
                  onChangeText={setNewOrgName}
                />
              </View>
              <PaperButton mode="contained" loading={orgBusy} disabled={!newOrgName.trim()} onPress={createOrg}>
                Create
              </PaperButton>
            </Row>
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setOrgDialog(false)}>Close</PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>

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
                  mode={settings.syncIntervalMinutes === opt.minutes ? "flat" : "outlined"}
                  onPress={() => update({ syncIntervalMinutes: opt.minutes }, true)}
                  style={{ marginRight: 6, marginBottom: 6 }}
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
                  mode={settings.lockGraceMinutes === opt.minutes ? "flat" : "outlined"}
                  onPress={() => update({ lockGraceMinutes: opt.minutes })}
                  style={{ marginRight: 6, marginBottom: 6 }}
                >
                  {opt.label}
                </Chip>
              ))}
            </Row>
          </>
        )}
      </Card>

      <Card>
        <Text variant="titleMedium">Trash retention</Text>
        <Muted>
          Days your Papra server keeps trashed documents (its
          deletedDocumentsRetentionDays). The app can't read it, so set it to match — this only
          affects countdowns shown here, never the server.
        </Muted>
        <Row style={{ flexWrap: "wrap", marginTop: spacing.sm }}>
          {[7, 14, 30, 60, 90].map((days) => (
            <Chip
              key={days}
              compact
              selected={settings.trashRetentionDays === days}
              showSelectedCheck={false}
              mode={settings.trashRetentionDays === days ? "flat" : "outlined"}
              onPress={() => update({ trashRetentionDays: days })}
              style={{ marginRight: 6, marginBottom: 6 }}
            >
              {`${days} days`}
            </Chip>
          ))}
        </Row>
      </Card>

      <Card>
        <Text variant="titleMedium">Notifications</Text>
        <Muted>All from background syncs only; permission is asked on first enable.</Muted>
        {(
          [
            ["notifyNewDocuments", "New documents", "When a background sync finds documents new to this phone"],
            ["notifySyncFailures", "Sync failures", "After 3 failed background syncs in a row"],
            ["notifySessionExpired", "Session expired", "When the server wants you to sign in again"],
            ["notifyTrashPurge", "Trash purge warning", "When trashed documents are within 3 days of permanent deletion"],
          ] as const
        ).map(([key, label, desc]) => (
          <Row key={key} style={{ justifyContent: "space-between", marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyLarge">{label}</Text>
              <Muted>{desc}</Muted>
            </View>
            <Switch value={settings[key]} onValueChange={(v: boolean) => toggleNotification(key, v)} />
          </Row>
        ))}
      </Card>

      <Button label="Sign out" kind="danger" onPress={signOut} />
    </ScrollView>
  );
}
