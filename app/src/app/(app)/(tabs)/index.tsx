import { router } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useAuth } from "@/auth";
import { useBooks } from "@/books";
import { Chart } from "@/components/Chart";
import { Banner, Button, Card, Display, Empty, Label, Muted, ReturnText, Screen, Segment } from "@/components/ui";
import { money, pct, price, sessionTime, shares, when } from "@/format";
import { useTheme } from "@/theme";
import type { Order } from "@/types";
import { useEffect } from "react";

const RANGES = [
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

export default function HomeScreen() {
  const { palette } = useTheme();
  const { market, api } = useAuth();
  const books = useBooks();
  const [picker, setPicker] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const detail = books.detail;

  useEffect(() => {
    if (!detail) return;
    api.orders(detail.id).then((result) => setOrders(result.orders.slice(0, 4))).catch(() => setOrders([]));
  }, [api, detail?.id, detail?.equity]);

  if (books.error && !detail) {
    return (
      <Screen onRefresh={books.refresh} refreshing={books.loading}>
        <Banner tone="bad">{books.error}</Banner>
      </Screen>
    );
  }

  if (!books.loading && books.portfolios.length === 0) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 24 }}>
          <Empty
            title="Open your first book"
            body="Start with $10,000, or set any balance from a dollar to a billion. Each book keeps its own cash, holdings, and history."
            action={<Button label="Create a portfolio" onPress={() => router.push("/portfolio/new")} />}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={books.refresh} refreshing={books.loading}>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Pressable onPress={() => setPicker(true)}>
            <Label>Portfolio</Label>
            <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 18 }}>
              {detail?.name ?? "Loading"} {detail?.agent ? "· Agent" : ""} ▾
            </Text>
          </Pressable>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: market?.open ? palette.up : palette.muted, fontFamily: "DMSans_700Bold", fontSize: 13 }}>
              {market?.open ? "NYSE open" : "NYSE closed"}
            </Text>
            {!market?.open && market?.nextOpen ? <Muted>{sessionTime(market.nextOpen)}</Muted> : null}
          </View>
        </View>

        {detail ? (
          <>
            <View>
              <Display>{money(detail.equity)}</Display>
              <ReturnText money={detail.totalReturn} percent={detail.totalReturnPct} />
              <Muted>From {money(detail.startingCash)} starting cash</Muted>
            </View>
            <Chart data={detail.chart.map((point) => point.equity)} positive={detail.totalReturn >= 0} />
            <Segment value={books.range} options={RANGES} onChange={books.setRange} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Stat label="Cash" value={money(detail.cash)} />
              <Stat label="Invested" value={money(detail.invested)} />
            </View>
            {!market?.open ? (
              <Banner>The NYSE is closed. Market orders queue and fill at the next open{market?.nextOpen ? `, ${sessionTime(market.nextOpen)}` : ""}.</Banner>
            ) : null}
            <View style={{ gap: 4 }}>
              <Label>Holdings</Label>
              {detail.positions.length === 0 ? <Muted>No positions yet. A trade will land here.</Muted> : null}
              {detail.positions.map((position) => (
                <Pressable key={position.symbol} onPress={() => router.push(`/symbol/${position.symbol}`)}>
                  <View style={{ paddingVertical: 10, gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <View>
                        <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 16 }}>{position.symbol}</Text>
                        <Muted>
                          {shares(position.shares)} sh · avg {price(position.averageCost)}
                        </Muted>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: palette.text, fontFamily: "DMSans_600SemiBold" }}>{money(position.marketValue)}</Text>
                        <ReturnText percent={position.totalReturnPct} />
                      </View>
                    </View>
                    <View style={{ height: 4, borderRadius: 4, backgroundColor: palette.elevated }}>
                      <View style={{ width: `${Math.max(4, position.contribution * 100)}%`, height: 4, borderRadius: 4, backgroundColor: palette.accent }} />
                    </View>
                    <Muted>{(position.contribution * 100).toFixed(1)}% of the book · {signedLine(position.totalReturn)}</Muted>
                  </View>
                </Pressable>
              ))}
            </View>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Label>Orders</Label>
                <Pressable onPress={() => router.push("/orders")}>
                  <Text style={{ color: palette.accent, fontFamily: "DMSans_600SemiBold" }}>History</Text>
                </Pressable>
              </View>
              {orders.length === 0 ? <Muted>No orders in this book yet.</Muted> : orders.map((order) => <OrderLine key={order.id} order={order} />)}
            </View>
          </>
        ) : (
          <Muted>Loading the book…</Muted>
        )}
      </View>
      <Modal visible={picker} animationType="slide" transparent onRequestClose={() => setPicker(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" }} onPress={() => setPicker(false)}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: palette.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8 }}>
            <HLine>Switch book</HLine>
            {books.portfolios.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setPicker(false);
                  void books.select(item.id);
                }}
                style={{ paddingVertical: 12, borderBottomColor: palette.line, borderBottomWidth: 1 }}
              >
                <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 16 }}>
                  {item.name}
                  {item.agent ? ` · ${item.agent.name}` : ""}
                </Text>
                <Muted>
                  {money(item.equity)} · {pct(item.totalReturnPct)}
                </Muted>
              </Pressable>
            ))}
            <Button
              label="New portfolio"
              tone="ghost"
              onPress={() => {
                setPicker(false);
                router.push("/portfolio/new");
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function signedLine(value: number) {
  return `${value >= 0 ? "Up" : "Down"} ${money(Math.abs(value))} on this lot`;
}

function Stat({ label, value }: { label: string; value: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Card>
        <Label>{label}</Label>
        <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 18, marginTop: 4 }}>{value}</Text>
      </Card>
    </View>
  );
}

function HLine({ children }: { children: string }) {
  const { palette } = useTheme();
  return <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 22 }}>{children}</Text>;
}

function OrderLine({ order }: { order: Order }) {
  const { palette } = useTheme();
  const color = order.status === "filled" ? palette.up : order.status === "rejected" ? palette.down : palette.accent;
  const amount = order.amountType === "dollars" ? money(order.amount) : `${shares(order.amount)} sh`;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
      <View>
        <Text style={{ color: palette.text, fontFamily: "DMSans_600SemiBold" }}>
          {order.side === "buy" ? "Buy" : "Sell"} {order.symbol}
        </Text>
        <Muted>
          {amount} · {when(order.createdAt)}
        </Muted>
      </View>
      <Text style={{ color, fontFamily: "DMSans_700Bold", textTransform: "capitalize" }}>{order.status === "pending" ? "Queued" : order.status}</Text>
    </View>
  );
}
