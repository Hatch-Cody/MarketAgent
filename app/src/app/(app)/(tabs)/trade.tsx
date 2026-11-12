import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { useBooks } from "@/books";
import { Banner, Button, Card, Field, Label, Muted, Screen, Segment } from "@/components/ui";
import { money, price, sessionTime, shares } from "@/format";
import type { Quote } from "@/types";

export default function TradeScreen() {
  const params = useLocalSearchParams<{ symbol?: string }>();
  const { api, market } = useAuth();
  const books = useBooks();
  const [symbol, setSymbol] = useState((params.symbol ?? "AAPL").toUpperCase());
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amountType, setAmountType] = useState<"dollars" | "shares">("dollars");
  const [amount, setAmount] = useState("250");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.symbol) setSymbol(params.symbol.toUpperCase());
  }, [params.symbol]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (!symbol.trim()) return;
      api.quote(symbol.trim()).then((result) => setQuote(result.quote)).catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [symbol, api]);

  const numeric = Number(amount);
  const preview = useMemo(() => {
    if (!quote || !Number.isFinite(numeric) || numeric <= 0) return null;
    if (amountType === "dollars") {
      const estShares = numeric / quote.price;
      return { shares: estShares, cost: numeric };
    }
    return { shares: numeric, cost: numeric * quote.price };
  }, [quote, numeric, amountType]);

  async function submit() {
    if (!books.selectedId || !preview) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.placeOrder(books.selectedId, {
        symbol: symbol.trim(),
        side,
        amountType,
        amount: numeric,
      });
      setNotice(result.order.message ?? (result.order.status === "pending" ? "Queued for the next open." : "Filled."));
      await books.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order rejected.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <Label>Market order</Label>
        {!market?.open ? (
          <Banner>NYSE is closed. This order waits for the next open{market?.nextOpen ? ` (${sessionTime(market.nextOpen)})` : ""}, unless Settings allows immediate fills.</Banner>
        ) : null}
        {books.detail ? <Muted>Trading in {books.detail.name}. Cash {money(books.detail.cash)}.</Muted> : <Muted>Create a portfolio before placing an order.</Muted>}
        <Segment value={side} onChange={setSide} options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
        <Field label="Symbol" autoCapitalize="characters" value={symbol} onChangeText={(value) => setSymbol(value.toUpperCase())} />
        {quote ? <Muted>{quote.name} · {price(quote.price)} · {quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</Muted> : <Muted>Looking up that ticker…</Muted>}
        <Segment
          value={amountType}
          onChange={setAmountType}
          options={[
            { value: "dollars", label: "Dollars" },
            { value: "shares", label: "Shares" },
          ]}
        />
        <Field label={amountType === "dollars" ? "Amount" : "Shares"} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(amountType === "dollars" ? ["100", "250", "1000"] : ["0.5", "1", "5"]).map((preset) => (
            <View key={preset} style={{ flex: 1 }}>
              <Button label={preset} tone="ghost" onPress={() => setAmount(preset)} />
            </View>
          ))}
        </View>
        {preview && books.detail ? (
          <Card>
            <Muted>
              About {shares(preview.shares)} shares at {quote ? price(quote.price) : "—"}, notional {money(preview.cost)}. Cash after a {side} would be about{" "}
              {money(side === "buy" ? books.detail.cash - preview.cost : books.detail.cash + preview.cost)}.
            </Muted>
          </Card>
        ) : null}
        {error ? <Banner tone="bad">{error}</Banner> : null}
        {notice ? <Banner tone="good">{notice}</Banner> : null}
        <Button
          label={side === "buy" ? "Buy" : "Sell"}
          tone={side === "buy" ? "buy" : "sell"}
          loading={loading}
          disabled={!books.selectedId || !preview}
          onPress={submit}
        />
        <Button label="View the book" tone="ghost" onPress={() => router.push("/")} />
      </View>
    </Screen>
  );
}
