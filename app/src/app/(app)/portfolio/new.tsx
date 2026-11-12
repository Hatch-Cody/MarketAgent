import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { useBooks } from "@/books";
import { BackHeader, Banner, Button, Field, Muted, Screen, Segment } from "@/components/ui";

const PRESETS = [
  { value: "1000", label: "$1k" },
  { value: "10000", label: "$10k" },
  { value: "100000", label: "$100k" },
  { value: "1000000", label: "$1m" },
];

export default function NewPortfolioScreen() {
  const { api } = useAuth();
  const books = useBooks();
  const [name, setName] = useState("Primary");
  const [preset, setPreset] = useState("10000");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const amount = Number(custom || preset);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const created = await api.createPortfolio({ name: name.trim(), startingCash: amount });
      await books.refresh();
      await books.select(created.portfolio.id);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the portfolio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <BackHeader title="New portfolio" subtitle="Its own cash, holdings, and history." />
      <View style={{ gap: 14 }}>
        <Muted>From $1 to $1,000,000,000. The usual paper account starts at $10,000.</Muted>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Field label="Name" value={name} onChangeText={setName} />
        <Segment value={preset} options={PRESETS} onChange={(value) => { setPreset(value); setCustom(""); }} />
        <Field label="Custom starting cash" keyboardType="decimal-pad" value={custom} onChangeText={setCustom} placeholder="Leave blank to use the preset" />
        <Button label={`Open with $${amount.toLocaleString("en-US")}`} onPress={submit} loading={loading} disabled={!name.trim() || !Number.isFinite(amount) || amount < 1} />
      </View>
    </Screen>
  );
}
