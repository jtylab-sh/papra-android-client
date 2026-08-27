/** Tiny UI kit on top of react-native-paper — same API the screens already use. */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Button as PaperButton,
  Chip,
  Surface,
  Text,
  TextInput,
  useTheme,
  type TextInputProps,
} from "react-native-paper";
import { radius, spacing, type AppTheme } from "~/constants/theme";
import { getActiveDateFormat } from "~/lib/settings";

export function Screen({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const theme = useTheme<AppTheme>();
  return <View style={[styles.screen, { backgroundColor: theme.colors.background }, style]}>{children}</View>;
}

export function Title({ children }: PropsWithChildren) {
  return (
    <Text variant="headlineMedium" style={styles.title}>
      {children}
    </Text>
  );
}

export function Muted({ children }: PropsWithChildren) {
  const theme = useTheme<AppTheme>();
  return (
    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const theme = useTheme<AppTheme>();
  return (
    <PaperButton
      mode={kind === "ghost" ? "outlined" : "contained"}
      onPress={onPress}
      disabled={disabled || loading}
      loading={loading}
      buttonColor={kind === "danger" ? theme.colors.error : undefined}
      textColor={kind === "danger" ? theme.colors.onError : undefined}
    >
      {label}
    </PaperButton>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput mode="outlined" dense {...props} />;
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return (
    <Surface elevation={1} style={[styles.card, style]}>
      {children}
    </Surface>
  );
}

export function TagChip({ name, color, onClose }: { name: string; color?: string; onClose?: () => void }) {
  const theme = useTheme<AppTheme>();
  // Tags carry a server-defined hex colour — keep it as the chip's own tint.
  // Custom pill: Paper's Chip renders its close icon outside the outline in
  // compact mode, so the ✕ sits inline here instead.
  const tint = color || theme.colors.primary;
  return (
    <View style={[styles.chip, styles.tagPill, { borderColor: tint }]}>
      <Text variant="labelMedium" numberOfLines={1} style={{ color: tint, flexShrink: 1 }}>
        {name}
      </Text>
      {onClose ? (
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel={`Remove ${name}`}
          style={{ marginLeft: 5 }}
        >
          <MaterialCommunityIcons name="close" size={14} color={tint} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Row({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.row, style]}>{children}</View>;
}

/** Single-select chip row (sync cadence, lock grace, trash retention). */
export function ChipRow<T extends string | number>({
  options,
  value,
  onSelect,
  style,
}: {
  options: { label: string; value: T }[];
  value: T;
  onSelect: (value: T) => void;
  style?: ViewStyle;
}) {
  return (
    <Row style={{ flexWrap: "wrap", ...style }}>
      {options.map((opt) => (
        <Chip
          key={String(opt.value)}
          compact
          showSelectedCheck={false}
          selected={opt.value === value}
          mode={opt.value === value ? "flat" : "outlined"}
          onPress={() => onSelect(opt.value)}
          style={{ marginRight: 6, marginBottom: 6 }}
        >
          {opt.label}
        </Chip>
      ))}
    </Row>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  const theme = useTheme<AppTheme>();
  if (!value) return null;
  return (
    <View style={styles.kv}>
      <Text variant="labelSmall" style={[styles.kvLabel, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text variant="bodyMedium" selectable>
        {value}
      </Text>
    </View>
  );
}

export function formatBytes(n: number): string {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDay(d: Date): string {
  const format = getActiveDateFormat();
  if (format === "system") return d.toLocaleDateString();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  if (format === "dmy") return `${dd}/${mm}/${yyyy}`;
  if (format === "mdy") return `${mm}/${dd}/${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : formatDay(d) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md },
  title: { marginBottom: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.md },
  chip: { marginRight: 6, marginBottom: 6 },
  tagPill: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  kv: { marginBottom: spacing.sm },
  kvLabel: { textTransform: "uppercase", marginBottom: 2 },
});
