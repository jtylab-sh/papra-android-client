import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { Button, Card, Muted, Row, formatDate } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import {
  deleteDocumentForever,
  emptyTrash,
  listDeletedDocuments,
  restoreDocument,
  type PapraDocument,
} from "../../lib/papra";
import { getSettings } from "../../lib/settings";
import { syncMetadata } from "../../lib/sync";

function retentionSuffix(deletedAt: string | null | undefined, retentionDays: number) {
  if (!deletedAt) return "";
  const purgeAt = new Date(deletedAt).getTime() + retentionDays * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000));
  return daysLeft <= 0 ? " · purge imminent" : ` · gone in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export default function TrashScreen() {
  const theme = useTheme<AppTheme>();
  const [docs, setDocs] = useState<PapraDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // Mirrors the server's retention config (Settings); display-only.
  const [retentionDays, setRetentionDays] = useState(30);

  useEffect(() => {
    getSettings().then((s) => setRetentionDays(s.trashRetentionDays));
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const all: PapraDocument[] = [];
      for (let pageIndex = 0; ; pageIndex++) {
        const { documents, documentsCount } = await listDeletedDocuments({ pageIndex });
        all.push(...documents);
        if (documents.length < 100 || all.length >= documentsCount) break;
      }
      setDocs(all);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
        await load();
        syncMetadata().catch(() => {});
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : String(e));
      }
    },
    [load],
  );

  const confirmEmpty = () =>
    Alert.alert(
      "Empty trash?",
      `All ${docs.length} trashed document${docs.length === 1 ? "" : "s"} are deleted forever. Documents otherwise auto-delete after ${retentionDays} days.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Empty trash", style: "destructive", onPress: () => act(emptyTrash) },
      ],
    );

  const confirmDeleteForever = (doc: PapraDocument) =>
    Alert.alert(
      "Delete forever?",
      `${doc.name}\n\nThis is permanent and cannot be undone. Documents otherwise auto-delete after ${retentionDays} days.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => act(() => deleteDocumentForever(doc.id)) },
      ],
    );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {error ? (
        <View style={{ padding: spacing.md }}>
          <Muted>Trash needs the server: {error}</Muted>
        </View>
      ) : null}
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.primary} />}
        ListEmptyComponent={!error ? <Muted>Trash is empty.</Muted> : null}
        ListHeaderComponent={
          docs.length > 0 ? (
            <View style={{ marginBottom: spacing.md }}>
              <Button label="Empty trash" kind="danger" onPress={confirmEmpty} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Text variant="titleSmall" numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginVertical: 6 }}>
              deleted {formatDate(item.deletedAt ?? "")}
              {retentionSuffix(item.deletedAt, retentionDays)}
            </Text>
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="Restore" kind="ghost" onPress={() => act(() => restoreDocument(item.id))} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Delete forever" kind="danger" onPress={() => confirmDeleteForever(item)} />
              </View>
            </Row>
          </Card>
        )}
      />
    </View>
  );
}
