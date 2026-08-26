import * as DocumentPicker from "expo-document-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import DocumentScanner from "react-native-document-scanner-plugin";
import { Button, Muted, Row } from "../components/ui";
import { colors, spacing } from "../constants/theme";
import { uploadDocument } from "../lib/papra";
import { syncMetadata } from "../lib/sync";

interface PendingFile {
  uri: string;
  name: string;
  mimeType?: string;
  status: "pending" | "uploading" | "done" | "failed";
  error?: string;
}

export default function UploadScreen() {
  const params = useLocalSearchParams<{ files?: string; mode?: string }>();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    setFiles((prev) => [
      ...prev,
      ...result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType,
        status: "pending" as const,
      })),
    ]);
  }, []);

  const scan = useCallback(async () => {
    const { scannedImages, status } = await DocumentScanner.scanDocument();
    if (status !== "success" || !scannedImages?.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    setFiles((prev) => [
      ...prev,
      ...scannedImages.map((uri, i) => ({
        uri: uri.startsWith("file://") ? uri : `file://${uri}`,
        name: `scan-${stamp}${scannedImages.length > 1 ? `-${i + 1}` : ""}.jpg`,
        mimeType: "image/jpeg",
        status: "pending" as const,
      })),
    ]);
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
    } else if (params.mode === "pick") {
      pick();
    } else if (params.mode === "scan") {
      scan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = useCallback(async () => {
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === "done") continue;
      setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "uploading" } : f)));
      try {
        await uploadDocument(files[i]);
        setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, status: "done" } : f)));
      } catch (e) {
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

  const allDone = files.length > 0 && files.every((f) => f.status === "done");
  const statusColor = { pending: colors.textMuted, uploading: colors.warning, done: colors.primary, failed: colors.danger };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.md }}>
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
          <View
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 10,
              padding: spacing.md,
              marginBottom: spacing.sm,
            }}
          >
            <Text style={{ color: colors.text }} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={{ color: statusColor[item.status], fontSize: 12, marginTop: 2 }}>
              {item.status}
              {item.error ? ` — ${item.error}` : ""}
            </Text>
          </View>
        )}
      />
      {allDone ? (
        <Button label="Done" onPress={() => router.back()} />
      ) : (
        <Button label={`Upload ${files.filter((f) => f.status !== "done").length} file(s)`} onPress={upload} loading={busy} disabled={files.length === 0} />
      )}
    </View>
  );
}
