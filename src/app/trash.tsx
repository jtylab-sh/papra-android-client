import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";
import { Button, Muted, Row, formatDate } from "../components/ui";
import { colors, spacing } from "../constants/theme";
import {
  deleteDocumentForever,
  emptyTrash,
  listDeletedDocuments,
  restoreDocument,
  type PapraDocument,
} from "../lib/papra";
import { syncMetadata } from "../lib/sync";

export default function TrashScreen() {
  const [docs, setDocs] = useState<PapraDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

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
    Alert.alert("Empty trash?", "Every trashed document is deleted forever.", [
      { text: "Cancel", style: "cancel" },
      { text: "Empty trash", style: "destructive", onPress: () => act(emptyTrash) },
    ]);

  const confirmDeleteForever = (doc: PapraDocument) =>
    Alert.alert("Delete forever?", doc.name, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => act(() => deleteDocumentForever(doc.id)) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Trash" }} />
      {error ? (
        <View style={{ padding: spacing.md }}>
          <Muted>Trash needs the server: {error}</Muted>
        </View>
      ) : null}
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={!error ? <Muted>Trash is empty.</Muted> : null}
        ListHeaderComponent={
          docs.length > 0 ? (
            <View style={{ marginBottom: spacing.md }}>
              <Button label="Empty trash" kind="danger" onPress={confirmEmpty} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.sm,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "600" }} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginVertical: 6 }}>
              deleted {formatDate(item.deletedAt ?? "")}
            </Text>
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="Restore" kind="ghost" onPress={() => act(() => restoreDocument(item.id))} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Delete forever" kind="danger" onPress={() => confirmDeleteForever(item)} />
              </View>
            </Row>
          </View>
        )}
      />
    </View>
  );
}
