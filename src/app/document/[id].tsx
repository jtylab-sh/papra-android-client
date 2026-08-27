import * as FileSystemLegacy from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, ScrollView, View } from "react-native";
import {
  Button as PaperButton,
  Chip,
  Dialog,
  IconButton,
  List,
  Portal,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { MimeIcon } from "../../components/document-row";
import { Card, KeyValue, Muted, Row, TagChip, formatBytes, formatDate } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { getCachedDocument, upsertDocuments, type CachedDocument } from "../../lib/db";
import {
  addTagToDocument,
  getDocument,
  listTags,
  removeTagFromDocument,
  renameDocument,
  trashDocument,
  type PapraCustomProperty,
  type PapraDocument,
  type PapraTag,
} from "../../lib/papra";
import { localFileNamedForUser } from "../../lib/sync";

export default function DocumentScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cached, setCached] = useState<CachedDocument | null>(null);
  const [live, setLive] = useState<PapraDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!id) return;
    setCached(getCachedDocument(id));
    getDocument(id)
      .then((doc) => {
        setLive(doc);
        upsertDocuments([doc]);
        setCached(getCachedDocument(id));
      })
      .catch(() => {
        /* offline — cached copy is the truth */
      });
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // --- tag editing (server required; buttons no-op offline with an alert) ---
  const [tagPicker, setTagPicker] = useState<PapraTag[] | null>(null);

  const openTagPicker = useCallback(async () => {
    try {
      const all = await listTags();
      const current = new Set((getCachedDocument(id!)?.tags ?? []).map((t) => t.id));
      setTagPicker(all.filter((t) => !current.has(t.id)));
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const addTag = useCallback(
    async (tag: PapraTag) => {
      setTagPicker(null);
      try {
        await addTagToDocument(id!, tag.id);
        reload();
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : String(e));
      }
    },
    [id, reload],
  );

  const removeTag = useCallback(
    (tag: PapraTag) => {
      removeTagFromDocument(id!, tag.id)
        .then(reload)
        .catch((e) => Alert.alert("Failed", e instanceof Error ? e.message : String(e)));
    },
    [id, reload],
  );

  // --- inline rename (PATCH /documents/:id) ---
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const saveRename = useCallback(async () => {
    const name = renameValue?.trim();
    if (!name) return;
    setRenaming(true);
    try {
      await renameDocument(id!, name);
      setRenameValue(null);
      reload();
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRenaming(false);
    }
  }, [id, renameValue, reload]);

  const withFile = useCallback(
    async (label: string, action: (uri: string, mime: string) => Promise<void>) => {
      if (!id) return;
      setBusy(label);
      try {
        const uri = await localFileNamedForUser(id);
        setCached(getCachedDocument(id));
        await action(uri, cached?.mimeType || "application/octet-stream");
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [id, cached?.mimeType],
  );

  const open = () =>
    withFile("open", async (uri, mime) => {
      const contentUri = await FileSystemLegacy.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: mime,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
    });

  const share = () =>
    withFile("share", async (uri, mime) => {
      await Sharing.shareAsync(uri, { mimeType: mime });
    });

  const trash = () => {
    Alert.alert(
      "Move to trash?",
      `${cached?.name ?? ""}\n\nIt stays in the trash for 30 days, then it is deleted permanently.`, // 30 = Papra server default (deletedDocumentsRetentionDays); not exposed via API
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Trash",
          style: "destructive",
          onPress: async () => {
            try {
              await trashDocument(id!);
              router.back();
            } catch (e) {
              Alert.alert("Failed", e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  if (!cached && !live) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: spacing.md }}>
        <Stack.Screen options={{ title: "Document" }} />
        <Muted>Loading…</Muted>
      </View>
    );
  }

  const doc = { ...cached, ...live } as Partial<PapraDocument> & Partial<CachedDocument>;
  const tags = live?.tags ?? cached?.tags ?? [];
  // One entry per org-wide property definition; only set values are shown.
  const customProperties = (live?.customProperties ?? [])
    .filter((prop) => prop.value !== null && prop.value !== undefined && prop.value !== "")
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const isImage = (doc.mimeType ?? "").startsWith("image/") && Boolean(cached?.fileUri);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
    >
      <Stack.Screen options={{ title: doc.name ?? "Document" }} />
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        {isImage ? (
          <Image
            source={{ uri: cached!.fileUri! }}
            style={{ width: "100%", height: 220, borderRadius: 16 }}
            resizeMode="cover"
          />
        ) : (
          <MimeIcon mimeType={doc.mimeType ?? ""} size={64} />
        )}
        <Row style={{ justifyContent: "center" }}>
          <Text variant="titleLarge" style={{ flexShrink: 1, textAlign: "center" }}>
            {doc.name ?? ""}
          </Text>
          <IconButton icon="pencil-outline" size={18} onPress={() => setRenameValue(doc.name ?? "")} />
        </Row>
        <Muted>
          {formatDate((doc.createdAt as string) ?? "")}
          {doc.originalSize ? ` \u00b7 ${formatBytes(doc.originalSize as number)}` : ""}
        </Muted>
        <Row style={{ justifyContent: "center", gap: spacing.lg }}>
          <ActionIcon icon="open-in-app" label="Open" onPress={open} busy={busy === "open"} />
          <ActionIcon icon="share-variant-outline" label="Share" onPress={share} busy={busy === "share"} />
          <ActionIcon icon="trash-can-outline" label="Trash" onPress={trash} danger />
        </Row>
      </View>

      <Card>
        <Muted>Tags</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          {tags.map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} onClose={() => removeTag(t)} />
          ))}
          <Chip icon="plus" compact mode="outlined" onPress={openTagPicker} style={{ marginRight: 6, marginBottom: 6 }}>
            Add tag
          </Chip>
        </View>
      </Card>

      <Portal>
        <Dialog visible={tagPicker !== null} onDismiss={() => setTagPicker(null)}>
          <Dialog.Title>Add tag</Dialog.Title>
          <Dialog.Content>
            {tagPicker?.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {tagPicker.map((t) => (
                  <Chip
                    key={t.id}
                    compact
                    mode="outlined"
                    onPress={() => addTag(t)}
                    style={{ marginRight: 6, marginBottom: 6, borderColor: t.color }}
                    textStyle={{ color: t.color }}
                  >
                    {t.name}
                  </Chip>
                ))}
              </View>
            ) : (
              <Muted>Every tag is already on this document. Create tags from the Tags page.</Muted>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setTagPicker(null)}>Close</PaperButton>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={renameValue !== null} onDismiss={() => setRenameValue(null)}>
          <Dialog.Title>Rename document</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              dense
              label="Name"
              value={renameValue ?? ""}
              onChangeText={setRenameValue}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setRenameValue(null)}>Cancel</PaperButton>
            <PaperButton mode="contained" loading={renaming} disabled={!renameValue?.trim()} onPress={saveRename}>
              Save
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {customProperties.length > 0 && (
        <Card>
          <Muted>Properties</Muted>
          <View style={{ marginTop: 8 }}>
            {customProperties.map((prop) => (
              <KeyValue key={prop.key} label={prop.name || prop.key} value={formatPropertyValue(prop)} />
            ))}
          </View>
        </Card>
      )}

      {Boolean(live?.content) && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <List.Accordion title="Extracted text" left={(p) => <List.Icon {...p} icon="text-recognition" />}>
            <Text
              variant="bodySmall"
              style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, lineHeight: 19 }}
              selectable
            >
              {live!.content}
            </Text>
          </List.Accordion>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <List.Accordion title="Details" left={(p) => <List.Icon {...p} icon="information-outline" />}>
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
            <KeyValue label="Original name" value={(doc.originalName as string) ?? ""} />
            <KeyValue label="Type" value={doc.mimeType ?? ""} />
            <KeyValue label="Size" value={formatBytes((doc.originalSize as number) ?? 0)} />
            <KeyValue label="Created" value={formatDate((doc.createdAt as string) ?? "")} />
            <KeyValue label="Updated" value={formatDate((doc.updatedAt as string) ?? "")} />
            <KeyValue label="SHA-256" value={(live?.originalSha256Hash as string) ?? cached?.sha256 ?? ""} />
            <KeyValue label="Offline copy" value={cached?.fileUri ? "yes" : "no"} />
            <KeyValue label="Id" value={doc.id ?? ""} />
          </View>
        </List.Accordion>
      </Card>
    </ScrollView>
  );
}

/** Papra-style value rendering per property type — never raw JSON. */
function formatPropertyValue(prop: PapraCustomProperty): string {
  const { type, value } = prop;
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "date") return formatDate(String(value));
  if (type === "multi_select" && Array.isArray(value)) return value.map(String).join(", ");
  if (type === "user_relation" && value && typeof value === "object") {
    const u = value as { name?: string; email?: string };
    return u.name || u.email || String(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ActionIcon({
  icon,
  label,
  onPress,
  busy,
  danger,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const theme = useTheme<AppTheme>();
  return (
    <View style={{ alignItems: "center" }}>
      <IconButton
        icon={icon}
        mode="contained-tonal"
        size={26}
        disabled={busy}
        iconColor={danger ? theme.colors.error : undefined}
        onPress={onPress}
      />
      <Text variant="labelSmall" style={{ color: danger ? theme.colors.error : theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );
}
