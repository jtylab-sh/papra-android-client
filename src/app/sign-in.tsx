import { Stack, router } from "expo-router";
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { Button, Input, Muted, Title } from "../components/ui";
import { colors, radius, spacing } from "../constants/theme";
import { getAuthClient } from "../lib/auth";
import { listOrganizations, type PapraOrganization } from "../lib/papra";
import { normalizeServerUrl, saveSettings, type Settings } from "../lib/settings";
import { applySyncRegistration } from "../lib/sync";

/** Settings candidate used before anything is persisted. */
function draftSettings(serverUrl: string): Settings {
  return {
    serverUrl,
    authMode: "session",
    apiKey: "",
    organizationId: "",
    organizationName: "",
    syncEnabled: false,
    syncIntervalMinutes: 720,
    syncWifiOnly: true,
    biometricLock: false,
  };
}

type Step = "credentials" | "totp" | "org";

export default function SignInScreen() {
  const [step, setStep] = useState<Step>("credentials");
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [orgs, setOrgs] = useState<PapraOrganization[]>([]);
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
      setStep("org");
    },
    [finish],
  );

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const connect = () =>
    run(async () => {
      const url = normalizeServerUrl(serverUrl);
      if (!url) throw new Error("Enter the server URL.");
      const client = getAuthClient(url);
      const { data, error: signInError } = await client.signIn.email({ email: email.trim(), password });
      if (signInError) throw new Error(signInError.message ?? "Sign-in failed");
      if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        setStep("totp");
        return;
      }
      await pickOrgsOrFinish(draftSettings(url));
    });

  const verifyTotp = () =>
    run(async () => {
      const url = normalizeServerUrl(serverUrl);
      const client = getAuthClient(url);
      // trustDevice: skip the TOTP prompt on this phone for future sign-ins.
      const { error: totpError } = await client.twoFactor.verifyTotp({ code: code.trim(), trustDevice: true });
      if (totpError) throw new Error(totpError.message ?? "Invalid code");
      await pickOrgsOrFinish(draftSettings(url));
    });

  if (step === "org") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.md }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Title>Pick organization</Title>
        {orgs.map((org) => (
          <Pressable
            key={org.id}
            onPress={() => draft && finish(draft, org)}
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

        {step === "credentials" ? (
          <>
            <Muted>Connect to your self-hosted Papra server.</Muted>
            <Input
              placeholder="Server URL (https://docs.example.com)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={serverUrl}
              onChangeText={setServerUrl}
            />
            <Input
              placeholder="Email"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
            <Button label="Sign in" onPress={connect} loading={busy} />
          </>
        ) : (
          <>
            <Muted>Two-factor authentication — enter the 6-digit code from your authenticator app.</Muted>
            <Input
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
              autoFocus
            />
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
            <Button label="Verify" onPress={verifyTotp} loading={busy} disabled={code.trim().length !== 6} />
            <Button label="Back" kind="ghost" onPress={() => setStep("credentials")} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/*
 * API-key sign-in — parked, not deleted. The lib layer (settings.authMode
 * "apiKey", papra.ts Bearer branch) still supports it; only this UI entry is
 * disabled. Re-enable if a server can't trust the papra:// scheme (old Papra,
 * overridden TRUSTED_APP_SCHEMES) by restoring:
 *
 *   - a mode toggle ("Email & password" | "API key")
 *   - an Input bound to `apiKey` (secureTextEntry)
 *   - connect() branch:
 *       if (!apiKey.trim()) throw new Error("Paste an API key.");
 *       await pickOrgsOrFinish({ ...draftSettings(url), authMode: "apiKey", apiKey: apiKey.trim() });
 *   - hint: Papra → user menu → API keys; needs documents:read/create/update/delete + tags:read.
 */
