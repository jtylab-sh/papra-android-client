/**
 * Shared document list row (Documents + Offline tabs): dense two-line M3 row
 * with a tinted mime-type icon, date · size, up to two mini tag pills and an
 * offline indicator. Selected rows swap the icon for a check.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";
import { Text, TouchableRipple, useTheme } from "react-native-paper";
import { spacing, type AppTheme } from "~/constants/theme";
import type { CachedDocument } from "~/lib/db";
import { formatBytes, formatDate } from "~/components/ui";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type Tone = "primary" | "secondary" | "tertiary";

export function mimeVisual(mimeType: string): { icon: IconName; tone: Tone } {
  const m = mimeType || "";
  if (m === "application/pdf") return { icon: "file-pdf-box", tone: "primary" };
  if (m.startsWith("image/")) return { icon: "file-image-outline", tone: "secondary" };
  if (m.startsWith("video/")) return { icon: "file-video-outline", tone: "secondary" };
  if (m.includes("sheet") || m.includes("csv") || m.includes("excel"))
    return { icon: "file-table-outline", tone: "tertiary" };
  if (m.startsWith("text/") || m.includes("word") || m.includes("document"))
    return { icon: "file-document-outline", tone: "tertiary" };
  return { icon: "file-outline", tone: "secondary" };
}

export function MimeIcon({ mimeType, size = 40, checked = false }: { mimeType: string; size?: number; checked?: boolean }) {
  const theme = useTheme<AppTheme>();
  const { icon, tone } = mimeVisual(mimeType);
  const bg = checked
    ? theme.colors.primary
    : { primary: theme.colors.primaryContainer, secondary: theme.colors.secondaryContainer, tertiary: theme.colors.tertiaryContainer }[tone];
  const fg = checked
    ? theme.colors.onPrimary
    : { primary: theme.colors.onPrimaryContainer, secondary: theme.colors.onSecondaryContainer, tertiary: theme.colors.onTertiaryContainer }[tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MaterialCommunityIcons name={checked ? "check" : icon} size={size * 0.55} color={fg} />
    </View>
  );
}

export function DocumentRow({
  doc,
  selected = false,
  onPress,
  onLongPress,
}: {
  doc: CachedDocument;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme<AppTheme>();
  return (
    <TouchableRipple
      onPress={onPress}
      onLongPress={onLongPress}
      borderless
      style={{
        borderRadius: 14,
        backgroundColor: selected ? theme.colors.secondaryContainer : "transparent",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.sm,
          paddingVertical: 10,
        }}
      >
        <MimeIcon mimeType={doc.mimeType} checked={selected} />
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={1}>
            {doc.name}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
            {formatDate(doc.createdAt)}
            {doc.originalSize ? ` · ${formatBytes(doc.originalSize)}` : ""}
          </Text>
          {doc.tags.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 3, gap: 4 }}>
              {doc.tags.map((t) => (
                <View
                  key={t.id}
                  style={{
                    borderWidth: 1,
                    borderColor: t.color || theme.colors.outline,
                    borderRadius: 8,
                    paddingHorizontal: 5,
                  }}
                >
                  <Text
                    variant="labelSmall"
                    numberOfLines={1}
                    style={{ color: t.color || theme.colors.onSurfaceVariant }}
                  >
                    {t.name}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        {doc.fileUri ? (
          <MaterialCommunityIcons name="cloud-check-outline" size={18} color={theme.colors.primary} />
        ) : (
          <MaterialCommunityIcons name="cloud-off-outline" size={18} color={theme.colors.onSurfaceVariant} />
        )}
      </View>
    </TouchableRipple>
  );
}
