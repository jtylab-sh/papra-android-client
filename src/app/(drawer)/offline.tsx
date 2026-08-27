import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Searchbar, useTheme } from "react-native-paper";
import { DocumentRow } from "../../components/document-row";
import { Button, Muted } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { countCachedDocuments, listCachedDocuments, type CachedDocument } from "../../lib/db";
import { syncMetadata } from "../../lib/sync";

export default function OfflineScreen() {
  const theme = useTheme<AppTheme>();
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<CachedDocument[]>([]);
  const [total, setTotal] = useState(0);

  const PAGE = 30;

  const loadLocal = useCallback((q: string) => {
    setDocs(listCachedDocuments(q, PAGE, 0, true));
    setTotal(countCachedDocuments(q, true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLocal(search);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLocal]),
  );

  const onSearchChange = useCallback(
    (t: string) => {
      setSearch(t);
      loadLocal(t);
    },
    [loadLocal],
  );

  const loadMore = useCallback(() => {
    setDocs((prev) => {
      if (prev.length >= total) return prev;
      return [...prev, ...listCachedDocuments(search, PAGE, prev.length, true)];
    });
  }, [search, total]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncMetadata();
    } catch {
      /* offline - the cached list stays */
    } finally {
      loadLocal(search);
      setRefreshing(false);
    }
  }, [search, loadLocal]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Searchbar
          placeholder="Search"
          value={search}
          onChangeText={onSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />}
        ListEmptyComponent={
          <View style={{ gap: spacing.md }}>
            <Muted>Nothing offline yet. Enable offline sync or download documents individually.</Muted>
            <Button label="Open sync settings" kind="ghost" onPress={() => router.push("/settings")} />
          </View>
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          docs.length > 0 ? (
            <Muted>{docs.length < total ? `${docs.length} of ${total}` : `${total} document${total === 1 ? "" : "s"}`}</Muted>
          ) : null
        }
        renderItem={({ item }) => <DocumentRow doc={item} onPress={() => router.push(`/document/${item.id}`)} />}
      />
    </View>
  );
}
