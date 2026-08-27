/**
 * Home: quick actions, organization statistics (server, cached numbers as
 * fallback offline) and the 20 most recent documents from the local mirror.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { DocumentRow } from "~/components/document-row";
import { Button, Card, Muted, Row, formatBytes } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { countCachedDocuments, listCachedDocuments, type CachedDocument } from "~/lib/db";
import { useOnReconnect } from "~/lib/network";
import { getDocumentsStatistics, type PapraOrgStats } from "~/lib/papra";
import { pickFiles, scanDocuments } from "~/lib/pickers";
import { getSettings, isConnected } from "~/lib/settings";
import { countOfflineOnDisk, syncMetadata } from "~/lib/sync";
import { countQueuedUploads } from "~/lib/uploads";

export default function HomeScreen() {
  const theme = useTheme<AppTheme>();
  const [ready, setReady] = useState(false);
  const [recent, setRecent] = useState<CachedDocument[]>([]);
  const [stats, setStats] = useState<PapraOrgStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queued, setQueued] = useState(0);

  const loadLocal = useCallback(() => {
    setRecent(listCachedDocuments("", 20, 0));
    countQueuedUploads().then(setQueued);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getSettings().then((s) => {
        if (!active) return;
        if (!isConnected(s)) {
          router.replace("/sign-in");
          return;
        }
        setReady(true);
        loadLocal();
        getDocumentsStatistics()
          .then((st) => active && setStats(st))
          .catch(() => {});
      });
      return () => {
        active = false;
      };
    }, [loadLocal]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncMetadata();
      setStats(await getDocumentsStatistics());
    } catch {
      /* offline - cached data stays */
    } finally {
      loadLocal();
      setRefreshing(false);
    }
  }, [loadLocal]);

  // Connectivity came back: refresh without waiting for a user action.
  useOnReconnect(refresh);

  const startScan = useCallback(async () => {
    const files = await scanDocuments();
    if (files.length) router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
  }, []);

  const startUpload = useCallback(async () => {
    const files = await pickFiles();
    if (files.length) router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: spacing.md }}
      data={recent}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Button label="Scan" onPress={startScan} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Upload" kind="ghost" onPress={startUpload} />
            </View>
          </Row>
          <Card>
            <Muted>This organization</Muted>
            <Row style={{ marginTop: spacing.sm, justifyContent: "space-around" }}>
              <Stat label="Documents" value={String(stats?.documentsCount ?? countCachedDocuments())} />
              <Stat label="Size" value={stats ? formatBytes(stats.documentsSize) : "-"} />
              <Stat label="In trash" value={stats ? String(stats.deletedDocumentsCount) : "-"} />
              <Stat label="Offline" value={String(countOfflineOnDisk())} />
              {queued > 0 ? <Stat label="Queued" value={String(queued)} /> : null}
            </Row>
          </Card>
          <Text variant="titleMedium">Recent documents</Text>
        </View>
      }
      ListEmptyComponent={<Muted>No documents yet. Scan or upload your first one.</Muted>}
      renderItem={({ item }) => <DocumentRow doc={item} onPress={() => router.push(`/document/${item.id}`)} />}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme<AppTheme>();
  return (
    <View style={{ alignItems: "center" }}>
      <Text variant="titleMedium">{value}</Text>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );
}
