import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, View } from "react-native";
import { ActivityIndicator, Button as PaperButton, Dialog, IconButton, Portal, Text, useTheme } from "react-native-paper";
import { Button, Card, Input, Muted, Row } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { requestNotificationPermission } from "~/lib/notifications";
import { enqueueUpload, flushUploads, removeQueuedUpload } from "~/lib/uploads";
import { pickFiles, scanDocuments } from "~/lib/pickers";

interface PendingFile {
  uri: string;
  name: string;
  mimeType?: string;
  status: "pending" | "uploading" | "done" | "failed" | "queued";
  error?: string;
  /** Queue entry backing this row once the upload has started. */
  key?: string;
}

export default function UploadScreen() {
  const theme = useTheme<AppTheme>();
  const params = useLocalSearchParams<{ files?: string; mode?: string }>();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rename, setRename] = useState<{ uri: string; text: string } | null>(null);
  // Set to a row's uri when cancelling its name prompt should discard the
  // scan and leave (deep-linked scans, per the scanner-cancel behavior).
  const scanCancel = useRef<string | null>(null);

  // Deep links (widget, quick action) can land here with no history.
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.navigate("/");
  }, []);

  const saveRename = useCallback(() => {
    if (!rename) return;
    scanCancel.current = null;
    setFiles((prev) =>
      prev.map((f) => {
        if (f.uri !== rename.uri) return f;
        let name = rename.text.trim();
        if (!name) return f;
        // Keep the original extension when the new name has none.
        const dot = f.name.lastIndexOf(".");
        if (!name.includes(".") && dot > 0) name += f.name.slice(dot);
        return { ...f, name };
      }),
    );
    setRename(null);
  }, [rename]);

  const cancelRename = useCallback(() => {
    const uri = rename?.uri;
    setRename(null);
    if (uri && scanCancel.current === uri) {
      scanCancel.current = null;
      setFiles((prev) => prev.filter((f) => f.uri !== uri));
      leave();
    }
  }, [rename, leave]);

  const pick = useCallback(async (): Promise<boolean> => {
    const picked = await pickFiles();
    if (!picked.length) return false;
    setFiles((prev) => [...prev, ...picked.map((f) => ({ ...f, status: "pending" as const }))]);
    return true;
  }, []);

  const scan = useCallback(async (leaveOnCancel = false): Promise<boolean> => {
    // The PDF merge after the scanner closes takes a moment; the indicator
    // is invisible behind the native scanner and shows only during it.
    setGenerating(true);
    let picked: Awaited<ReturnType<typeof scanDocuments>>;
    try {
      picked = await scanDocuments(); // one merged PDF per scan session
    } finally {
      setGenerating(false);
    }
    if (!picked.length) return false;
    const row = { ...picked[0], status: "pending" as const };
    setFiles((prev) => [...prev, row]);
    // Scans get their name prompt right away, prefilled with the default.
    scanCancel.current = leaveOnCancel ? row.uri : null;
    setRename({ uri: row.uri, text: row.name });
    return true;
  }, []);

  // Drawer screens stay mounted, so params must be consumed on every change,
  // not only on mount - and delivered files append instead of replacing.
  useEffect(() => {
    if (params.files) {
      router.setParams({ files: "" });
      try {
        const shared = JSON.parse(params.files) as { uri: string; name?: string; mimeType?: string }[];
        setFiles((prev) => [
          ...prev,
          ...shared.map((f) => ({
            uri: f.uri.startsWith("file://") || f.uri.startsWith("content://") ? f.uri : `file://${f.uri}`,
            name: f.name || f.uri.split("/").pop() || "shared-file",
            mimeType: f.mimeType,
            status: "pending" as const,
          })),
        ]);
      } catch {
        /* malformed share payload — user can still pick manually */
      }
    } else if (params.mode === "scan") {
      // Deep-link launch (Scan widget): open the scanner straight away, and
      // if the user cancels there or at the name prompt, leave — never
      // strand them on an empty page.
      router.setParams({ mode: "" });
      scan(true).then((got) => {
        if (!got) leave();
      });
    } else if (params.mode === "pick") {
      // Launcher shortcut: straight into the file picker.
      router.setParams({ mode: "" });
      pick().then((got) => {
        if (!got) leave();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.files, params.mode]);

  const upload = useCallback(async () => {
    setBusy(true);
    // Android 13+ hides every notification until this is granted, and the
    // Settings toggles are opt-in - so the progress notification asks here,
    // on the first upload. Denying it never blocks the upload itself.
    await requestNotificationPermission().catch(() => {});
    // Every file goes through the on-disk queue first: the upload survives
    // app switches and kills (foreground flushes and the background task
    // drain the queue), and one notification shows batch progress.
    const staged: PendingFile[] = [];
    for (const f of files) {
      if (f.status === "done" || f.key) {
        staged.push(f);
        continue;
      }
      try {
        const key = await enqueueUpload(f);
        staged.push({ ...f, key, status: "uploading", error: undefined });
      } catch (e) {
        staged.push({ ...f, status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setFiles(staged);
    const result = await flushUploads();
    const sentKeys = new Set(result?.sentKeys ?? []);
    const dropped = new Map((result?.droppedKeys ?? []).map((d) => [d.key, d.message]));
    // Uploaded rows leave the list; failed and queued ones stay visible.
    setFiles((prev) =>
      prev
        .filter((f) => !(f.key && sentKeys.has(f.key)))
        .map((f) => {
          if (!f.key || f.status === "done") return f;
          // Dropped = the server refused it (4xx); its queue file is gone, so
          // clearing the key lets a retry re-enqueue the source file.
          if (dropped.has(f.key)) return { ...f, status: "failed", key: undefined, error: dropped.get(f.key) };
          return { ...f, status: "queued", error: result?.failedError ?? undefined };
        }),
    );
    setBusy(false);
    const uploaded = staged.filter((f) => f.key && sentKeys.has(f.key)).length;
    if (uploaded > 0) {
      Alert.alert("Upload complete", `${uploaded} document${uploaded === 1 ? "" : "s"} uploaded.`);
    }
  }, [files]);

  const removeFile = useCallback(
    (index: number) => {
      const f = files[index];
      if (f?.key && f.status !== "done") removeQueuedUpload(f.key).catch(() => {});
      setFiles((prev) => prev.filter((_, j) => j !== index));
    },
    [files],
  );

  const clearAll = useCallback(() => {
    for (const f of files) {
      if (f.key && f.status !== "done") removeQueuedUpload(f.key).catch(() => {});
    }
    setFiles([]);
  }, [files]);

  const allDone = files.length > 0 && files.every((f) => f.status === "done" || f.status === "queued");
  const statusColor = {
    pending: theme.colors.onSurfaceVariant,
    uploading: theme.colors.tertiary,
    done: theme.colors.primary,
    failed: theme.colors.error,
    queued: theme.colors.tertiary,
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: spacing.md }}>
      <Row style={{ marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Button label="Pick files" kind="ghost" onPress={pick} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Scan" kind="ghost" onPress={() => scan()} />
        </View>
      </Row>
      {generating ? (
        <Row style={{ marginBottom: spacing.sm }}>
          <ActivityIndicator size="small" />
          <Muted>Generating PDF…</Muted>
        </Row>
      ) : null}
      <FlatList
        data={files}
        keyExtractor={(f, i) => `${f.uri}-${i}`}
        ListEmptyComponent={<Muted>Nothing selected yet.</Muted>}
        renderItem={({ item, index }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Row>
              <Text variant="bodyLarge" numberOfLines={1} style={{ flex: 1 }}>
                {item.name}
              </Text>
              {item.status === "pending" ? (
                <IconButton
                  icon="pencil-outline"
                  size={16}
                  accessibilityLabel={`Rename ${item.name}`}
                  onPress={() => setRename({ uri: item.uri, text: item.name })}
                />
              ) : null}
              {item.status !== "uploading" ? (
                <IconButton
                  icon="close"
                  size={16}
                  accessibilityLabel={`Remove ${item.name}`}
                  onPress={() => removeFile(index)}
                />
              ) : null}
            </Row>
            <Text variant="bodySmall" style={{ color: statusColor[item.status], marginTop: 2 }}>
              {item.status === "queued" ? "queued - retries automatically" : item.status}
              {item.error ? ` - ${item.error}` : ""}
            </Text>
          </Card>
        )}
      />
      {files.length > 1 && !busy ? (
        <View style={{ marginBottom: spacing.sm }}>
          <Button label="Clear list" kind="ghost" onPress={clearAll} />
        </View>
      ) : null}
      <Portal>
        <Dialog visible={rename !== null} onDismiss={cancelRename}>
          <Dialog.Title>Document name</Dialog.Title>
          <Dialog.Content>
            <Input label="Name" value={rename?.text ?? ""} onChangeText={(t) => setRename((r) => (r ? { ...r, text: t } : r))} autoFocus />
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={cancelRename}>Cancel</PaperButton>
            <PaperButton mode="contained" disabled={!rename?.text.trim()} onPress={saveRename}>
              Save
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {allDone ? (
        <Button label="Done" onPress={() => router.navigate("/documents")} />
      ) : (
        <Button
          label={`Upload ${files.filter((f) => f.status !== "done" && f.status !== "queued").length} file(s)`}
          onPress={upload}
          loading={busy}
          disabled={files.length === 0 || busy}
        />
      )}
    </View>
  );
}
