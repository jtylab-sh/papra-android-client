import * as FileSystemLegacy from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Button, Card, KeyValue, Muted, TagChip, formatBytes, formatDate } from "../../components/ui";
import { colors, spacing } from "../../constants/theme";
import { getCachedDocument, upsertDocuments, type CachedDocument } from "../../lib/db";
import { getDocument, trashDocument, type PapraDocument } from "../../lib/papra";
import { ensureLocalFile } from "../../lib/sync";

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cached, setCached] = useState<CachedDocument | null>(null);
  const [live, setLive] = useState<PapraDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
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

  const withFile = useCallback(
    async (label: string, action: (uri: string, mime: string) => Promise<void>) => {
      if (!id) return;
      setBusy(label);
      try {
        const uri = await ensureLocalFile(id);
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
    Alert.alert("Move to trash?", cached?.name ?? "", [
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
    ]);
  };

  if (!cached && !live) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.md }}>
        <Stack.Screen options={{ title: "Document" }} />
        <Muted>Loading…</Muted>
      </View>
    );
  }

  const doc = { ...cached, ...live } as Partial<PapraDocument> & Partial<CachedDocument>;
  const tags = live?.tags ?? cached?.tags ?? [];
  // Papra enriches documents with custom properties; shape is a map or list.
  const customProperties = (live as unknown as { customProperties?: unknown })?.customProperties;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      <Stack.Screen options={{ title: doc.name ?? "Document" }} />
      <Card>
        <KeyValue label="Name" value={doc.name ?? ""} />
        <KeyValue label="Original name" value={(doc.originalName as string) ?? ""} />
        <KeyValue label="Type" value={doc.mimeType ?? ""} />
        <KeyValue label="Size" value={formatBytes((doc.originalSize as number) ?? 0)} />
        <KeyValue label="Created" value={formatDate((doc.createdAt as string) ?? "")} />
        <KeyValue label="Updated" value={formatDate((doc.updatedAt as string) ?? "")} />
        <KeyValue label="SHA-256" value={(live?.originalSha256Hash as string) ?? cached?.sha256 ?? ""} />
        <KeyValue label="Offline copy" value={cached?.fileUri ? "yes" : "no"} />
        <KeyValue label="Id" value={doc.id ?? ""} />
      </Card>

      {tags.length > 0 && (
        <Card>
          <Muted>Tags</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
            {tags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
          </View>
        </Card>
      )}

      {customProperties != null && Object.keys(customProperties as object).length > 0 && (
        <Card>
          <Muted>Custom properties</Muted>
          <View style={{ marginTop: 8 }}>
            {Object.entries(customProperties as Record<string, unknown>).map(([k, v]) => (
              <KeyValue key={k} label={k} value={typeof v === "object" ? JSON.stringify(v) : String(v)} />
            ))}
          </View>
        </Card>
      )}

      {Boolean(live?.content) && (
        <Card>
          <Muted>Extracted content</Muted>
          <Text style={{ color: colors.text, marginTop: 8, fontSize: 13, lineHeight: 19 }} selectable>
            {live!.content}
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        <Button label="Open" onPress={open} loading={busy === "open"} />
        <Button label="Download / share" kind="ghost" onPress={share} loading={busy === "share"} />
        <Button label="Move to trash" kind="danger" onPress={trash} />
      </View>
    </ScrollView>
  );
}
