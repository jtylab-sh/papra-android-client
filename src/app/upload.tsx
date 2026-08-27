import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { Button, Card, Muted, Row } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { ApiError, uploadDocument } from "~/lib/papra";
import { enqueueUpload } from "~/lib/uploads";
import { pickFiles, scanDocuments } from "~/lib/pickers";
import { syncMetadata } from "~/lib/sync";

interface PendingFile {
  uri: string;
  name: string;
  mimeType?: string;
  status: "pending" | "uploading" | "done" | "failed" | "queued";
  error?: string;
}

export default function UploadScreen() {
  const theme = useTheme<AppTheme>();
  const params = useLocalSearchParams<{ files?: string; mode?: string }>();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async (): Promise<boolean> => {
    const picked = await pickFiles();
    if (!picked.length) return false;
    setFiles((prev) => [...prev, ...picked.map((f) => ({ ...f, status: "pending" as const }))]);
    return true;
  }, []);

  const scan = useCallback(async (): Promise<boolean> => {
    const picked = await scanDocuments();
    if (!picked.length) return false;
    setFiles((prev) => [...prev, ...picked.map((f) => ({ ...f, status: "pending" as const }))]);
    return true;
  }, []);

  useEffect(() => {
    if (params.files) {
      try {
        const shared = JSON.parse(params.files) as { uri: string; name?: string; mimeType?: string }[];
        setFiles(
          shared.map((f) => ({
            uri: f.uri.startsWith("file://") || f.uri.startsWith("content://") ? f.uri : `file://${f.uri}`,
            name: f.name || f.uri.split("/").pop() || "shared-file",
            mimeType: f.mimeType,
            status: "pending",
          })),
        );
      } catch {
        /* malformed share payload — user can still pick manually */
      }
    } else if (params.mode === "scan") {
      // Deep-link launch (Scan widget): open the scanner straight away, and
      // if the user cancels there, leave — never strand them on an empty page.
      scan().then((got) => {
        if (!got) router.back();
      });
    } else if (params.mode === "pick") {
      // Launcher shortcut: straight into the file picker.
      pick().then((got) => {
        if (!got) router.back();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = useCallback(async () => {
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "done" || files[i].status === "queued") continue;
      setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "uploading" } : f)));
      try {
        await uploadDocument(files[i]);
        setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "done" } : f)));
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          // Offline: park the file in the queue, it uploads on reconnect.
          await enqueueUpload(files[i]).catch(() => {});
          setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "queued" } : f)));
          continue;
        }
        setFiles((prev) =>
          prev.map((f, j) =>
            j === i ? { ...f, status: "failed", error: e instanceof Error ? e.message : String(e) } : f,
          ),
        );
      }
    }
    setBusy(false);
    syncMetadata().catch(() => {});
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
      <Stack.Screen options={{ title: "Upload" }} />
      <Row style={{ marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Button label="Pick files" kind="ghost" onPress={pick} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Scan" kind="ghost" onPress={scan} />
        </View>
      </Row>
      <FlatList
        data={files}
        keyExtractor={(f, i) => `${f.uri}-${i}`}
        ListEmptyComponent={<Muted>Nothing selected yet.</Muted>}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Text variant="bodyLarge" numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="bodySmall" style={{ color: statusColor[item.status], marginTop: 2 }}>
              {item.status === "queued" ? "queued - uploads when back online" : item.status}
              {item.error ? ` - ${item.error}` : ""}
            </Text>
          </Card>
        )}
      />
      {allDone ? (
        <Button label="Done" onPress={() => router.back()} />
      ) : (
        <Button label={`Upload ${files.filter((f) => f.status !== "done" && f.status !== "queued").length} file(s)`} onPress={upload} loading={busy} disabled={files.length === 0} />
      )}
    </View>
  );
}
