import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "@/auth";
import { Chart } from "@/components/Chart";
import { BackHeader, Banner, Button, Card, Label, Muted, Screen, Segment } from "@/components/ui";
import { compact, money, pct, price, volume } from "@/format";
import { useTheme } from "@/theme";
import type { Candle, Profile, Quote } from "@/types";

const RANGES = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "5y", label: "5Y" },
];

export default function SymbolScreen() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  const symbol = (ticker ?? "").toUpperCase();
  const { api } = useAuth();
  const { palette } = useTheme();
  const [range, setRange] = useState("1m");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [watched, setWatched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [q, p, h, w] = await Promise.all([
          api.quote(symbol),
          api.profile(symbol),
          api.history(symbol, range),
          api.watchlist(),
        ]);
        if (cancel) return;
        setQuote(q.quote);
        setProfile(p.profile);
        setCandles(h.candles);
        setWatched(w.watchlist.some((item) => item.symbol === symbol));
        setError(null);
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : "Couldn't load that symbol.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [api, symbol, range]);

  const up = (quote?.changePercent ?? 0) >= 0;
  const chartUp = candles.length < 2 || candles[candles.length - 1].c >= candles[0].c;

  return (
    <Screen>
      <BackHeader title={symbol} subtitle={profile?.name ?? quote?.name} />
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {quote ? (
        <View style={{ gap: 14 }}>
          <View>
            <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 40 }}>{price(quote.price)}</Text>
            <Text style={{ color: up ? palette.up : palette.down, fontFamily: "DMSans_600SemiBold", fontSize: 16 }}>
              {quote.change >= 0 ? "+" : "−"}
              {money(Math.abs(quote.change))}  {pct(quote.changePercent)}
            </Text>
          </View>
          <Chart data={candles.map((candle) => candle.c)} positive={chartUp} />
          <Segment value={range} options={RANGES} onChange={setRange} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Trade" onPress={() => router.push({ pathname: "/trade", params: { symbol } })} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={watched ? "Watching" : "Watch"}
                tone="ghost"
                onPress={async () => {
                  if (watched) await api.removeWatch(symbol);
                  else await api.addWatch(symbol);
                  setWatched(!watched);
                }}
              />
            </View>
          </View>
          <Card>
            <Label>Key stats</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
              <Stat k="Open" v={price(quote.open)} />
              <Stat k="High" v={price(quote.high)} />
              <Stat k="Low" v={price(quote.low)} />
              <Stat k="Prev close" v={price(quote.previousClose)} />
              <Stat k="Volume" v={volume(quote.volume)} />
              <Stat k="Avg volume" v={profile?.averageVolume ? volume(profile.averageVolume) : "—"} />
              <Stat k="Mkt cap" v={profile?.marketCap ? compact(profile.marketCap) : "—"} />
              <Stat k="P/E" v={profile?.pe != null ? profile.pe.toFixed(1) : "—"} />
              <Stat k="EPS" v={profile?.eps != null ? profile.eps.toFixed(2) : "—"} />
              <Stat k="Div yield" v={profile?.dividendYield != null ? `${(profile.dividendYield * 100).toFixed(2)}%` : "—"} />
              <Stat k="52w high" v={profile?.week52High ? price(profile.week52High) : "—"} />
              <Stat k="52w low" v={profile?.week52Low ? price(profile.week52Low) : "—"} />
            </View>
          </Card>
          {profile ? (
            <View style={{ gap: 6 }}>
              <Label>
                {profile.sector} · {profile.industry}
              </Label>
              <Muted>{profile.description}</Muted>
              <Muted>{profile.exchange}</Muted>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ width: "50%", paddingVertical: 8 }}>
      <Text style={{ color: palette.faint, fontFamily: "DMSans_500Medium", fontSize: 12 }}>{k}</Text>
      <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 16 }}>{v}</Text>
    </View>
  );
}
