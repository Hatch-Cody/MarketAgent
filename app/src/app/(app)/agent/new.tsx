import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { useBooks } from "@/books";
import { BackHeader, Banner, Button, Field, Muted, Screen, Segment } from "@/components/ui";
import { stashKey } from "@/keys";

export default function NewAgentScreen() {
  const { api } = useAuth();
  const books = useBooks();
  const [name, setName] = useState("Scout");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [startingCash, setStartingCash] = useState("10000");
  const [portfolioId, setPortfolioId] = useState(books.portfolios.find((item) => !item.agent)?.id ?? "");
  const [maxOrder, setMaxOrder] = useState("2000");
  const [maxTrades, setMaxTrades] = useState("20");
  const [symbols, setSymbols] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const allowedSymbols = symbols.split(",").map((item) => item.trim()).filter(Boolean);
      const created = await api.createAgent({
        name: name.trim(),
        portfolioId: mode === "existing" ? portfolioId : undefined,
        startingCash: mode === "new" ? Number(startingCash) : undefined,
        maxOrderSize: Number(maxOrder),
        maxTradesPerDay: Number(maxTrades),
        allowedSymbols,
      });
      stashKey({ agentId: created.agent.id, name: created.agent.name, apiKey: created.apiKey });
      await books.refresh();
      router.replace(`/agent/reveal?id=${created.agent.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the agent.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <BackHeader title="New agent" subtitle="A key, a book, and a few limits." />
      <View style={{ gap: 14 }}>
        <Muted>The API key is shown once. Store it before you leave the next screen.</Muted>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Field label="Name" value={name} onChangeText={setName} />
        <Segment
          value={mode}
          onChange={setMode}
          options={[
            { value: "new", label: "New book" },
            { value: "existing", label: "Existing book" },
          ]}
        />
        {mode === "new" ? (
          <Field label="Starting cash" keyboardType="decimal-pad" value={startingCash} onChangeText={setStartingCash} />
        ) : (
          <Segment
            value={portfolioId}
            onChange={setPortfolioId}
            options={books.portfolios.filter((item) => !item.agent).map((item) => ({ value: item.id, label: item.name }))}
          />
        )}
        <Field label="Max order size ($)" keyboardType="decimal-pad" value={maxOrder} onChangeText={setMaxOrder} />
        <Field label="Max trades per day" keyboardType="number-pad" value={maxTrades} onChangeText={setMaxTrades} />
        <Field label="Allowed symbols" autoCapitalize="characters" value={symbols} onChangeText={setSymbols} placeholder="Blank allows every ticker" />
        <Button label="Create agent" onPress={submit} loading={loading} disabled={!name.trim() || (mode === "existing" && !portfolioId)} />
      </View>
    </Screen>
  );
}
