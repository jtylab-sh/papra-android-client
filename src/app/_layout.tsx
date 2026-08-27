import * as LocalAuthentication from "expo-local-authentication";
import { Stack, router } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Network from "expo-network";
import * as QuickActions from "expo-quick-actions";
import * as ScreenCapture from "expo-screen-capture";
import { useQuickActionRouting, type RouterAction } from "expo-quick-actions/router";
import { Alert, AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaperProvider, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Muted, Screen, Title } from "~/components/ui";
import { useAppTheme } from "~/constants/theme";
import { wireNotificationNavigation } from "~/lib/notifications";
import { useOnReconnect } from "~/lib/network";
import { getSettings } from "~/lib/settings";
import { flushUploads } from "~/lib/uploads";
// Side effect: defines the background sync task at module scope.
import { signOutEverything } from "~/lib/sync";
import { maybePromptUpdate } from "~/lib/version";

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

  // Once per new version: offer the newer GitHub release. Opt-in (Settings ->
  // Update check), so Obtainium/store users never see the nag.
  useEffect(() => {
    getSettings().then((s) => {
      if (s.updateCheckEnabled) maybePromptUpdate();
    });
  }, []);

  // Long-press the launcher icon: Scan / Upload / Search.
  useQuickActionRouting();
  useEffect(() => {
    QuickActions.setItems<RouterAction>([
      { id: "scan", title: "Scan", params: { href: "/upload?mode=scan" } },
      { id: "upload", title: "Upload", params: { href: "/upload?mode=pick" } },
      { id: "search", title: "Search", params: { href: "/" } },
    ]).catch(() => {});
  }, []);

  // Files queued while offline: send on start and whenever we come back online.
  useEffect(() => {
    flushUploads().catch(() => {});
  }, []);
  useOnReconnect(() => {
    flushUploads().catch(() => {});
  });

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

  // FLAG_SECURE rides the lock screen (and the background handler below), not
  // the whole app: once unlocked, screenshots work normally again.
  useEffect(() => {
    if (locked === null) return;
    (locked ? ScreenCapture.preventScreenCaptureAsync() : ScreenCapture.allowScreenCaptureAsync()).catch(() => {});
  }, [locked]);

  useEffect(() => {
    let mounted = true;
    getSettings().then((s) => {
      if (!mounted) return;
      setLocked(s.biometricLock);
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        leftAt.current = Date.now();
        // Blank the recents thumbnail while away; lifted on return or unlock.
        getSettings().then((s) => {
          if (s.biometricLock) ScreenCapture.preventScreenCaptureAsync().catch(() => {});
        });
      } else if (state === "active") {
        flushUploads().catch(() => {});
        if (leftAt.current !== null) {
          const awayMs = Date.now() - leftAt.current;
          leftAt.current = null;
          getSettings().then((s) => {
            if (s.biometricLock && awayMs > s.lockGraceMinutes * 60_000) setLocked(true);
            else ScreenCapture.allowScreenCaptureAsync().catch(() => {});
          });
        }
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "Removes the account and every offline document from this phone. App settings are kept.", [
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
  const network = Network.useNetworkState();
  // Connected-but-unvalidated (no real internet) counts as offline too.
  const offline = network.isConnected === false || network.isInternetReachable === false;
  // Edge-to-edge: without the top inset the banner hides behind the status bar.
  const insets = useSafeAreaInsets();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={appTheme}>
      <StatusBar style="light" />
      {offline ? (
        <View
          style={{
            backgroundColor: appTheme.colors.errorContainer,
            paddingTop: insets.top + 2,
            paddingBottom: 5,
            alignItems: "center",
          }}
        >
          <Text variant="labelSmall" style={{ color: appTheme.colors.onErrorContainer }}>
            Offline - showing cached data
          </Text>
        </View>
      ) : null}
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
