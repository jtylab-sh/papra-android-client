import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { Button, Card, Input, Muted, Title } from "../components/ui";
import { colors, radius, spacing } from "../constants/theme";
import { getAuthClient } from "../lib/auth";
import { listOrganizations, type PapraOrganization } from "../lib/papra";
import { normalizeServerUrl, saveSettings, type AuthMode, type Settings } from "../lib/settings";
import { applySyncRegistration } from "../lib/sync";

/** Settings candidate used before anything is persisted. */
function draftSettings(serverUrl: string, authMode: AuthMode, apiKey: string): Settings {
  return {
    serverUrl,
    authMode,
    apiKey,
    organizationId: "",
    organizationName: "",
    syncEnabled: false,
    syncIntervalMinutes: 720,
    syncWifiOnly: true,
    biometricLock: false,
  };
}

export default function SignInScreen() {
  const [serverUrl, setServerUrl] = useState("");
  const [mode, setMode] = useState<AuthMode>("session");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [orgs, setOrgs] = useState<PapraOrganization[] | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);

  const finish = useCallback(async (settings: Settings, org: PapraOrganization) => {
    await saveSettings({ ...settings, organizationId: org.id, organizationName: org.name });
    await applySyncRegistration().catch(() => {});
    router.replace("/");
  }, []);

  const pickOrgsOrFinish = useCallback(
    async (settings: Settings) => {
      const found = await listOrganizations(settings);
      if (found.length === 0) throw new Error("No organizations on this account.");
      if (found.length === 1) return finish(settings, found[0]);
      setDraft(settings);
      setOrgs(found);
    },
    [finish],
  );

  const connect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const url = normalizeServerUrl(serverUrl);
      if (!url) throw new Error("Enter the server URL.");
      if (mode === "session") {
        const client = getAuthClient(url);
        const { error: signInError } = await client.signIn.email({ email: email.trim(), password });
        if (signInError) {
          const msg = signInError.message ?? "Sign-in failed";
          throw new Error(
            /two.?factor/i.test(msg)
              ? "This account uses two-factor auth — use an API key instead (Papra → Settings → API keys)."
              : msg,
          );
        }
        await pickOrgsOrFinish(draftSettings(url, "session", ""));
      } else {
        if (!apiKey.trim()) throw new Error("Paste an API key.");
        await pickOrgsOrFinish(draftSettings(url, "apiKey", apiKey.trim()));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [serverUrl, mode, email, password, apiKey, pickOrgsOrFinish]);

  if (orgs && draft) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.md }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Title>Pick organization</Title>
        {orgs.map((org) => (
          <Pressable
            key={org.id}
            onPress={() => finish(draft, org)}
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radius.md,
              padding: spacing.md,
              marginBottom: spacing.sm,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 16 }}>{org.name}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1, justifyContent: "center" }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Title>Papra</Title>
        <Muted>Connect to your self-hosted Papra server.</Muted>

        <Input
          placeholder="Server URL (https://docs.example.com)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={serverUrl}
          onChangeText={setServerUrl}
        />

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {(
            [
              ["session", "Email & password"],
              ["apiKey", "API key"],
            ] as [AuthMode, string][]
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              style={{
                flex: 1,
                backgroundColor: mode === value ? colors.primary : colors.surfaceHigh,
                borderRadius: radius.md,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: mode === value ? "#06231a" : colors.text, fontWeight: "600", fontSize: 13 }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === "session" ? (
          <>
            <Input
              placeholder="Email"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
          </>
        ) : (
          <Card>
            <Input
              placeholder="API key"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              value={apiKey}
              onChangeText={setApiKey}
            />
            <Muted>
              Papra → user menu → API keys. Needs documents + tags read; add create/update/delete for uploads and
              trash.
            </Muted>
          </Card>
        )}

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        <Button label="Connect" onPress={connect} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
