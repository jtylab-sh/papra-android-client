import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Card, IconButton, Text, useTheme } from "react-native-paper";
import { Input, Muted, Row, TagChip, formatBytes, formatDate } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { listCachedDocuments, type CachedDocument } from "../../lib/db";
import { listDocuments } from "../../lib/papra";
import { getSettings, isConnected } from "../../lib/settings";
import { syncMetadata, upsertFromSearch } from "../../lib/screens-helpers";

export default function DocumentsScreen() {
  const theme = useTheme<AppTheme>();
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<CachedDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);

  const loadLocal = useCallback((q: string) => {
    setDocs(listCachedDocuments(q));
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
        loadLocal(search);
        // First run: pull metadata so the list isn't empty.
        if (listCachedDocuments("").length === 0) {
          syncMetadata()
            .then(() => active && loadLocal(search))
            .catch(() => {});
        }
      });
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLocal]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncMetadata();
      loadLocal(search);
    } catch {
      /* offline — cached list stays */
    } finally {
      setRefreshing(false);
    }
  }, [loadLocal, search]);

  const serverSearch = useCallback(async () => {
    if (!search) return;
    try {
      const { documents } = await listDocuments({ searchQuery: search });
      upsertFromSearch(documents);
      // Show server results (content search included), newest first.
      const ids = new Set(documents.map((d) => d.id));
      setDocs(listCachedDocuments("").filter((d) => ids.has(d.id)));
    } catch {
      loadLocal(search);
    }
  }, [search, loadLocal]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Input
          placeholder="Search (submit to search server, incl. content)"
          value={search}
          onChangeText={(t) => {
            setSearch(t);
            loadLocal(t);
          }}
          onSubmitEditing={serverSearch}
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={<Muted>No documents. Pull to refresh.</Muted>}
        renderItem={({ item }) => <DocumentRow doc={item} />}
      />
    </View>
  );
}

function DocumentRow({ doc }: { doc: CachedDocument }) {
  const theme = useTheme<AppTheme>();
  return (
    <Card mode="contained" style={{ marginBottom: spacing.sm }} onPress={() => router.push(`/document/${doc.id}`)}>
      <Card.Content>
        <Text variant="titleSmall" numberOfLines={1}>
          {doc.name}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
          {formatDate(doc.createdAt)}
          {doc.originalSize ? `  ·  ${formatBytes(doc.originalSize)}` : ""}
          {doc.fileUri ? (
            <>
              {"  ·  "}
              <MaterialCommunityIcons name="cloud-check-outline" size={14} color={theme.colors.primary} />
            </>
          ) : null}
        </Text>
        {doc.tags.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
            {doc.tags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
          </View>
        )}
      </Card.Content>
    </Card>
  );
}
