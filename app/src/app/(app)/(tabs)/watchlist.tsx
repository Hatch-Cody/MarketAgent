import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/auth";
import { Banner, Empty, Muted, QuoteRow, Screen } from "@/components/ui";
import { price } from "@/format";
import { useTheme } from "@/theme";
import type { Quote } from "@/types";

export default function WatchlistScreen() {
  const { api } = useAuth();
  const { palette } = useTheme();
  const [rows, setRows] = useState<{ symbol: string; quote: Quote | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.watchlist();
      setRows(result.watchlist);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the watchlist.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), 20_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 28 }}>Watchlist</Text>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        {rows.length === 0 && !loading ? (
          <Empty title="Nothing starred" body="Open a company from Explore and star it. Quotes stay here." />
        ) : null}
        {rows.map((row) => (
          <View key={row.symbol}>
            <QuoteRow
              symbol={row.symbol}
              name={row.quote?.name ?? row.symbol}
              price={row.quote ? price(row.quote.price) : "—"}
              changePercent={row.quote?.changePercent ?? 0}
              onPress={() => router.push(`/symbol/${row.symbol}`)}
            />
            <Pressable
              onPress={async () => {
                await api.removeWatch(row.symbol);
                void load();
              }}
            >
              <Muted>Remove</Muted>
            </Pressable>
          </View>
        ))}
      </View>
    </Screen>
  );
}
