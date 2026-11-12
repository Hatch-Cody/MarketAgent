import { describe, expect, it } from "vitest";
import { applySplit, dividendCreditCents } from "../src/engine/corporateActions.js";
import { openDatabase } from "../src/db/index.js";
import { createApp } from "../src/http/app.js";
import type { Candle, MarketDataProvider, Quote } from "../src/market/types.js";
import { createBroker } from "../src/services/broker.js";
import { sharesToMicro } from "../src/money.js";

function quote(symbol: string, price: number): Quote {
  return {
    symbol,
    name: symbol,
    price,
    change: 0,
    changePercent: 0,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    volume: 1_000_000,
    currency: "USD",
    asOf: new Date(0).toISOString(),
  };
}

function provider(price = 50): MarketDataProvider & { setPrice(symbol: string, next: number): void } {
  const prices = new Map<string, number>();
  const api: MarketDataProvider = {
    id: "mock",
    async search() {
      return [{ symbol: "AAPL", name: "Apple", type: "Common Stock", exchange: "NASDAQ" }];
    },
    async quote(symbol: string) {
      const normalized = symbol.toUpperCase();
      return quote(normalized, prices.get(normalized) ?? price);
    },
    async quotes(symbols: string[]) {
      const rows: Quote[] = [];
      for (const symbol of symbols) {
        const row = await api.quote(symbol);
        if (row) rows.push(row);
      }
      return rows;
    },
    async history(): Promise<Candle[]> {
      return [];
    },
    async movers() {
      const row = quote("AAPL", price);
      return { active: [row], gainers: [row], losers: [row] };
    },
    async profile(symbol: string) {
      return {
        symbol: symbol.toUpperCase(),
        name: symbol,
        description: "Test listing",
        sector: "Test",
        industry: "Test",
        exchange: "NASDAQ",
        marketCap: null,
        pe: null,
        eps: null,
        dividendYield: null,
        week52High: null,
        week52Low: null,
        averageVolume: null,
      };
    },
    async corporateActions() {
      return [];
    },
  };
  return Object.assign(api, {
    setPrice(symbol: string, next: number) {
      prices.set(symbol.toUpperCase(), next);
    },
  });
}

