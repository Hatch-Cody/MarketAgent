import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "@/auth";
import { Banner, Button, Card, Empty, Label, Muted, Screen } from "@/components/ui";
import { money, pct, when } from "@/format";
import { useTheme } from "@/theme";
import type { Agent, LeaderRow, Order } from "@/types";

export default function AgentsScreen() {
  const { api } = useAuth();
  const { palette } = useTheme();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [activity, setActivity] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agentRows, leaderboard, feed] = await Promise.all([api.agents(), api.leaderboard(), api.activity()]);
      setAgents(agentRows.agents);
      setBoard(leaderboard.leaderboard);
      setActivity(feed.activity);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load agents.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Label>Desk</Label>
            <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 28 }}>Agents</Text>
          </View>
          <Button label="New" onPress={() => router.push("/agent/new")} />
        </View>
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <Card>
          <Label>Leaderboard</Label>
          {board.length === 0 ? <Muted>Create a book or an agent to compare returns.</Muted> : null}
          {board.map((row) => (
            <View key={row.portfolioId} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold" }}>
                  {row.rank}. {row.name}
                </Text>
                <Muted>{row.kind === "agent" ? "Agent" : "Your book"}{row.status ? ` · ${row.status}` : ""}</Muted>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: palette.text, fontFamily: "DMSans_600SemiBold" }}>{money(row.equity)}</Text>
                <Text style={{ color: row.totalReturnPct >= 0 ? palette.up : palette.down, fontFamily: "DMSans_700Bold" }}>{pct(row.totalReturnPct)}</Text>
              </View>
            </View>
          ))}
        </Card>
        {agents.length === 0 ? (
          <Empty
            title="No agents yet"
            body="Give an agent a book, a key, and a few guardrails. It can trade through the REST API or MCP."
            action={<Button label="Create an agent" onPress={() => router.push("/agent/new")} />}
          />
        ) : (
          agents.map((agent) => (
            <Pressable key={agent.id} onPress={() => router.push(`/agent/${agent.id}`)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <View>
                    <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 18 }}>{agent.name}</Text>
                    <Muted>
                      {agent.status} · key {agent.keyPrefix}…
                    </Muted>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold" }}>{agent.equity == null ? "—" : money(agent.equity)}</Text>
                    <Text style={{ color: (agent.totalReturnPct ?? 0) >= 0 ? palette.up : palette.down, fontFamily: "DMSans_700Bold" }}>
                      {agent.totalReturnPct == null ? "" : pct(agent.totalReturnPct)}
                    </Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))
        )}
        <View style={{ gap: 6 }}>
          <Label>Activity</Label>
          {activity.length === 0 ? <Muted>Agent orders show up here as soon as they are placed, including ones still queued for the open.</Muted> : null}
          {activity.map((order) => (
            <View key={order.id} style={{ paddingVertical: 8, borderBottomColor: palette.line, borderBottomWidth: 1 }}>
              <Text style={{ color: palette.text, fontFamily: "DMSans_600SemiBold" }}>
                {order.agentName} {order.side} {order.symbol}
              </Text>
              <Muted>
                {order.status} · {order.amountType === "dollars" ? money(order.amount) : `${order.amount} sh`} · {when(order.createdAt)}
              </Muted>
            </View>
          ))}
        </View>
      </View>
    </Screen>
  );
}
