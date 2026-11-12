import { Link, router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { useAuth } from "@/auth";
import { Banner, Button, Field, H1, Muted, Screen } from "@/components/ui";
import { useTheme } from "@/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const { palette } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ gap: 18, paddingTop: 28 }}>
          <Text style={{ color: palette.accent, fontFamily: "DMSans_700Bold", letterSpacing: 1.2, fontSize: 12 }}>MARKETSIM</Text>
          <H1>A paper book with real hours.</H1>
          <Muted>Ten thousand dollars of virtual cash, or whatever you choose. Quotes from a built-in market until you add a data key.</Muted>
          {error ? <Banner tone="bad">{error}</Banner> : null}
          <Field label="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
          <Button label="Sign in" onPress={submit} loading={loading} disabled={!email || password.length < 8} />
          <Button
            label="Use the local demo book"
            tone="ghost"
            onPress={() => {
              setEmail("demo@marketsim.app");
              setPassword("password123");
            }}
          />
          <Link href="/register" style={{ color: palette.accent, fontFamily: "DMSans_600SemiBold", fontSize: 15 }}>
            Open a new account
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
