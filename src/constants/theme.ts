import { useMaterial3Theme } from "@pchmn/expo-material3-theme";
import { MD3DarkTheme } from "react-native-paper";

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16 } as const;

/**
 * Material You theme, dark mode only on purpose.
 *
 * On Android 12+ `useMaterial3Theme` returns the system (wallpaper) palette;
 * everywhere else it derives one from the papra-green seed below.
 */
export function useAppTheme() {
  const { theme } = useMaterial3Theme({ fallbackSourceColor: "#10b981" });
  return { ...MD3DarkTheme, colors: theme.dark };
}

/** For `useTheme<AppTheme>()` in screens — MD3 colors plus the M3 extras. */
export type AppTheme = ReturnType<typeof useAppTheme>;
