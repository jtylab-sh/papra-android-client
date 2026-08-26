/** Tiny dark-mode UI kit — enough for this app, no component library. */
import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing } from "../constants/theme";

export function Screen({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Title({ children }: PropsWithChildren) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: PropsWithChildren) {
  return <Text style={styles.muted}>{children}</Text>;
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        kind === "primary" && { backgroundColor: colors.primary },
        kind === "ghost" && { backgroundColor: colors.surfaceHigh },
        kind === "danger" && { backgroundColor: colors.danger },
        (pressed || disabled || loading) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === "ghost" ? colors.text : "#06231a"} />
      ) : (
        <Text style={[styles.buttonLabel, kind === "ghost" && { color: colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.textMuted} {...props} style={[styles.input, props.style]} />;
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function TagChip({ name, color }: { name: string; color?: string }) {
  return (
    <View style={[styles.chip, { borderColor: color || colors.primary }]}>
      <Text style={[styles.chipText, { color: color || colors.primary }]}>{name}</Text>
    </View>
  );
}

export function Row({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} selectable>
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
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  title: { color: colors.text, fontSize: 24, fontWeight: "700", marginBottom: spacing.md },
  muted: { color: colors.textMuted, fontSize: 14 },
  button: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { color: "#06231a", fontWeight: "700", fontSize: 15 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  kv: { marginBottom: spacing.sm },
  kvLabel: { color: colors.textMuted, fontSize: 12, textTransform: "uppercase", marginBottom: 2 },
  kvValue: { color: colors.text, fontSize: 15 },
});
