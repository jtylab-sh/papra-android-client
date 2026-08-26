import * as LocalAuthentication from "expo-local-authentication";
import { Stack, router } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { Button, Muted, Screen, Title } from "../components/ui";
import { colors } from "../constants/theme";
import { getSettings } from "../lib/settings";
// Side effect: defines the background sync task at module scope.
import "../lib/sync";

export default function RootLayout() {
  // null = still deciding, true = locked, false = usable
  const [locked, setLocked] = useState<boolean | null>(null);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Papra",
    });
    if (result.success) setLocked(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    getSettings().then((s) => {
      if (!mounted) return;
      if (s.biometricLock) {
        setLocked(true);
        unlock();
      } else {
        setLocked(false);
      }
    });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        getSettings().then((s) => {
          if (s.biometricLock) setLocked(true);
        });
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [unlock]);

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

  if (locked !== false) {
    return (
      <Screen style={{ justifyContent: "center", gap: 12 }}>
        <StatusBar style="light" />
        <Title>Papra</Title>
        <Muted>Locked</Muted>
        {locked === true && <Button label="Unlock" onPress={unlock} />}
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </>
  );
}
