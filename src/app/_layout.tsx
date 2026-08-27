import * as LocalAuthentication from "expo-local-authentication";
import { Stack, router } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaperProvider } from "react-native-paper";
import { Button, Muted, Screen, Title } from "../components/ui";
import { useAppTheme } from "../constants/theme";
import { wireNotificationNavigation } from "../lib/notifications";
import { getSettings } from "../lib/settings";
// Side effect: defines the background sync task at module scope.
import { signOutEverything } from "../lib/sync";
import { maybePromptUpdate } from "../lib/version";

export default function RootLayout() {
  const appTheme = useAppTheme();
  // null = still deciding, true = locked, false = usable
  const [locked, setLocked] = useState<boolean | null>(null);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Papra",
    });
    if (result.success) setLocked(false);
  }, []);

  // Once per new version: offer the newer GitHub release.
  useEffect(() => {
    maybePromptUpdate();
  }, []);

  // Tapping any of our notifications opens its page (sync progress -> Settings, ...).
  useEffect(
    () =>
      wireNotificationNavigation((url) => {
        try {
          router.push(url as never);
        } catch {
          /* navigator not mounted yet */
        }
      }),
    [],
  );

  // Auto-open the biometric prompt whenever the lock screen appears.
  useEffect(() => {
    if (locked === true) unlock();
  }, [locked, unlock]);

  useEffect(() => {
    let mounted = true;
    getSettings().then((s) => {
      if (!mounted) return;
      setLocked(s.biometricLock);
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        leftAt.current = Date.now();
      } else if (state === "active" && leftAt.current !== null) {
        const awayMs = Date.now() - leftAt.current;
        leftAt.current = null;
        getSettings().then((s) => {
          if (s.biometricLock && awayMs > s.lockGraceMinutes * 60_000) setLocked(true);
        });
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "Removes the account, settings and every offline document from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOutEverything();
          setLocked(false);
          router.replace("/sign-in");
        },
      },
    ]);
  }, []);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (hasShareIntent && shareIntent.files?.length) {
      const files = shareIntent.files.map((f) => ({
        uri: f.path,
        name: f.fileName,
        mimeType: f.mimeType,
      }));
      resetShareIntent();
      router.push({ pathname: "/upload", params: { files: JSON.stringify(files) } });
    }
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  // One provider around both branches: the lock screen is Paper-themed too.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={appTheme}>
      <StatusBar style="light" />
      {locked !== false ? (
        <Screen style={{ justifyContent: "center", gap: 12 }}>
          <Title>Papra</Title>
          <Muted>Locked</Muted>
          {locked === true && (
            <>
              <Button label="Unlock" onPress={unlock} />
              <Button label="Sign out" kind="ghost" onPress={signOut} />
            </>
          )}
        </Screen>
      ) : (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: appTheme.colors.surface },
            headerTintColor: appTheme.colors.onSurface,
            headerTitleStyle: { color: appTheme.colors.onSurface },
            contentStyle: { backgroundColor: appTheme.colors.background },
          }}
        >
          <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        </Stack>
      )}
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
