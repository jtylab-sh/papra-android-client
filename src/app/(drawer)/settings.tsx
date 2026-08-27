import * as FileSystemLegacy from "expo-file-system/legacy";
import * as LocalAuthentication from "expo-local-authentication";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import {
  Button as PaperButton,
  Dialog,
  Portal,
  RadioButton,
  Switch,
  Text,
  useTheme,
} from "react-native-paper";
import { Button, Card, ChipRow, Input, KeyValue, Muted, Row } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { requestPinWidget } from "react-native-android-widget";
import { getAuthClient } from "~/lib/auth";
import { requestNotificationPermission } from "~/lib/notifications";
import { createOrganization, getServerVersion, listOrganizations, type PapraOrganization } from "~/lib/papra";
import { countCachedDocuments, getMeta } from "~/lib/db";
import { countOfflineOnDisk } from "~/lib/sync";
import { getSettings, saveSettings, type Settings } from "~/lib/settings";
import {
  applySyncRegistration,
  ensureNoMedia,
  requestSyncPause,
  syncMetadata,
  syncNow,
  wipeOfflineFiles,
} from "~/lib/sync";
import { appVersion } from "~/lib/version";

const GRACE = [
  { label: "Immediately", value: 0 },
  { label: "1 min", value: 1 },
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "1 h", value: 60 },
];

const INTERVALS = [
  { label: "15 min", value: 15 },
  { label: "1 h", value: 60 },
  { label: "6 h", value: 360 },
  { label: "12 h", value: 720 },
  { label: "24 h", value: 1440 },
];

const RETENTION = [7, 14, 30, 60, 90].map((days) => ({ label: `${days} days`, value: days }));

const DATE_FORMATS: { label: string; value: Settings["dateFormat"] }[] = [
  { label: "System", value: "system" },
  { label: "DD/MM/YYYY", value: "dmy" },
  { label: "MM/DD/YYYY", value: "mdy" },
  { label: "YYYY-MM-DD", value: "ymd" },
];

