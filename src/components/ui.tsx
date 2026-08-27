/** Tiny UI kit on top of react-native-paper — same API the screens already use. */
import type { PropsWithChildren } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import {
  Button as PaperButton,
  Chip,
  Surface,
  Text,
  TextInput,
  useTheme,
  type TextInputProps,
} from "react-native-paper";
import { radius, spacing, type AppTheme } from "../constants/theme";

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

export function TagChip({ name, color }: { name: string; color?: string }) {
  const theme = useTheme<AppTheme>();
  // Tags carry a server-defined hex colour — keep it as the chip's own tint.
  const tint = color || theme.colors.primary;
  return (
    <Chip mode="outlined" compact style={[styles.chip, { borderColor: tint }]} textStyle={{ color: tint }}>
      {name}
    </Chip>
  );
}

export function Row({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.row, style]}>{children}</View>;
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

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md },
  title: { marginBottom: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.md },
  chip: { marginRight: 6, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  kv: { marginBottom: spacing.sm },
  kvLabel: { textTransform: "uppercase", marginBottom: 2 },
});
