import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Button, Input, Muted, Row, TagChip, formatBytes, formatDate } from "../components/ui";
import { colors, spacing } from "../constants/theme";
import { listCachedDocuments, type CachedDocument } from "../lib/db";
import { listDocuments } from "../lib/papra";
import { getSettings, isConnected } from "../lib/settings";
import { syncMetadata, upsertFromSearch } from "../lib/screens-helpers";

export default function DocumentsScreen() {
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

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: "Documents",
          headerRight: () => (
            <Row>
              <HeaderLink label="Scan" onPress={() => router.push({ pathname: "/upload", params: { mode: "scan" } })} />
              <HeaderLink label="Add" onPress={() => router.push({ pathname: "/upload", params: { mode: "pick" } })} />
              <HeaderLink label="Trash" onPress={() => router.push("/trash")} />
              <HeaderLink label="⚙" onPress={() => router.push("/settings")} />
            </Row>
          ),
        }}
      />
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={<Muted>No documents. Pull to refresh.</Muted>}
        renderItem={({ item }) => <DocumentRow doc={item} />}
      />
    </View>
  );
}

function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 6 }}>
      <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function DocumentRow({ doc }: { doc: CachedDocument }) {
  return (
    <Pressable
      onPress={() => router.push(`/document/${doc.id}`)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceHigh : colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.sm,
      })}
    >
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
        {doc.name}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
        {formatDate(doc.createdAt)}
        {doc.originalSize ? `  ·  ${formatBytes(doc.originalSize)}` : ""}
        {doc.fileUri ? "  ·  ● offline" : ""}
      </Text>
      {doc.tags.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
          {doc.tags.map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} />
          ))}
        </View>
      )}
    </Pressable>
  );
}
