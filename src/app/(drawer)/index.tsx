import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Alert, BackHandler, FlatList, RefreshControl, ScrollView, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Share from "react-native-share";
import {
  Button as PaperButton,
  Chip,
  Dialog,
  FAB,
  IconButton,
  Menu,
  Portal,
  Searchbar,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { DocumentRow } from "../../components/document-row";
import { Input, Muted } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import {
  countCachedDocuments,
  getCachedDocument,
  listCachedDocuments,
  upsertDocuments,
  type CachedDocument,
} from "../../lib/db";
import {
  batchTagsDocuments,
  batchTrashDocuments,
  createDocumentView,
  deleteDocumentView,
  listDocumentViews,
  listDocuments,
  listTags,
  trashDocument,
  type PapraDocumentView,
  type PapraTag,
} from "../../lib/papra";
import { pickFiles, scanDocuments } from "../../lib/pickers";
import { isPrintCancel, printDocument } from "../../lib/print";
import { getSettings, isConnected } from "../../lib/settings";
import { ensureLocalFile, localFileNamedForUser, syncMetadata } from "../../lib/sync";

const SORTS = [
  { label: "Newest first", field: "createdAt", order: "desc" },
  { label: "Oldest first", field: "createdAt", order: "asc" },
  { label: "Name A-Z", field: "name", order: "asc" },
  { label: "Name Z-A", field: "name", order: "desc" },
  { label: "Recently updated", field: "updatedAt", order: "desc" },
] as const;

export default function DocumentsScreen() {
  const theme = useTheme<AppTheme>();
  // The FAB lives in a Portal and drawer screens stay mounted, so without
  // this it would float over every other page too.
  const isFocused = useIsFocused();
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<CachedDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);

  // Paged reads from the cache — never the whole library at once.
  const PAGE = 30;
  const [total, setTotal] = useState(0);
  // Filter: only documents whose blob is not on the phone yet (local-only view).
  const [notSynced, setNotSynced] = useState(false);
  const [sortIndex, setSortIndex] = useState(0);
  const [sortMenu, setSortMenu] = useState(false);

  const loadLocal = useCallback(
    (q: string, unsyncedOnly = notSynced, sort = SORTS[sortIndex]) => {
      setDocs(listCachedDocuments(q, PAGE, 0, unsyncedOnly ? false : undefined, sort));
      setTotal(countCachedDocuments(q, unsyncedOnly ? false : undefined));
    },
    [notSynced, sortIndex],
  );

  const applySort = useCallback(
    (i: number) => {
      setSortMenu(false);
      setSortIndex(i);
      setServerMode(false);
      loadLocal(search, notSynced, SORTS[i]);
    },
    [search, notSynced, loadLocal],
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
        listTags()
          .then((t) => active && setAllTags(t))
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
  // Ref keeps runServerSearch stable while still reading the current sort.
  const sortIndexRef = useRef(0);
  sortIndexRef.current = sortIndex;

  const runServerSearch = useCallback(async (q: string, pageIndex = 0) => {
    try {
      const sort = SORTS[sortIndexRef.current];
      const { documents, documentsCount } = await listDocuments({
        searchQuery: q,
        pageIndex,
        pageSize: SEARCH_PAGE,
        sortField: sort.field,
        sortOrder: sort.order,
      });
      upsertDocuments(documents);
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
      return [...prev, ...listCachedDocuments(search, PAGE, prev.length, notSynced ? false : undefined, SORTS[sortIndex])];
    });
  }, [serverMode, docs.length, search, total, runServerSearch, notSynced, sortIndex]);

  const [fabOpen, setFabOpen] = useState(false);

  const startScan = useCallback(async () => {
    // Native UI first; the upload page only opens with results, so cancelling
    // never leaves an empty page in the back stack.
    const files = await scanDocuments();
    if (files.length) router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
  }, []);

  const startUpload = useCallback(async () => {
    const files = await pickFiles();
    if (files.length) router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
  }, []);

  // --- swipe actions on rows ---
  const swipeDownload = useCallback(
    async (docId: string) => {
      try {
        await ensureLocalFile(docId);
        loadLocal(search);
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : String(e));
      }
    },
    [search, loadLocal],
  );

  const swipeTrash = useCallback(
    (docId: string) => {
      const name = getCachedDocument(docId)?.name ?? "";
      Alert.alert("Move to trash?", `${name}\n\nIt stays in the trash for 30 days, then it is deleted permanently.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Trash",
          style: "destructive",
          onPress: async () => {
            try {
              await trashDocument(docId);
              await syncMetadata();
              loadLocal(search);
            } catch (e) {
              Alert.alert("Failed", e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]);
    },
    [search, loadLocal],
  );

  // --- tags: filter chips + batch add/remove in multi-select ---
  const [allTags, setAllTags] = useState<PapraTag[]>([]);
  const [tagEdit, setTagEdit] = useState<{ add: Set<string>; remove: Set<string> } | null>(null);
  const [tagBusy, setTagBusy] = useState(false);

  const openTagEdit = useCallback(async () => {
    if (allTags.length === 0) {
      try {
        setAllTags(await listTags());
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setTagEdit({ add: new Set(), remove: new Set() });
  }, [allTags.length]);

  const cycleTag = useCallback((tagId: string) => {
    setTagEdit((prev) => {
      if (!prev) return prev;
      const add = new Set(prev.add);
      const remove = new Set(prev.remove);
      if (add.has(tagId)) {
        add.delete(tagId);
        remove.add(tagId);
      } else if (remove.has(tagId)) {
        remove.delete(tagId);
      } else {
        add.add(tagId);
      }
      return { add, remove };
    });
  }, []);

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

  // The hardware/gesture back button leaves selection mode instead of the screen.
  useEffect(() => {
    if (selected === null) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selected]);

  /**
   * Everything in the current filter (local mode) or everything loaded (server
   * search). Pressing again with everything already selected deselects all.
   */
  const selectAll = useCallback(() => {
    const ids = serverMode
      ? docs.map((d) => d.id)
      : listCachedDocuments(search, -1, 0, notSynced ? false : undefined).map((d) => d.id);
    setSelected((prev) => (prev && prev.size === ids.length ? null : ids.length ? new Set(ids) : null));
  }, [serverMode, docs, search, notSynced]);

  const massShare = useCallback(async () => {
    const ids = [...(selected ?? [])];
    try {
      const urls: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        setMassProgress(`Preparing ${i + 1}/${ids.length}`);
        urls.push(await localFileNamedForUser(ids[i]));
      }
      setMassProgress("");
      await Share.open({ urls });
      setSelected(null);
    } catch (e) {
      // Dismissing the share sheet rejects too; only real failures matter.
      const message = e instanceof Error ? e.message : String(e);
      if (!/did not share|cancel/i.test(message)) Alert.alert("Failed", message);
    } finally {
      setMassProgress("");
    }
  }, [selected]);

  const applyTagEdit = useCallback(async () => {
    const ids = [...(selected ?? [])];
    if (!tagEdit || ids.length === 0) return;
    setTagBusy(true);
    try {
      await batchTagsDocuments(ids, [...tagEdit.add], [...tagEdit.remove]);
      setTagEdit(null);
      setSelected(null);
      await syncMetadata();
      loadLocal(search);
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setTagBusy(false);
    }
  }, [selected, tagEdit, search, loadLocal]);

  const massPrint = useCallback(async () => {
    const ids = [...(selected ?? [])];
    for (let i = 0; i < ids.length; i++) {
      setMassProgress(`Printing ${i + 1}/${ids.length}`);
      try {
        await printDocument(ids[i]);
      } catch (e) {
        if (!isPrintCancel(e)) Alert.alert("Failed", e instanceof Error ? e.message : String(e));
        break; // cancel or error: stop the queue, keep the selection
      }
    }
    setMassProgress("");
  }, [selected]);

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
          <IconButton icon="select-all" disabled={!!massProgress} onPress={selectAll} />
          <IconButton icon="tag-multiple-outline" disabled={!!massProgress} onPress={openTagEdit} />
          <IconButton icon="share-variant-outline" disabled={!!massProgress} onPress={massShare} />
          <IconButton icon="printer-outline" disabled={!!massProgress} onPress={massPrint} />
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
            <Menu
              visible={sortMenu}
              onDismiss={() => setSortMenu(false)}
              anchor={
                <Chip compact icon="sort" mode="outlined" onPress={() => setSortMenu(true)} style={{ marginRight: 6 }}>
                  {SORTS[sortIndex].label}
                </Chip>
              }
            >
              {SORTS.map((s, i) => (
                <Menu.Item
                  key={s.label}
                  title={s.label}
                  trailingIcon={i === sortIndex ? "check" : undefined}
                  onPress={() => applySort(i)}
                />
              ))}
            </Menu>
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
                onPress={() => onSearchChange(search.trim() === v.query ? "" : v.query)}
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
        ListEmptyComponent={
          <View style={{ gap: spacing.md }}>
            <Muted>No documents yet. Pull to refresh, or add your first one.</Muted>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <PaperButton mode="outlined" icon="line-scan" onPress={startScan}>
                  Scan
                </PaperButton>
              </View>
              <View style={{ flex: 1 }}>
                <PaperButton mode="outlined" icon="file-upload-outline" onPress={startUpload}>
                  Upload
                </PaperButton>
              </View>
            </View>
          </View>
        }
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
          <SwipeableRow
            disabled={selected !== null}
            onDownload={() => swipeDownload(item.id)}
            onTrash={() => swipeTrash(item.id)}
          >
            <DocumentRow
              doc={item}
              selected={selected?.has(item.id) ?? false}
              onPress={() => (selected ? toggleSelect(item.id) : router.push(`/document/${item.id}`))}
              onLongPress={() => toggleSelect(item.id)}
            />
          </SwipeableRow>
        )}
      />
      <Portal>
        <FAB.Group
          open={fabOpen}
          visible={selected === null && isFocused}
          icon={fabOpen ? "close" : "tray-arrow-up"}
          actions={[
            { icon: "line-scan", label: "Scan", onPress: startScan },
            { icon: "file-upload-outline", label: "Upload", onPress: startUpload },
          ]}
          onStateChange={({ open }) => setFabOpen(open)}
        />
        <Dialog visible={tagEdit !== null} onDismiss={() => setTagEdit(null)}>
          <Dialog.Title>Tags for {selected?.size ?? 0} documents</Dialog.Title>
          <Dialog.Content>
            <Muted>Tap a tag to cycle: add, remove, leave unchanged.</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
              {allTags.map((t) => {
                const mode = tagEdit?.add.has(t.id) ? "add" : tagEdit?.remove.has(t.id) ? "remove" : "none";
                return (
                  <Chip
                    key={t.id}
                    compact
                    icon={mode === "add" ? "plus" : mode === "remove" ? "minus" : undefined}
                    mode={mode === "none" ? "outlined" : "flat"}
                    onPress={() => cycleTag(t.id)}
                    style={{ marginRight: 6, marginBottom: 6 }}
                  >
                    {t.name}
                  </Chip>
                );
              })}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setTagEdit(null)}>Cancel</PaperButton>
            <PaperButton
              mode="contained"
              loading={tagBusy}
              disabled={!tagEdit || (tagEdit.add.size === 0 && tagEdit.remove.size === 0)}
              onPress={applyTagEdit}
            >
              Apply
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={viewName !== null} onDismiss={() => setViewName(null)}>
          <Dialog.Title>Save view</Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            <Muted>Saves the current search as a view: {search.trim()}</Muted>
            <Input label="Name" value={viewName ?? ""} onChangeText={setViewName} autoFocus />
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

/** Swipe right = download offline, swipe left = trash. Disabled in selection mode. */
function SwipeableRow({
  disabled,
  onDownload,
  onTrash,
  children,
}: PropsWithChildren<{ disabled: boolean; onDownload: () => void; onTrash: () => void }>) {
  const theme = useTheme<AppTheme>();
  const swipeRef = useRef<SwipeableMethods>(null);
  if (disabled) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={60}
      rightThreshold={60}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <View style={{ justifyContent: "center", paddingHorizontal: 24 }}>
          <MaterialCommunityIcons name="cloud-download-outline" size={24} color={theme.colors.primary} />
        </View>
      )}
      renderRightActions={() => (
        <View style={{ justifyContent: "center", paddingHorizontal: 24, alignItems: "flex-end" }}>
          <MaterialCommunityIcons name="trash-can-outline" size={24} color={theme.colors.error} />
        </View>
      )}
      onSwipeableOpen={(direction) => {
        swipeRef.current?.close();
        if (direction === "left") onDownload();
        else onTrash();
      }}
    >
      <View style={{ backgroundColor: theme.colors.background }}>{children}</View>
    </ReanimatedSwipeable>
  );
}
