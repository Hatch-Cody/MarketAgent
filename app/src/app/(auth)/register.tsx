import { Link, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { BackHeader, Banner, Button, Field, Muted, Screen } from "@/components/ui";
import { useTheme } from "@/theme";

export default function RegisterScreen() {
  const { register } = useAuth();
  const { palette } = useTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <BackHeader title="New account" />
      <View style={{ gap: 16 }}>
        <Muted>One login, as many paper portfolios as you want. Agents get their own books.</Muted>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
        <Button label="Create account" onPress={submit} loading={loading} disabled={!name || !email || password.length < 8} />
        <Link href="/login" style={{ color: palette.accent, fontFamily: "DMSans_600SemiBold" }}>
          I already have an account
        </Link>
      </View>
    </Screen>
  );
}
