/**
 * Home: quick actions, organization statistics (server, cached numbers as
 * fallback offline) and the 20 most recent documents from the local mirror.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, InteractionManager, Pressable, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, IconButton, Modal, Portal, Searchbar, Text, useTheme } from "react-native-paper";
import { DocumentRow } from "~/components/document-row";
import { Button, Card, Muted, Row, formatBytes } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { countCachedDocuments, getCachedDocument, listCachedDocuments, upsertDocuments, type CachedDocument } from "~/lib/db";
import { useOnReconnect } from "~/lib/network";
import { getDocumentsStatistics, listDocuments, type PapraOrgStats } from "~/lib/papra";
import { getSettings, isConnected } from "~/lib/settings";
import { countOfflineOnDisk, syncMetadata } from "~/lib/sync";
import { countQueuedUploads } from "~/lib/uploads";

export default function HomeScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [recent, setRecent] = useState<CachedDocument[]>([]);
  const [stats, setStats] = useState<PapraOrgStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queued, setQueued] = useState(0);
  const [booting, setBooting] = useState(true);

  // --- search modal: instant local hits, debounced server search on top ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CachedDocument[]>([]);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onQueryChange = useCallback((t: string) => {
    setQ(t);
    setResults(t.trim() ? listCachedDocuments(t, 25, 0) : []);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!t.trim()) return;
    searchDebounce.current = setTimeout(async () => {
      try {
        const { documents } = await listDocuments({
          searchQuery: t.trim(),
          pageIndex: 0,
          pageSize: 25,
          sortField: "createdAt",
          sortOrder: "desc",
        });
        upsertDocuments(documents);
        // Re-read through the cache so rows carry offline state.
        const found = documents.map((d) => getCachedDocument(d.id)).filter((d): d is CachedDocument => d !== null);
        setResults(found);
      } catch {
        /* offline - the instant local hits stay */
      }
    }, 350);
  }, []);

  useEffect(() => () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQ("");
    setResults([]);
  }, []);

  const loadLocal = useCallback(() => {
    setRecent(listCachedDocuments("", 20, 0));
    countQueuedUploads().then(setQueued);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // After the drawer-close animation, same reason as the documents page.
      const task = InteractionManager.runAfterInteractions(() => {
      getSettings().then((s) => {
        if (!active) return;
        if (!isConnected(s)) {
          router.replace("/sign-in");
          return;
        }
        setReady(true);
        loadLocal();
        // First run after sign-in: mirror the list before declaring "empty".
        if (countCachedDocuments() === 0) {
          syncMetadata()
            .catch(() => {})
            .finally(() => {
              if (active) {
                loadLocal();
                setBooting(false);
              }
            });
        } else {
          setBooting(false);
        }
        getDocumentsStatistics()
          .then((st) => active && setStats(st))
          .catch(() => {});
      });
      });
      return () => {
        active = false;
        task.cancel();
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

  const startScan = useCallback(() => {
    // The upload page owns the whole scan flow (PDF merge + name prompt).
    router.push({ pathname: "/upload", params: { mode: "scan" } });
  }, []);

  const startUpload = useCallback(() => {
    // Land on the upload page first; it opens the picker itself.
    router.push({ pathname: "/upload", params: { mode: "pick" } });
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <>
    <FlatList
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: spacing.md }}
      data={recent}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.primary} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
          <Pressable onPress={() => setSearchOpen(true)}>
            <View pointerEvents="none">
              <Searchbar placeholder="Search documents" value="" />
            </View>
          </Pressable>
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
              {queued > 0 ? (
                <Pressable onPress={() => router.push("/queue")}>
                  <Stat label="Queued" value={String(queued)} />
                </Pressable>
              ) : null}
            </Row>
          </Card>
          <Text variant="titleMedium">Recent documents</Text>
        </View>
      }
      ListEmptyComponent={
        booting ? (
          <ActivityIndicator style={{ marginTop: spacing.lg }} />
        ) : (
          <Muted>No documents yet. Scan or upload your first one.</Muted>
        )
      }
      renderItem={({ item }) => <DocumentRow doc={item} onPress={() => router.push(`/document/${item.id}`)} />}
    />
    <Portal>
      <Modal
        visible={searchOpen}
        onDismiss={closeSearch}
        // Full screen: the centered sheet resized with every keystroke and
        // keyboard bounce; a fixed surface has no layout shift.
        style={{ margin: 0, justifyContent: "flex-start" }}
        contentContainerStyle={{
          backgroundColor: theme.colors.background,
          flex: 1,
          padding: spacing.md,
          paddingTop: insets.top + spacing.sm,
        }}
      >
        <Row style={{ marginBottom: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Searchbar
              placeholder="Search documents"
              value={q}
              onChangeText={onQueryChange}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <IconButton icon="close" accessibilityLabel="Close search" onPress={closeSearch} />
        </Row>
        <FlatList
          data={results}
          keyExtractor={(d) => d.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            q.trim() ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Muted>0 results for this search.</Muted>
                <Button label="Clear search" kind="ghost" onPress={() => onQueryChange("")} />
              </View>
            ) : (
              <Muted>Search names, content and tags. Papra's query grammar works here too.</Muted>
            )
          }
          renderItem={({ item }) => (
            <DocumentRow
              doc={item}
              onPress={() => {
                closeSearch();
                router.push(`/document/${item.id}`);
              }}
            />
          )}
        />
      </Modal>
    </Portal>
    </>
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
