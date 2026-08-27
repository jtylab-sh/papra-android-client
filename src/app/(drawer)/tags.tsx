import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { Button, Dialog, FAB, IconButton, Portal, useTheme } from "react-native-paper";
import { Card, Input, Muted, Row, TagChip } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { useOnReconnect } from "~/lib/network";
import { createTag, deleteTag, listTags, updateTag, type PapraTag } from "~/lib/papra";

/** Papra's default tag palette-ish presets — server wants #RRGGBB. */
const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6",
  "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#78716c", "#64748b",
];

interface Draft {
  id?: string;
  name: string;
  color: string;
  description: string;
}

export default function TagsScreen() {
  const theme = useTheme<AppTheme>();
  const [tags, setTags] = useState<PapraTag[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setTags(await listTags());
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

  useOnReconnect(load);

  const save = useCallback(async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    try {
      const body = { name: draft.name.trim(), color: draft.color, description: draft.description.trim() };
      if (draft.id) await updateTag(draft.id, body);
      else await createTag(body);
      setDraft(null);
      await load();
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, load]);

  const confirmDelete = useCallback(
    (tag: PapraTag) => {
      Alert.alert("Delete tag?", `"${tag.name}" is removed from every document that carries it.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteTag(tag.id);
              setDraft(null);
              await load();
            } catch (e) {
              Alert.alert("Failed", e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]);
    },
    [load],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {error ? (
        <View style={{ padding: spacing.md }}>
          <Muted>Tags need the server: {error}</Muted>
        </View>
      ) : null}
      <FlatList
        data={tags}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={!error && !refreshing ? <Muted>No tags yet.</Muted> : null}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Row>
                  <TagChip name={item.name} color={item.color} />
                </Row>
                {item.description ? <Muted>{item.description}</Muted> : null}
              </View>
              <Row style={{ gap: 0 }}>
                <IconButton
                  icon="pencil-outline"
                  size={20}
                  onPress={() =>
                    setDraft({ id: item.id, name: item.name, color: item.color, description: item.description ?? "" })
                  }
                />
                <IconButton icon="trash-can-outline" size={20} onPress={() => confirmDelete(item)} />
              </Row>
            </Row>
          </Card>
        )}
      />
      <FAB
        icon="plus"
        style={{ position: "absolute", right: spacing.md, bottom: spacing.md }}
        onPress={() => setDraft({ name: "", color: COLORS[4], description: "" })}
      />
      <Portal>
        <Dialog visible={draft !== null} onDismiss={() => setDraft(null)}>
          <Dialog.Title>{draft?.id ? "Edit tag" : "New tag"}</Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            <Input
              label="Name"
              value={draft?.name ?? ""}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, name: t } : d))}
            />
            <Input
              label="Description (helps auto-tagging)"
              value={draft?.description ?? ""}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, description: t } : d))}
            />
            <Row style={{ flexWrap: "wrap", marginTop: spacing.sm }}>
              {COLORS.map((c) => (
                <IconButton
                  key={c}
                  icon={draft?.color === c ? "check-circle" : "circle"}
                  iconColor={c}
                  size={24}
                  style={{ margin: 0 }}
                  onPress={() => setDraft((d) => (d ? { ...d, color: c } : d))}
                />
              ))}
            </Row>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDraft(null)}>Cancel</Button>
            <Button mode="contained" loading={busy} disabled={!draft?.name.trim()} onPress={save}>
              {draft?.id ? "Save" : "Create"}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