export default function SettingsScreen() {
  const theme = useTheme<AppTheme>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [serverVersion, setServerVersion] = useState("");
  const lastSyncAt = getMeta("lastSyncAt");

  useEffect(() => {
    getServerVersion()
      .then(setServerVersion)
      .catch(() => {});
  }, []);

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

  const toggleSync = useCallback(
    (v: boolean) => {
      update({ syncEnabled: v }, true);
      if (v) return;
      const n = countCachedDocuments("", true);
      if (n === 0) return;
      Alert.alert(
        "Delete offline files?",
        `Sync is off. Also delete the ${n} offline copies on this phone (and their exported folder copies)? Documents on the server are not touched.`,
        [
          { text: "Keep files", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await wipeOfflineFiles(settings?.offlineExportDirUri ?? "");
                setProgress(""); // re-render; the counter reads the disk
                Alert.alert("Deleted", "All offline copies were removed from this phone.");
              } catch (e) {
                Alert.alert("Delete failed", e instanceof Error ? e.message : String(e));
              }
            },
          },
        ],
      );
    },
    [update, settings?.offlineExportDirUri],
  );

  const toggleNotification = useCallback(
    async (
      key:
        | "notifyNewDocuments"
        | "notifySyncFailures"
        | "notifySessionExpired"
        | "notifyTrashPurge"
        | "notifySyncProgress",
      value: boolean,
    ) => {
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
        // "Checked", not "downloaded": already-offline documents are skipped in
        // an instant, so this counter runs ahead of the offline count on purpose.
        onProgress: (done, total) => setProgress(`Checked ${done} of ${total}`),
      });
      setProgress(
        result.skipped
          ? `Skipped (${result.skipped})`
          : result.paused
            ? `Paused after ${result.downloaded} downloads. Sync now continues where it left off.`
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

  const pinWidget = useCallback(async (widgetName: "Scan" | "RecentDocuments") => {
    try {
      const accepted = await requestPinWidget({ widgetName });
      // true only means the launcher accepted the request; Android never
      // reports whether it actually placed the widget.
      Alert.alert(
        accepted ? "Request sent" : "Not supported",
        accepted
          ? "If nothing appeared on the home screen, the launcher blocked it. On Xiaomi, Redmi or POCO phones: Security app, Manage apps, Papra, Other permissions, allow Home screen shortcuts, then try again."
          : "This launcher does not allow apps to pin widgets. Add it from the launcher's own widget picker instead.",
      );
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    }
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
          <KeyValue label="Server version" value={serverVersion} />
          <KeyValue label="Organization" value={settings.organizationName || settings.organizationId} />
          <KeyValue label="Signed in as" value={settings.accountEmail || "unknown"} />
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
                <Input label="New organization" value={newOrgName} onChangeText={setNewOrgName} />
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
          <Switch value={settings.syncEnabled} onValueChange={toggleSync} />
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
            <ChipRow
              options={INTERVALS}
              value={settings.syncIntervalMinutes}
              onSelect={(minutes) => update({ syncIntervalMinutes: minutes }, true)}
            />
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
                  if (perm.granted) {
                    update({ offlineExportDirUri: perm.directoryUri });
                    ensureNoMedia(perm.directoryUri).catch(() => {});
                  }
                }}
              />
            </Row>
          </>
        )}

        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Button label="Sync now" kind="ghost" onPress={runSync} loading={syncing} />
          {syncing ? <Button label="Pause" kind="ghost" onPress={requestSyncPause} /> : null}
          {progress ? <Muted>{progress}</Muted> : null}
          <Muted>
            Offline: {countOfflineOnDisk()} of {countCachedDocuments()} documents on this phone
          </Muted>
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
            <ChipRow
              options={GRACE}
              value={settings.lockGraceMinutes}
              onSelect={(minutes) => update({ lockGraceMinutes: minutes })}
            />
          </>
        )}
      </Card>

      <Card>
        <Text variant="titleMedium">Trash retention</Text>
        <Muted>
          Days your Papra server keeps trashed documents (its
          deletedDocumentsRetentionDays). The app can't read it, so set it to match; this only
          affects countdowns shown here, never the server.
        </Muted>
        <ChipRow
          style={{ marginTop: spacing.sm }}
          options={RETENTION}
          value={settings.trashRetentionDays}
          onSelect={(days) => update({ trashRetentionDays: days })}
        />
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
            [
              "notifySyncProgress",
              "Sync progress",
              "Ongoing progress notification while any sync runs; manual syncs also keep running when you leave the app",
            ],
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

      <Card>
        <Text variant="titleMedium">Home-screen widgets</Text>
        <Muted>
          Adds the widget through the app. Use this when your launcher's widget picker won't place
          them.
        </Muted>
        <Row style={{ marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Scan button" kind="ghost" onPress={() => pinWidget("Scan")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Recent documents" kind="ghost" onPress={() => pinWidget("RecentDocuments")} />
          </View>
        </Row>
      </Card>

      <Card>
        <Text variant="titleMedium">Date format</Text>
        <Muted>How dates are shown everywhere in the app.</Muted>
        <ChipRow
          style={{ marginTop: spacing.sm }}
          options={DATE_FORMATS}
          value={settings.dateFormat}
          onSelect={(dateFormat) => update({ dateFormat })}
        />
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium">Update check</Text>
            <Muted>
              Asks GitHub for a newer release on app start, once per version. Keep off if Obtainium
              or another store manages updates.
            </Muted>
          </View>
          <Switch
            value={settings.updateCheckEnabled}
            onValueChange={(v: boolean) => update({ updateCheckEnabled: v })}
          />
        </Row>
      </Card>

      <View style={{ alignItems: "center" }}>
        <Muted>Papra Android v{appVersion()}</Muted>
      </View>
    </ScrollView>
  );
}
