import fs from "node:fs";
import path from "node:path";
import { count } from "drizzle-orm";
import type { AppDb } from "./db/index.js";
import { users } from "./db/schema.js";
import { etToUtc, nyParts } from "./engine/marketHours.js";
import { costCents, dollarsToTicks } from "./money.js";
import type { MarketDataProvider } from "./market/types.js";
import type { Broker } from "./services/broker.js";

const DEMO_EMAIL = "demo@marketsim.app";
const DEMO_PASSWORD = "password123";

type Planned = { daysAgo: number; symbol: string; side: "buy" | "sell"; dollars: number };

export async function seedIfEmpty(db: AppDb, provider: MarketDataProvider, broker: Broker, keysFile: string) {
  const flag = process.env.SEED_DEMO?.toLowerCase();
  if (flag === "0" || flag === "false") return;
  const existing = db.select({ n: count() }).from(users).get();
  if (Number(existing?.n ?? 0) > 0) {
    console.log("Database already has accounts. Skipping demo seed.");
    return;
  }

  const registered = await broker.register({ email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo" });
  if (!registered.ok) throw new Error(registered.message);
  const userId = registered.user.id;

  const primary = broker.createPortfolio(userId, { name: "Primary", startingCash: 10_000 });
  if (!primary.ok) throw new Error(primary.message);
  const scout = await broker.createAgent(userId, {
    name: "Scout",
    startingCash: 10_000,
    maxOrderSize: 2_000,
    maxTradesPerDay: 20,
    allowedSymbols: [],
  });
  const hawk = await broker.createAgent(userId, {
    name: "Hawk",
    startingCash: 10_000,
    maxOrderSize: 2_500,
    maxTradesPerDay: 20,
    allowedSymbols: [],
  });
  if (!scout.ok || !hawk.ok) throw new Error("Could not seed agents.");

  await replay(broker, provider, {
    userId,
    portfolioId: primary.id,
    agentId: null,
    agentName: null,
    trades: [
      { daysAgo: 78, symbol: "AAPL", side: "buy", dollars: 2200 },
      { daysAgo: 60, symbol: "MSFT", side: "buy", dollars: 1800 },
      { daysAgo: 36, symbol: "NVDA", side: "buy", dollars: 1500 },
      { daysAgo: 18, symbol: "JPM", side: "buy", dollars: 900 },
    ],
  });
  await replay(broker, provider, {
    userId,
    portfolioId: scout.agent.portfolioId,
    agentId: scout.agent.id,
    agentName: "Scout",
    trades: [
      { daysAgo: 54, symbol: "NVDA", side: "buy", dollars: 2200 },
      { daysAgo: 40, symbol: "COST", side: "buy", dollars: 1600 },
      { daysAgo: 16, symbol: "XOM", side: "buy", dollars: 800 },
      { daysAgo: 9, symbol: "NVDA", side: "sell", dollars: 400 },
    ],
  });
  await replay(broker, provider, {
    userId,
    portfolioId: hawk.agent.portfolioId,
    agentId: hawk.agent.id,
    agentName: "Hawk",
    trades: [
      { daysAgo: 48, symbol: "TSLA", side: "buy", dollars: 2800 },
      { daysAgo: 22, symbol: "INTC", side: "buy", dollars: 1600 },
    ],
  });

  const payload = {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    agents: [
      { name: "Scout", apiKey: scout.apiKey, portfolioId: scout.agent.portfolioId },
      { name: "Hawk", apiKey: hawk.apiKey, portfolioId: hawk.agent.portfolioId },
    ],
  };
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, JSON.stringify(payload, null, 2));
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Seeded agent keys (shown once) are in ${keysFile}`);
}

async function replay(
  broker: Broker,
  provider: MarketDataProvider,
  book: {
    userId: string;
    portfolioId: string;
    agentId: string | null;
    agentName: string | null;
    trades: Planned[];
  },
) {
  const maps = new Map<string, Map<string, number>>();
  for (const symbol of new Set(book.trades.map((trade) => trade.symbol))) {
    maps.set(symbol, await closeMap(provider, symbol));
  }
  const planned = book.trades
    .map((trade) => ({ ...trade, day: dayKey(trade.daysAgo) }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.symbol.localeCompare(b.symbol));
  const days = weekdayKeys(Math.max(...book.trades.map((trade) => trade.daysAgo)) + 1);
  let index = 0;
  const points: { at: number; equityCents: number; cashCents: number }[] = [];
  for (const day of days) {
    while (index < planned.length && planned[index].day <= day) {
      const trade = planned[index];
      index += 1;
      const price = closeOn(maps.get(trade.symbol) ?? new Map(), trade.day);
      if (!price) continue;
      broker.applyHistoricalFill({
        userId: book.userId,
        portfolioId: book.portfolioId,
        agentId: book.agentId,
        agentName: book.agentName,
        symbol: trade.symbol,
        side: trade.side,
        amountType: "dollars",
        amount: trade.dollars,
        price,
        at: stamp(trade.day),
      });
    }
    const state = broker.readBook(book.portfolioId);
    if (!state) continue;
    let equity = state.cashCents;
    let complete = true;
    for (const position of state.positions) {
      if (!maps.has(position.symbol)) maps.set(position.symbol, await closeMap(provider, position.symbol));
      const price = closeOn(maps.get(position.symbol) ?? new Map(), day);
      if (!price) {
        complete = false;
        break;
      }
      equity += costCents(position.microshares, dollarsToTicks(price));
    }
    if (complete) points.push({ at: stamp(day), equityCents: equity, cashCents: state.cashCents });
  }
  broker.clearSnapshots(book.portfolioId);
  broker.recordSnapshots(book.portfolioId, points);
}

async function closeMap(provider: MarketDataProvider, symbol: string) {
  const candles = await provider.history(symbol, "1y");
  const map = new Map<string, number>();
  for (const candle of candles) map.set(new Date(candle.t).toISOString().slice(0, 10), candle.c);
  return map;
}

function closeOn(map: Map<string, number>, day: string): number | null {
  if (map.has(day)) return map.get(day) ?? null;
  let best: string | null = null;
  for (const key of map.keys()) {
    if (key <= day && (best == null || key > best)) best = key;
  }
  return best ? map.get(best) ?? null : null;
}

function dayKey(daysAgo: number): string {
  return nyParts(new Date(Date.now() - daysAgo * 86_400_000)).dateKey;
}

function weekdayKeys(fromDaysAgo: number): string[] {
  const keys: string[] = [];
  for (let ago = fromDaysAgo; ago >= 0; ago -= 1) {
    const key = dayKey(ago);
    const [year, month, day] = key.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.sort();
}

function stamp(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return etToUtc(year, month, date, 15, 30).getTime();
}
