import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useAuth } from "@/auth";
import { useBooks } from "@/books";
import { BackHeader, Banner, Button, Field, Muted, Screen } from "@/components/ui";
import { money, pct, when } from "@/format";
import { stashKey } from "@/keys";
import { useTheme } from "@/theme";
import type { Agent, Order } from "@/types";

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const books = useBooks();
  const { palette } = useTheme();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [maxOrder, setMaxOrder] = useState("");
  const [maxTrades, setMaxTrades] = useState("");
  const [symbols, setSymbols] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function load() {
    if (!id) return;
    const result = await api.agent(id);
    setAgent(result.agent);
    setMaxOrder(String(result.agent.maxOrderSize));
    setMaxTrades(String(result.agent.maxTradesPerDay));
    setSymbols(result.agent.allowedSymbols.join(", "));
    const history = await api.orders(result.agent.portfolioId);
    setOrders(history.orders.slice(0, 12));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [id]);

  if (!agent) {
    return (
      <Screen>
        <BackHeader title="Agent" />
        {error ? <Banner tone="bad">{error}</Banner> : <Muted>Loading…</Muted>}
      </Screen>
    );
  }

  async function patch(body: Record<string, unknown>) {
    setError(null);
    try {
      const result = await api.updateAgent(agent!.id, body);
      setAgent(result.agent);
      await books.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the agent.");
    }
  }

  return (
    <Screen>
      <BackHeader title={agent.name} subtitle={`${agent.status} · ${agent.portfolioName}`} />
      <View style={{ gap: 14 }}>
        <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 36 }}>
          {agent.equity == null ? "—" : money(agent.equity)}
        </Text>
        <Text style={{ color: (agent.totalReturnPct ?? 0) >= 0 ? palette.up : palette.down, fontFamily: "DMSans_700Bold" }}>
          {agent.totalReturn == null ? "" : `${money(agent.totalReturn)}  ${pct(agent.totalReturnPct ?? 0)}`}
        </Text>
        <Muted>Key prefix {agent.keyPrefix}…</Muted>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Field label="Max order ($)" keyboardType="decimal-pad" value={maxOrder} onChangeText={setMaxOrder} />
        <Field label="Max trades / day" keyboardType="number-pad" value={maxTrades} onChangeText={setMaxTrades} />
        <Field label="Allowed symbols" autoCapitalize="characters" value={symbols} onChangeText={setSymbols} placeholder="Blank allows every ticker" />
        <Button
          label="Save guardrails"
          onPress={() =>
            patch({
              maxOrderSize: Number(maxOrder),
              maxTradesPerDay: Number(maxTrades),
              allowedSymbols: symbols.split(",").map((item) => item.trim()).filter(Boolean),
            })
          }
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={agent.status === "paused" ? "Resume" : "Pause"}
              tone="ghost"
              onPress={() => patch({ status: agent.status === "paused" ? "active" : "paused" })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="New key"
              tone="ghost"
              onPress={async () => {
                const rotated = await api.rotateKey(agent.id);
                stashKey({ agentId: agent.id, name: agent.name, apiKey: rotated.apiKey });
                router.push(`/agent/reveal?id=${agent.id}`);
              }}
            />
          </View>
        </View>
        {confirmRevoke ? (
          <Banner tone="bad">Revoking disables this key. Generating a new key turns the agent back on.</Banner>
        ) : null}
        <Button
          label={confirmRevoke ? "Confirm revoke" : "Revoke"}
          tone="danger"
          onPress={() => {
            if (!confirmRevoke) {
              setConfirmRevoke(true);
              return;
            }
            void patch({ status: "revoked" });
            setConfirmRevoke(false);
          }}
        />
        <Button
          label="Delete agent"
          tone="ghost"
          onPress={async () => {
            await api.deleteAgent(agent.id);
            await books.refresh();
            router.replace("/agents");
          }}
        />
        <Muted>Deleting the agent keeps the portfolio.</Muted>
        {orders.map((order) => (
          <View key={order.id} style={{ paddingVertical: 8, borderBottomColor: palette.line, borderBottomWidth: 1 }}>
            <Text style={{ color: palette.text, fontFamily: "DMSans_600SemiBold" }}>
              {order.side} {order.symbol} · {order.status}
            </Text>
            <Muted>
              {order.message} · {when(order.createdAt)}
            </Muted>
          </View>
        ))}
      </View>
    </Screen>
  );
}
