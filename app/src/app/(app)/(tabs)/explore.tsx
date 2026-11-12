import { router } from "expo-router";
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import { useAuth } from "@/auth";
import { Banner, Label, Muted, QuoteRow, Screen, Segment } from "@/components/ui";
import { price } from "@/format";
import { useTheme } from "@/theme";
import type { Quote, SearchHit } from "@/types";

export default function ExploreScreen() {
  const { api } = useAuth();
  const { palette } = useTheme();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "gainers" | "losers">("gainers");
  const [movers, setMovers] = useState<{ active: Quote[]; gainers: Quote[]; losers: Quote[] } | null>(null);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadMovers() {
    setLoading(true);
    try {
      setMovers(await api.movers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load movers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMovers();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.search(query.trim()).then((payload) => setResults(payload.results)).catch((err) => setError(err.message));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, api]);

  const rows = movers?.[tab] ?? [];

  return (
    <Screen onRefresh={loadMovers} refreshing={loading}>
      <View style={{ gap: 14 }}>
        <Label>Research</Label>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or ticker"
          placeholderTextColor={palette.faint}
          autoCapitalize="characters"
          style={{
            backgroundColor: palette.elevated,
            color: palette.text,
            borderColor: palette.line,
            borderWidth: 1,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 13,
            fontFamily: "DMSans_500Medium",
            fontSize: 16,
          }}
        />
        {error ? <Banner tone="bad">{error}</Banner> : null}
        {query.trim() ? (
          <View>
            {results.length === 0 ? <Muted>No matches yet.</Muted> : null}
            {results.map((hit) => (
              <QuoteRow
                key={hit.symbol}
                symbol={hit.symbol}
                name={hit.name}
                price={hit.type}
                changePercent={null}
                onPress={() => router.push(`/symbol/${hit.symbol}`)}
              />
            ))}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Segment
              value={tab}
              onChange={setTab}
              options={[
                { value: "active", label: "Active" },
                { value: "gainers", label: "Gainers" },
                { value: "losers", label: "Losers" },
              ]}
            />
            {rows.map((quote) => (
              <QuoteRow
                key={quote.symbol}
                symbol={quote.symbol}
                name={quote.name}
                price={price(quote.price)}
                changePercent={quote.changePercent}
                onPress={() => router.push(`/symbol/${quote.symbol}`)}
              />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
