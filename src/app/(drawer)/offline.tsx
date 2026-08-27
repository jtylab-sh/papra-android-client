import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";
import { Card, Text, useTheme } from "react-native-paper";
import { Input, Muted, TagChip, formatBytes, formatDate } from "../../components/ui";
import { spacing, type AppTheme } from "../../constants/theme";
import { countOfflineDocuments, listOfflineDocuments, type CachedDocument } from "../../lib/db";

export default function OfflineScreen() {
  const theme = useTheme<AppTheme>();
  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<CachedDocument[]>([]);
  const [total, setTotal] = useState(0);

  const PAGE = 30;

  const loadLocal = useCallback((q: string) => {
    setDocs(listOfflineDocuments(q, PAGE, 0));
    setTotal(countOfflineDocuments(q));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLocal(search);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadLocal]),
  );

  const onSearchChange = useCallback(
    (t: string) => {
      setSearch(t);
      loadLocal(t);
    },
    [loadLocal],
  );

  const loadMore = useCallback(() => {
    setDocs((prev) => {
      if (prev.length >= total) return prev;
      return [...prev, ...listOfflineDocuments(search, PAGE, prev.length)];
    });
  }, [search, total]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Input
          placeholder="Search offline documents"
          value={search}
          onChangeText={onSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: spacing.md }}
        ListEmptyComponent={<Muted>Nothing offline yet. Enable offline sync in Settings or download documents individually.</Muted>}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          docs.length > 0 ? (
            <Muted>{docs.length < total ? `${docs.length} of ${total}` : `${total} document${total === 1 ? "" : "s"}`}</Muted>
          ) : null
        }
        renderItem={({ item }) => <DocumentRow doc={item} />}
      />
    </View>
  );
}

function DocumentRow({ doc }: { doc: CachedDocument }) {
  const theme = useTheme<AppTheme>();
  return (
    <Card mode="contained" style={{ marginBottom: spacing.sm }} onPress={() => router.push(`/document/${doc.id}`)}>
      <Card.Content>
        <Text variant="titleSmall" numberOfLines={1}>
          {doc.name}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
          {formatDate(doc.createdAt)}
          {doc.originalSize ? `  ·  ${formatBytes(doc.originalSize)}` : ""}
          {"  ·  "}
          <MaterialCommunityIcons name="cloud-check-outline" size={14} color={theme.colors.primary} />
        </Text>
        {doc.tags.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
            {doc.tags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
          </View>
        )}
      </Card.Content>
    </Card>
  );
}
