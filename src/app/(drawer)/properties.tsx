/**
 * Custom property definitions (org-wide), managed like the Tags page.
 * Type is chosen at creation and immutable after (server rule); select /
 * multi_select need at least one option. Values on documents are shown on the
 * document page; editing values is out of scope here.
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, View } from "react-native";
import { Button, Dialog, FAB, IconButton, Portal, Text, useTheme } from "react-native-paper";
import { Card, ChipRow, Input, Muted, Row } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import {
  createCustomProperty,
  deleteCustomProperty,
  listCustomProperties,
  updateCustomProperty,
  type PapraCustomPropertyDefinition,
} from "../../lib/papra";

/** Creatable types. Relation types need entity pickers and are left to the web app. */
const TYPES: { label: string; value: PapraCustomPropertyDefinition["type"] }[] = [
  { label: "Text", value: "text" },
  { label: "Number", value: "number" },
  { label: "Date", value: "date" },
  { label: "Yes / no", value: "boolean" },
  { label: "Select", value: "select" },
  { label: "Multi-select", value: "multi_select" },
];

function typeLabel(type: string): string {
  return TYPES.find((t) => t.value === type)?.label ?? type;
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  type: PapraCustomPropertyDefinition["type"];
  /** comma-separated option names; only for select / multi_select creation */
  options: string;
}

export default function PropertiesScreen() {
  const theme = useTheme<AppTheme>();
  const [defs, setDefs] = useState<PapraCustomPropertyDefinition[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setDefs(await listCustomProperties());
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

  const needsOptions = draft && !draft.id && (draft.type === "select" || draft.type === "multi_select");

  const save = useCallback(async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    try {
      if (draft.id) {
        await updateCustomProperty(draft.id, {
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
        });
      } else {
        const options = draft.options
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
          .map((name) => ({ name }));
        if ((draft.type === "select" || draft.type === "multi_select") && options.length === 0) {
          throw new Error("Select properties need at least one option (comma-separated).");
        }
        await createCustomProperty({
          type: draft.type,
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
          ...(options.length ? { options } : {}),
        });
      }
      setDraft(null);
      await load();
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, load]);

  const confirmDelete = useCallback(
    (def: PapraCustomPropertyDefinition) => {
      Alert.alert("Delete property?", `"${def.name}" and its values on every document are removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCustomProperty(def.id);
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
          <Muted>Properties need the server: {error}</Muted>
        </View>
      ) : null}
      <FlatList
        data={defs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={!error && !refreshing ? <Muted>No custom properties yet.</Muted> : null}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{item.name}</Text>
                <Muted>
                  {typeLabel(item.type)}
                  {item.description ? ` · ${item.description}` : ""}
                </Muted>
              </View>
              <Row style={{ gap: 0 }}>
                <IconButton
                  icon="pencil-outline"
                  size={20}
                  onPress={() =>
                    setDraft({
                      id: item.id,
                      name: item.name,
                      description: item.description ?? "",
                      type: item.type,
                      options: "",
                    })
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
        onPress={() => setDraft({ name: "", description: "", type: "text", options: "" })}
      />
      <Portal>
        <Dialog visible={draft !== null} onDismiss={() => setDraft(null)}>
          <Dialog.Title>{draft?.id ? "Edit property" : "New property"}</Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            <Input
              label="Name"
              value={draft?.name ?? ""}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, name: t } : d))}
            />
            <Input
              label="Description (optional)"
              value={draft?.description ?? ""}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, description: t } : d))}
            />
            {draft && !draft.id ? (
              <ChipRow
                options={TYPES}
                value={draft.type}
                onSelect={(type) => setDraft((d) => (d ? { ...d, type } : d))}
              />
            ) : (
              <Muted>Type: {typeLabel(draft?.type ?? "")} (fixed after creation)</Muted>
            )}
            {needsOptions ? (
              <Input
                label="Options (comma-separated)"
                value={draft?.options ?? ""}
                onChangeText={(t) => setDraft((d) => (d ? { ...d, options: t } : d))}
              />
            ) : null}
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
