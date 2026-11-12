import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "@/auth";
import { useBooks } from "@/books";
import { BackHeader, Muted, Screen } from "@/components/ui";
import { money, shares, when } from "@/format";
import { useTheme } from "@/theme";
import type { Order } from "@/types";

export default function OrdersScreen() {
  const { api } = useAuth();
  const books = useBooks();
  const { palette } = useTheme();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!books.selectedId) return;
    api.orders(books.selectedId).then((result) => setOrders(result.orders)).catch(() => setOrders([]));
  }, [api, books.selectedId]);

  return (
    <Screen>
      <BackHeader title="Orders" subtitle={books.detail?.name} />
      {orders.length === 0 ? <Muted>No orders in this book yet.</Muted> : null}
      {orders.map((order) => {
        const color = order.status === "filled" ? palette.up : order.status === "rejected" ? palette.down : palette.accent;
        return (
          <View key={order.id} style={{ paddingVertical: 12, borderBottomColor: palette.line, borderBottomWidth: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold" }}>
                {order.side === "buy" ? "Buy" : "Sell"} {order.symbol}
              </Text>
              <Text style={{ color, fontFamily: "DMSans_700Bold", textTransform: "capitalize" }}>
                {order.status === "pending" ? "Queued" : order.status}
              </Text>
            </View>
            <Muted>
              {order.amountType === "dollars" ? money(order.amount) : `${shares(order.amount)} shares`}
              {order.fillShares != null ? ` · filled ${shares(order.fillShares)} @ ${money(order.fillPrice ?? 0)}` : ""} · {when(order.createdAt)}
            </Muted>
            {order.message ? <Muted>{order.message}</Muted> : null}
          </View>
        );
      })}
    </Screen>
  );
}
