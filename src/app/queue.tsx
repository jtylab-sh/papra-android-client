/** Upload queue: files that could not be sent (offline) wait here. */
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, View } from "react-native";
import { IconButton, Text, useTheme } from "react-native-paper";
import { Button, Card, Muted, Row, formatBytes, formatDate } from "~/components/ui";
import { spacing, type AppTheme } from "~/constants/theme";
import { requestNotificationPermission } from "~/lib/notifications";
import {
  clearQueuedUploads,
  flushUploads,
  listQueuedUploads,
  removeQueuedUpload,
  type QueuedUpload,
} from "~/lib/uploads";

export default function QueueScreen() {
  const theme = useTheme<AppTheme>();
  const [items, setItems] = useState<QueuedUpload[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listQueuedUploads().then(setItems);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const uploadNow = useCallback(async () => {
    setBusy(true);
    // Same as the upload page: the progress notification needs this on 13+.
    await requestNotificationPermission().catch(() => {});
    try {
      const result = await flushUploads();
      if (result?.failedError) {
        Alert.alert("Upload failed", result.failedError);
      }
    } finally {
      setBusy(false);
      load();
    }
  }, [load]);

  const removeOne = useCallback(
    (it: QueuedUpload) => {
      Alert.alert("Remove from queue?", `${it.name}\n\nThe file will not be uploaded.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeQueuedUpload(it.key).then(load) },
      ]);
    },
    [load],
  );

  const removeAll = useCallback(() => {
    Alert.alert("Delete the whole queue?", `${items.length} file(s) will not be uploaded.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete all", style: "destructive", onPress: () => clearQueuedUploads().then(load) },
    ]);
  }, [items.length, load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: spacing.md }}>
      <Stack.Screen options={{ title: "Upload queue" }} />
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        ListEmptyComponent={<Muted>Nothing waiting. Files that fail to upload while offline land here.</Muted>}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Row>
              <View style={{ flex: 1 }}>
                <Text variant="bodyLarge" numberOfLines={1}>
                  {item.name}
                </Text>
                <Muted>
                  {item.queuedAt ? formatDate(new Date(item.queuedAt).toISOString()) : ""}
                  {item.size != null ? ` · ${formatBytes(item.size)}` : ""}
                </Muted>
              </View>
              <IconButton
                icon="trash-can-outline"
                iconColor={theme.colors.error}
                accessibilityLabel={`Remove ${item.name}`}
                onPress={() => removeOne(item)}
              />
            </Row>
          </Card>
        )}
      />
      {items.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Button label={`Upload ${items.length} file(s) now`} onPress={uploadNow} loading={busy} />
          <Button label="Delete all" kind="ghost" onPress={removeAll} />
        </View>
      ) : null}
    </View>
  );
}
