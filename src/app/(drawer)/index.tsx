import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Card, IconButton, Text, useTheme } from "react-native-paper";
import { Input, Muted, Row, TagChip, formatBytes, formatDate } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { countCachedDocuments, getCachedDocument, listCachedDocuments, type CachedDocument } from "../../lib/db";
import { listDocuments } from "../../lib/papra";
import { getSettings, isConnected } from "../../lib/settings";
import { syncMetadata, upsertFromSearch } from "../../lib/screens-helpers";

export default function DocumentsScreen() {
  const theme = useTheme<AppTheme>();
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<CachedDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);

  // Paged reads from the cache — never the whole library at once.
  const PAGE = 30;
  const [total, setTotal] = useState(0);

  const loadLocal = useCallback((q: string) => {
    setDocs(listCachedDocuments(q, PAGE, 0));
    setTotal(countCachedDocuments(q));
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
        if (countCachedDocuments() === 0) {
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

  /**
   * Server search, Papra grammar (AND/OR/NOT, -term, "phrases", tag:/name:/
   * content:/created:/date:/has: filters). Debounced while typing; brief
   * pages of 25, more on scroll. Offline falls back to the local name match
   * already on screen.
   */
  const SEARCH_PAGE = 25;
  const [serverMode, setServerMode] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runServerSearch = useCallback(async (q: string, pageIndex = 0) => {
    try {
      const { documents, documentsCount } = await listDocuments({ searchQuery: q, pageIndex, pageSize: SEARCH_PAGE });
      upsertFromSearch(documents);
      // Re-read through the cache so rows carry offline state, server order kept.
      const found = documents.map((d) => getCachedDocument(d.id)).filter((d): d is CachedDocument => d !== null);
      setDocs((prev) => (pageIndex === 0 ? found : [...prev, ...found]));
      setTotal(documentsCount);
      setServerMode(true);
    } catch {
      setServerMode(false); // offline — the instant local results stay
    }
  }, []);

  const onSearchChange = useCallback(
    (t: string) => {
      setSearch(t);
      setServerMode(false);
      loadLocal(t); // instant local hits while the server round-trip runs
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (t.trim()) debounceRef.current = setTimeout(() => runServerSearch(t.trim()), 350);
    },
    [loadLocal, runServerSearch],
  );

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const loadMore = useCallback(() => {
    if (serverMode) {
      if (docs.length < total) runServerSearch(search.trim(), Math.floor(docs.length / SEARCH_PAGE));
      return;
    }
    setDocs((prev) => {
      if (prev.length >= total) return prev;
      return [...prev, ...listCachedDocuments(search, PAGE, prev.length)];
    });
  }, [serverMode, docs.length, search, total, runServerSearch]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Input
          placeholder={'Search — tag:invoice, NOT draft, "phrase"'}
          value={search}
          onChangeText={onSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={<Muted>No documents. Pull to refresh.</Muted>}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          docs.length > 0 ? (
            <Muted>
              {docs.length < total ? `${docs.length} of ${total}` : `${total} document${total === 1 ? "" : "s"}`}
              {serverMode ? " · server search" : ""}
            </Muted>
          ) : null
        }
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
