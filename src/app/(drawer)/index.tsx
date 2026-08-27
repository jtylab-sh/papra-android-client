import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, RefreshControl, ScrollView, View } from "react-native";
import {
  Button as PaperButton,
  Chip,
  Dialog,
  FAB,
  IconButton,
  Portal,
  Searchbar,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { DocumentRow } from "../../components/document-row";
import { Muted } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { countCachedDocuments, getCachedDocument, listCachedDocuments, type CachedDocument } from "../../lib/db";
import {
  batchTrashDocuments,
  createDocumentView,
  deleteDocumentView,
  listDocumentViews,
  listDocuments,
  type PapraDocumentView,
} from "../../lib/papra";
import { pickFiles, scanDocuments } from "../../lib/pickers";
import { getSettings, isConnected } from "../../lib/settings";
import { syncMetadata, upsertFromSearch } from "../../lib/screens-helpers";
import { ensureLocalFile } from "../../lib/sync";

export default function DocumentsScreen() {
  const theme = useTheme<AppTheme>();
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<CachedDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);

  // Paged reads from the cache — never the whole library at once.
  const PAGE = 30;
  const [total, setTotal] = useState(0);
  // Filter: only documents whose blob is not on the phone yet (local-only view).
  const [notSynced, setNotSynced] = useState(false);

  const loadLocal = useCallback(
    (q: string, unsyncedOnly = notSynced) => {
      setDocs(listCachedDocuments(q, PAGE, 0, unsyncedOnly ? false : undefined));
      setTotal(countCachedDocuments(q, unsyncedOnly ? false : undefined));
    },
    [notSynced],
  );

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
        listDocumentViews()
          .then((v) => active && setViews(v))
          .catch(() => {});
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
      // The not-synced filter is a purely local view — no server round-trip.
      if (t.trim() && !notSynced) debounceRef.current = setTimeout(() => runServerSearch(t.trim()), 350);
    },
    [loadLocal, runServerSearch, notSynced],
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
      return [...prev, ...listCachedDocuments(search, PAGE, prev.length, notSynced ? false : undefined)];
    });
  }, [serverMode, docs.length, search, total, runServerSearch, notSynced]);

  const [fabOpen, setFabOpen] = useState(false);

  // --- views (saved searches, like the Papra sidebar) ---
  const [views, setViews] = useState<PapraDocumentView[]>([]);
  const [viewName, setViewName] = useState<string | null>(null); // non-null = save dialog open
  const [savingView, setSavingView] = useState(false);

  const saveView = useCallback(async () => {
    const name = viewName?.trim();
    const query = search.trim();
    if (!name || !query) return;
    setSavingView(true);
    try {
      const created = await createDocumentView({ name, query });
      setViews((prev) => [...prev, created]);
      setViewName(null);
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setSavingView(false);
    }
  }, [viewName, search]);

  const confirmDeleteView = useCallback((view: PapraDocumentView) => {
    Alert.alert("Delete view?", `"${view.name}": the saved search is removed; documents are untouched.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDocumentView(view.id);
            setViews((prev) => prev.filter((v) => v.id !== view.id));
          } catch (e) {
            Alert.alert("Failed", e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  }, []);

  // --- multi-select (long press) ---
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [massProgress, setMassProgress] = useState("");

  const toggleSelect = useCallback((docId: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next.size === 0 ? null : next;
    });
  }, []);

  const massDownload = useCallback(async () => {
    const ids = [...(selected ?? [])];
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      setMassProgress(`Downloading ${i + 1}/${ids.length}`);
      try {
        await ensureLocalFile(ids[i]);
      } catch {
        failed++;
      }
    }
    setMassProgress("");
    setSelected(null);
    loadLocal(search);
    if (failed) Alert.alert("Partial", `${failed} of ${ids.length} downloads failed.`);
  }, [selected, search, loadLocal]);

  const massTrash = useCallback(() => {
    const ids = [...(selected ?? [])];
    Alert.alert(
      `Move ${ids.length} document${ids.length === 1 ? "" : "s"} to trash?`,
      "They stay in the trash for 30 days, then they are deleted permanently.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Trash",
          style: "destructive",
          onPress: async () => {
            try {
              setMassProgress("Trashing…");
              await batchTrashDocuments(ids);
              setSelected(null);
              await syncMetadata();
              loadLocal(search);
            } catch (e) {
              Alert.alert("Failed", e instanceof Error ? e.message : String(e));
            } finally {
              setMassProgress("");
            }
          },
        },
      ],
    );
  }, [selected, search, loadLocal]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {selected ? (
        <Surface elevation={2} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm }}>
          <IconButton icon="close" onPress={() => setSelected(null)} />
          <Text variant="titleSmall" style={{ flex: 1 }}>
            {massProgress || `${selected.size} selected`}
          </Text>
          <IconButton icon="cloud-download-outline" disabled={!!massProgress} onPress={massDownload} />
          <IconButton icon="trash-can-outline" disabled={!!massProgress} onPress={massTrash} />
        </Surface>
      ) : null}
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Searchbar
          placeholder="Search"
          value={search}
          onChangeText={onSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          traileringIcon={search.trim() ? "bookmark-plus-outline" : undefined}
          onTraileringIconPress={() => setViewName("")}
        />
        {!selected ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
            <Chip
              compact
              icon="cloud-off-outline"
              mode={notSynced ? "flat" : "outlined"}
              onPress={() => {
                const next = !notSynced;
                setNotSynced(next);
                setServerMode(false);
                loadLocal(search, next);
              }}
              style={{ marginRight: 6 }}
            >
              Not synced
            </Chip>
            {views.map((v) => (
              <Chip
                key={v.id}
                compact
                icon="bookmark-outline"
                mode={search.trim() === v.query ? "flat" : "outlined"}
                onPress={() => onSearchChange(v.query)}
                onLongPress={() => confirmDeleteView(v)}
                style={{ marginRight: 6 }}
              >
                {v.name}
              </Chip>
            ))}
          </ScrollView>
        ) : null}
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
        renderItem={({ item }) => (
          <DocumentRow
            doc={item}
            selected={selected?.has(item.id) ?? false}
            onPress={() => (selected ? toggleSelect(item.id) : router.push(`/document/${item.id}`))}
            onLongPress={() => toggleSelect(item.id)}
          />
        )}
      />
      <Portal>
        <FAB.Group
          open={fabOpen}
          visible={selected === null}
          icon={fabOpen ? "close" : "plus"}
          actions={[
            {
              icon: "line-scan",
              label: "Scan",
              // Native UI first; the upload page only opens with results, so
              // cancelling never leaves an empty page in the back stack.
              onPress: async () => {
                const files = await scanDocuments();
                if (files.length) router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
              },
            },
            {
              icon: "file-upload-outline",
              label: "Upload",
              onPress: async () => {
                const files = await pickFiles();
                if (files.length) router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
              },
            },
          ]}
          onStateChange={({ open }) => setFabOpen(open)}
        />
        <Dialog visible={viewName !== null} onDismiss={() => setViewName(null)}>
          <Dialog.Title>Save view</Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            <Muted>Saves the current search as a view: {search.trim()}</Muted>
            <TextInput
              mode="outlined"
              dense
              label="Name"
              value={viewName ?? ""}
              onChangeText={setViewName}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setViewName(null)}>Cancel</PaperButton>
            <PaperButton mode="contained" loading={savingView} disabled={!viewName?.trim()} onPress={saveView}>
              Save
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
