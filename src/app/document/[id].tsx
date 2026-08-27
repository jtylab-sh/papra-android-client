import * as FileSystemLegacy from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Alert, Image, Linking, Pressable, ScrollView, ToastAndroid, View } from "react-native";
import {
  Button as PaperButton,
  Chip,
  Dialog,
  IconButton,
  List,
  Portal,
  Text,
  useTheme,
} from "react-native-paper";
import { MimeIcon } from "~/components/document-row";
import { Card, Input, KeyValue, Muted, Row, TagChip, formatBytes, formatDate } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { getCachedDocument, upsertDocuments, type CachedDocument } from "~/lib/db";
import { ImageViewer } from "~/components/image-viewer";
import {
  addTagToDocument,
  clearDocumentPropertyValue,
  getDocument,
  listCustomProperties,
  listTags,
  removeTagFromDocument,
  renameDocument,
  setDocumentPropertyValue,
  trashDocument,
  type PapraCustomProperty,
  type PapraDocument,
  type PapraTag,
} from "~/lib/papra";
import { useOnReconnect } from "~/lib/network";
import { getSettings, useDateFormat, type DateFormat } from "~/lib/settings";
import { isPrintCancel, printDocument } from "~/lib/print";
import { ensureLocalFile, localFileNamedForUser, removeLocalCopy } from "~/lib/sync";