function harness(start = new Date("2026-11-14T16:00:00Z")) {
  const clock = { date: start };
  const data = provider(50);
  const { db } = openDatabase(":memory:");
  const broker = createBroker(db, data, { now: () => clock.date });
  const app = createApp({ broker, provider: data });
  return { clock, data, broker, app };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("order API", () => {
  it("queues a closed-market order and fills it at the next open", async () => {
    const { clock, app, broker } = harness();
    const registered = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123", name: "Ada" }),
    });
    const auth = (await json(registered)) as { token: string };
    const headers = { "content-type": "application/json", authorization: `Bearer ${auth.token}` };
    const created = await app.request("/api/portfolios", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Primary", startingCash: 10_000 }),
    });
    const portfolio = (await json(created)) as { portfolio: { id: string; cash: number } };
    expect(created.status).toBe(201);

    const queued = await app.request(`/api/portfolios/${portfolio.portfolio.id}/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ symbol: "AAPL", side: "buy", amountType: "shares", amount: 2 }),
    });
    expect(queued.status).toBe(202);
    const still = await app.request(`/api/portfolios/${portfolio.portfolio.id}`, { headers });
    const before = (await json(still)) as { portfolio: { cash: number; positions: unknown[] } };
    expect(before.portfolio.cash).toBe(10_000);
    expect(before.portfolio.positions).toEqual([]);

    clock.date = new Date("2026-11-16T15:00:00Z");
    const processed = await broker.processPending();
    expect(processed.filled).toBe(1);
    const after = (await json(await app.request(`/api/portfolios/${portfolio.portfolio.id}`, { headers }))) as {
      portfolio: { cash: number; positions: { shares: number; symbol: string }[] };
    };
    expect(after.portfolio.cash).toBe(9_900);
    expect(after.portfolio.positions[0]).toMatchObject({ symbol: "AAPL", shares: 2 });
  });

  it("enforces agent guardrails and allows a fractional dollar buy", async () => {
    const { app, data } = harness(new Date("2026-11-16T15:00:00Z"));
    data.setPrice("AAPL", 33.33);
    const auth = (await json(
      await app.request("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "agent@example.com", password: "password123", name: "Agent" }),
      }),
    )) as { token: string };
    const headers = { "content-type": "application/json", authorization: `Bearer ${auth.token}` };
    const created = (await json(
      await app.request("/api/agents", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Scout", startingCash: 1_000, maxOrderSize: 100, maxTradesPerDay: 2, allowedSymbols: ["AAPL"] }),
      }),
    )) as { apiKey: string };
    const agentHeaders = { "content-type": "application/json", authorization: `Bearer ${created.apiKey}` };

    const tooBig = await app.request("/v1/orders", {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ symbol: "AAPL", side: "buy", amountType: "dollars", amount: 150 }),
    });
    expect(tooBig.status).toBe(403);
    expect(await json(tooBig)).toMatchObject({ error: { code: "order_too_large" } });

    const blocked = await app.request("/v1/orders", {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ symbol: "MSFT", side: "buy", amountType: "dollars", amount: 25 }),
    });
    expect(blocked.status).toBe(403);

    const filled = await app.request("/v1/orders", {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ symbol: "AAPL", side: "buy", amountType: "dollars", amount: 100 }),
    });
    expect(filled.status).toBe(201);
    const body = (await json(filled)) as { order: { fillShares: number; fillAmount: number }; portfolio: { cash: number } };
    expect(body.order.fillAmount).toBeLessThanOrEqual(100);
    expect(body.order.fillAmount).toBeGreaterThan(99);
    expect(body.order.fillShares).toBeGreaterThan(2);
    expect(Number.isInteger(body.order.fillShares)).toBe(false);
    expect(body.portfolio.cash).toBeCloseTo(1_000 - body.order.fillAmount, 2);

    const third = await app.request("/v1/orders", {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ symbol: "AAPL", side: "buy", amountType: "dollars", amount: 10 }),
    });
    expect(third.status).toBe(201);
    const fourth = await app.request("/v1/orders", {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({ symbol: "AAPL", side: "buy", amountType: "dollars", amount: 10 }),
    });
    expect(fourth.status).toBe(403);
    expect(await json(fourth)).toMatchObject({ error: { code: "trade_limit" } });
  });

  it("applies a dividend and a split from the provider", async () => {
    const { app, data, broker } = harness(new Date("2026-11-16T15:00:00Z"));
    const auth = (await json(
      await app.request("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "corp@example.com", password: "password123", name: "Corp" }),
      }),
    )) as { token: string };
    const headers = { "content-type": "application/json", authorization: `Bearer ${auth.token}` };
    const created = (await json(
      await app.request("/api/portfolios", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Primary", startingCash: 1_000 }),
      }),
    )) as { portfolio: { id: string } };
    await app.request(`/api/portfolios/${created.portfolio.id}/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ symbol: "AAPL", side: "buy", amountType: "shares", amount: 4 }),
    });
    data.corporateActions = async () => [
      { id: "div-1", type: "dividend", symbol: "AAPL", cashPerShareCents: 25, date: "2026-11-16" },
      { id: "split-1", type: "split", symbol: "AAPL", numerator: 2, denominator: 1, date: "2026-11-16" },
    ];
    const view = (await json(await app.request(`/api/portfolios/${created.portfolio.id}`, { headers }))) as {
      portfolio: { cash: number; positions: { shares: number; averageCost: number }[] };
    };
    const credit = dividendCreditCents(sharesToMicro(4), 25) / 100;
    expect(view.portfolio.cash).toBeCloseTo(1_000 - 200 + credit, 2);
    expect(view.portfolio.positions[0]?.shares).toBe(applySplit(sharesToMicro(4), 1, 2, 1).microshares / 1_000_000);
    expect(broker.marketStatus().open).toBe(true);
  });
});