export default function DocumentScreen() {
  const theme = useTheme<AppTheme>();
  const dateFormat = useDateFormat();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  // Deep links (papra://document/<id>) are attacker-supplied; only
  // server-shaped ids may reach API paths.
  const id = rawId && /^[A-Za-z0-9_-]+$/.test(rawId) ? rawId : "";
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

  useOnReconnect(reload);

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

  const openInWeb = useCallback(async () => {
    const s = await getSettings();
    if (!s.serverUrl || !id) return;
    await Linking.openURL(`${s.serverUrl}/organizations/${s.organizationId}/documents/${id}`).catch(() => {});
  }, [id]);

  const print = async () => {
    if (!id) return;
    setBusy("print");
    try {
      await printDocument(id);
    } catch (e) {
      if (!isPrintCancel(e)) Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const downloadOffline = async () => {
    if (!id) return;
    setBusy("download");
    try {
      await ensureLocalFile(id);
      setCached(getCachedDocument(id));
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // --- custom property value editing (text/number/date/boolean; selects and
  // relations need option/entity pickers and stay web-app territory) ---
  const [propEdit, setPropEdit] = useState<{ prop: PapraCustomProperty; defId: string; text: string } | null>(null);
  const [propBusy, setPropBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const openPropertyEditor = useCallback(async (prop: PapraCustomProperty) => {
    if (["select", "multi_select", "user_relation", "document_relation"].includes(prop.type)) {
      Alert.alert("Not editable here", "Select and relation properties are edited in the Papra web app.");
      return;
    }
    try {
      // The document carries the property's key; writes need the definition id.
      const defs = await listCustomProperties();
      const def = defs.find((d) => d.key === prop.key || d.id === prop.key);
      if (!def) throw new Error("Property definition not found.");
      const text = prop.value == null ? "" : prop.type === "date" ? String(prop.value).slice(0, 10) : String(prop.value);
      setPropEdit({ prop, defId: def.id, text });
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const finishPropEdit = useCallback(
    async (action: () => Promise<void>) => {
      setPropBusy(true);
      try {
        await action();
        setPropEdit(null);
        reload();
      } catch (e) {
        Alert.alert("Failed", e instanceof Error ? e.message : String(e));
      } finally {
        setPropBusy(false);
      }
    },
    [reload],
  );

  const savePropEdit = () => {
    if (!propEdit) return;
    const { prop, defId, text } = propEdit;
    finishPropEdit(async () => {
      let value: unknown = text.trim();
      if (prop.type === "number") {
        value = Number(text.trim());
        if (Number.isNaN(value)) throw new Error("Enter a number.");
      }
      if (prop.type === "date") {
        const d = new Date(text.trim());
        if (Number.isNaN(d.getTime())) throw new Error("Enter the date as YYYY-MM-DD.");
        value = d.toISOString();
      }
      await setDocumentPropertyValue(id!, defId, value);
    });
  };

  const removeOffline = () => {
    Alert.alert(
      "Remove offline copy?",
      "The document stays on the server. If offline sync is on, the next sync downloads it again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          onPress: () => {
            removeLocalCopy(id!);
            setCached(getCachedDocument(id!));
          },
        },
      ],
    );
  };

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
  // One entry per org-wide property definition (value null when unset) — all
  // shown, tappable to edit.
  const customProperties = (live?.customProperties ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);
  const isImage = (doc.mimeType ?? "").startsWith("image/") && Boolean(cached?.fileUri);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
    >
      <Stack.Screen
        options={{
          title: doc.name ?? "Document",
          headerRight: () => (
            <IconButton icon="open-in-new" accessibilityLabel="Open in the web app" onPress={openInWeb} />
          ),
        }}
      />
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        {isImage ? (
          <Pressable onPress={() => setViewerOpen(true)} style={{ width: "100%" }}>
            <Image
              source={{ uri: cached!.fileUri! }}
              style={{ width: "100%", height: 220, borderRadius: 16 }}
              resizeMode="cover"
            />
          </Pressable>
        ) : (
          <MimeIcon mimeType={doc.mimeType ?? ""} size={64} />
        )}
        {isImage ? (
          <ImageViewer uri={cached!.fileUri!} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
        ) : null}
        <Row style={{ justifyContent: "center" }}>
          <Text variant="titleLarge" style={{ flexShrink: 1, textAlign: "center" }}>
            {doc.name ?? ""}
          </Text>
          <IconButton icon="pencil-outline" size={18} onPress={() => setRenameValue(doc.name ?? "")} />
        </Row>
        <Muted>
          {formatDate((doc.createdAt as string) ?? "", dateFormat)}
          {doc.originalSize ? ` \u00b7 ${formatBytes(doc.originalSize as number)}` : ""}
        </Muted>
        <Row style={{ justifyContent: "center", gap: spacing.lg }}>
          <ActionIcon icon="open-in-app" label="Open" onPress={open} busy={busy === "open"} />
          <ActionIcon icon="share-variant-outline" label="Share" onPress={share} busy={busy === "share"} />
          <ActionIcon icon="printer-outline" label="Print" onPress={print} busy={busy === "print"} />
          {cached?.fileUri ? (
            <ActionIcon icon="cloud-check-outline" label="Offline" onPress={removeOffline} />
          ) : (
            <ActionIcon
              icon="cloud-off-outline"
              label="Download"
              onPress={downloadOffline}
              busy={busy === "download"}
            />
          )}
          <ActionIcon icon="trash-can-outline" label="Trash" onPress={trash} danger />
        </Row>
      </View>

      <Card>
        <Muted>Tags</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          {tags.map((t) => (
            <TagChip
              key={t.id}
              name={t.name}
              color={t.color}
              onClose={() => removeTag(t)}
              onPress={() =>
                router.push({
                  pathname: "/",
                  params: { q: /\s/.test(t.name) ? `tag:"${t.name}"` : `tag:${t.name}` },
                })
              }
            />
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
        <Dialog visible={propEdit !== null} onDismiss={() => setPropEdit(null)}>
          <Dialog.Title>{propEdit?.prop.name ?? "Property"}</Dialog.Title>
          <Dialog.Content style={{ gap: spacing.sm }}>
            {propEdit?.prop.type === "boolean" ? (
              <Muted>Set the value:</Muted>
            ) : (
              <Input
                label={propEdit?.prop.type === "date" ? "YYYY-MM-DD" : "Value"}
                keyboardType={propEdit?.prop.type === "number" ? "numeric" : "default"}
                value={propEdit?.text ?? ""}
                onChangeText={(t) => setPropEdit((p) => (p ? { ...p, text: t } : p))}
                autoFocus
              />
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton
              disabled={propBusy || propEdit?.prop.value == null}
              onPress={() => propEdit && finishPropEdit(() => clearDocumentPropertyValue(id!, propEdit.defId))}
            >
              Clear
            </PaperButton>
            <PaperButton onPress={() => setPropEdit(null)}>Cancel</PaperButton>
            {propEdit?.prop.type === "boolean" ? (
              <>
                <PaperButton
                  loading={propBusy}
                  onPress={() => propEdit && finishPropEdit(() => setDocumentPropertyValue(id!, propEdit.defId, false))}
                >
                  No
                </PaperButton>
                <PaperButton
                  mode="contained"
                  loading={propBusy}
                  onPress={() => propEdit && finishPropEdit(() => setDocumentPropertyValue(id!, propEdit.defId, true))}
                >
                  Yes
                </PaperButton>
              </>
            ) : (
              <PaperButton mode="contained" loading={propBusy} onPress={savePropEdit}>
                Save
              </PaperButton>
            )}
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={renameValue !== null} onDismiss={() => setRenameValue(null)}>
          <Dialog.Title>Rename document</Dialog.Title>
          <Dialog.Content>
            <Input label="Name" value={renameValue ?? ""} onChangeText={setRenameValue} autoFocus />
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
          <Muted>Properties (tap to edit)</Muted>
          <View style={{ marginTop: 8 }}>
            {customProperties.map((prop) => (
              <Pressable key={prop.key} onPress={() => openPropertyEditor(prop)}>
                <KeyValue
                  label={prop.name || prop.key}
                  value={prop.value == null || prop.value === "" ? "Not set" : formatPropertyValue(prop, dateFormat)}
                />
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {Boolean(live?.content) && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <List.Accordion title="Extracted text" left={(p) => <List.Icon {...p} icon="text-recognition" />}>
            <View style={{ alignItems: "flex-end", paddingRight: spacing.sm }}>
              <PaperButton
                icon="content-copy"
                compact
                onPress={() =>
                  Clipboard.setStringAsync(live?.content ?? "").then(() =>
                    ToastAndroid.show("Copied", ToastAndroid.SHORT),
                  )
                }
              >
                Copy
              </PaperButton>
            </View>
            <Text
              variant="bodySmall"
              style={{ paddingTop: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, lineHeight: 19 }}
              selectable
            >
              {live!.content}
            </Text>
          </List.Accordion>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <List.Accordion title="Details" left={(p) => <List.Icon {...p} icon="information-outline" />}>
          <View style={{ paddingTop: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
            <KeyValue label="Original name" value={(doc.originalName as string) ?? ""} />
            <KeyValue label="Type" value={doc.mimeType ?? ""} />
            <KeyValue label="Size" value={formatBytes((doc.originalSize as number) ?? 0)} />
            <KeyValue label="Created" value={formatDate((doc.createdAt as string) ?? "", dateFormat)} />
            <KeyValue label="Updated" value={formatDate((doc.updatedAt as string) ?? "", dateFormat)} />
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
function formatPropertyValue(prop: PapraCustomProperty, dateFormat: DateFormat): string {
  const { type, value } = prop;
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "date") return formatDate(String(value), dateFormat);
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
