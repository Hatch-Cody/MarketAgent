import { and, asc, count, desc, eq, gte, isNotNull } from "drizzle-orm";
import { hashPassword, newId, newSecret, sha256, verifyPassword } from "../auth/crypto.js";
import type { AppDb } from "../db/index.js";
import {
  agents,
  appliedActions,
  orders,
  portfolios,
  positions,
  sessions,
  snapshots,
  users,
  watchlist,
} from "../db/schema.js";
import { applySplit, dividendCreditCents, type CorporateAction } from "../engine/corporateActions.js";
import { isMarketOpen, marketStatus, startOfEtDay } from "../engine/marketHours.js";
import { evaluateOrder, type AccountState, type AmountType, type Position, type Side } from "../engine/trading.js";
import {
  centsToDollars,
  costCents,
  dollarsToCents,
  dollarsToTicks,
  microToShares,
  sharesToMicro,
  ticksToDollars,
} from "../money.js";
import { MarketDataError, type MarketDataProvider, type Quote } from "../market/types.js";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_CASH_CENTS = 100;
const MAX_CASH_CENTS = 100_000_000_000;

type Failure = { ok: false; status: number; code: string; message: string };
type OrderRow = typeof orders.$inferSelect;

function fail(status: number, code: string, message: string): Failure {
  return { ok: false, status, code, message };
}

function presentOrder(row: OrderRow) {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    agentId: row.agentId,
    agentName: row.agentName,
    symbol: row.symbol,
    side: row.side,
    amountType: row.amountType,
    amount: row.amountType === "shares" ? microToShares(row.amountMicro ?? 0) : centsToDollars(row.amountCents ?? 0),
    status: row.status,
    fillPrice: row.fillPriceTicks == null ? null : ticksToDollars(row.fillPriceTicks),
    fillShares: row.fillMicroshares == null ? null : microToShares(row.fillMicroshares),
    fillAmount: row.fillCents == null ? null : centsToDollars(row.fillCents),
    message: row.reason,
    createdAt: new Date(row.createdAt).toISOString(),
    filledAt: row.filledAt == null ? null : new Date(row.filledAt).toISOString(),
  };
}

function presentUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    fillOnlyDuringMarketHours: row.fillOnlyDuringMarketHours,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function parseSymbols(value: string): string[] {
  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

export function createBroker(db: AppDb, provider: MarketDataProvider, options?: { now?: () => Date }) {
  const now = options?.now ?? (() => new Date());

  function tx<T>(fn: (client: AppDb) => T): T {
    return db.transaction((client) => fn(client as unknown as AppDb));
  }

  function readState(client: AppDb, portfolioId: string): AccountState | null {
    const portfolio = client.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
    if (!portfolio) return null;
    const held = client.select().from(positions).where(eq(positions.portfolioId, portfolioId)).all();
    return {
      cashCents: portfolio.cashCents,
      positions: held.map((row) => ({
        symbol: row.symbol,
        microshares: row.microshares,
        avgCostTicks: row.avgCostTicks,
      })),
    };
  }

  function writeState(client: AppDb, portfolioId: string, state: AccountState) {
    client.update(portfolios).set({ cashCents: state.cashCents }).where(eq(portfolios.id, portfolioId)).run();
    client.delete(positions).where(eq(positions.portfolioId, portfolioId)).run();
    for (const position of state.positions) {
      client.insert(positions).values({
        portfolioId,
        symbol: position.symbol,
        microshares: position.microshares,
        avgCostTicks: position.avgCostTicks,
      }).run();
    }
  }

  function insertSnapshot(client: AppDb, portfolioId: string, at: number, equityCents: number, cashCents: number) {
    client.insert(snapshots).values({
      id: newId("snp"),
      portfolioId,
      at,
      equityCents,
      cashCents,
    }).run();
  }

  async function priceMap(symbols: string[]): Promise<Map<string, number>> {
    const quotes = symbols.length ? await provider.quotes(symbols) : [];
    return new Map(quotes.map((quote) => [quote.symbol, dollarsToTicks(quote.price)]));
  }

  function equityOf(state: AccountState, prices: Map<string, number>): number {
    let equity = state.cashCents;
    for (const position of state.positions) {
      const price = prices.get(position.symbol) ?? position.avgCostTicks;
      equity += costCents(position.microshares, price);
    }
    return equity;
  }

  async function applyCorporateActions(portfolioId: string) {
    let actions: CorporateAction[] = [];
    try {
      actions = await provider.corporateActions();
    } catch (error) {
      console.error("corporate actions", error);
      return;
    }
    if (!actions.length) return;
    const seen = new Set(
      db.select().from(appliedActions).where(eq(appliedActions.portfolioId, portfolioId)).all().map((row) => row.actionId),
    );
    for (const action of actions) {
      if (seen.has(action.id)) continue;
      tx((client) => {
        const position = client
          .select()
          .from(positions)
          .where(and(eq(positions.portfolioId, portfolioId), eq(positions.symbol, action.symbol)))
          .get();
        if (position && action.type === "split") {
          const next = applySplit(position.microshares, position.avgCostTicks, action.numerator, action.denominator);
          client
            .update(positions)
            .set(next)
            .where(and(eq(positions.portfolioId, portfolioId), eq(positions.symbol, action.symbol)))
            .run();
        } else if (position && action.type === "dividend") {
          const credit = dividendCreditCents(position.microshares, action.cashPerShareCents);
          const portfolio = client.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
          if (portfolio && credit > 0) {
            client
              .update(portfolios)
              .set({ cashCents: portfolio.cashCents + credit })
              .where(eq(portfolios.id, portfolioId))
              .run();
          }
        }
        client.insert(appliedActions).values({
          portfolioId,
          actionId: action.id,
          appliedAt: now().getTime(),
        }).run();
      });
    }
  }

  async function buildPortfolio(portfolioId: string, range = "1m") {
    await applyCorporateActions(portfolioId);
    const portfolio = db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
    if (!portfolio) return null;
    const state = readState(db, portfolioId);
    if (!state) return null;
    const symbols = state.positions.map((position) => position.symbol);
    let prices = new Map<string, number>();
    const quotes = new Map<string, Quote>();
    if (symbols.length) {
      const listed = await provider.quotes(symbols);
      for (const quote of listed) {
        quotes.set(quote.symbol, quote);
        prices.set(quote.symbol, dollarsToTicks(quote.price));
      }
    }
    const equityCents = equityOf(state, prices);
    const investedCents = Math.max(0, equityCents - state.cashCents);
    const totalReturnCents = equityCents - portfolio.startingCashCents;
    const totalReturnPct = portfolio.startingCashCents
      ? (totalReturnCents / portfolio.startingCashCents) * 100
      : 0;

    const held = state.positions
      .map((position) => {
        const priceTicks = prices.get(position.symbol) ?? position.avgCostTicks;
        const marketValueCents = costCents(position.microshares, priceTicks);
        const costBasisCents = costCents(position.microshares, position.avgCostTicks);
        const returnCents = marketValueCents - costBasisCents;
        const quote = quotes.get(position.symbol);
        return {
          symbol: position.symbol,
          name: quote?.name ?? position.symbol,
          shares: microToShares(position.microshares),
          averageCost: ticksToDollars(position.avgCostTicks),
          price: ticksToDollars(priceTicks),
          marketValue: centsToDollars(marketValueCents),
          totalReturn: centsToDollars(returnCents),
          totalReturnPct: costBasisCents ? (returnCents / costBasisCents) * 100 : 0,
          contribution: equityCents > 0 ? marketValueCents / equityCents : 0,
          dayChangePercent: quote?.changePercent ?? 0,
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);

    const latest = db
      .select()
      .from(snapshots)
      .where(eq(snapshots.portfolioId, portfolioId))
      .orderBy(desc(snapshots.at))
      .limit(1)
      .get();
    if (!latest || now().getTime() - latest.at > 15 * 60_000) {
      insertSnapshot(db, portfolioId, now().getTime(), equityCents, state.cashCents);
    }

    const start = chartStart(range, now().getTime());
    const history = db
      .select()
      .from(snapshots)
      .where(eq(snapshots.portfolioId, portfolioId))
      .orderBy(asc(snapshots.at))
      .all()
      .filter((row) => (start == null ? true : row.at >= start));
    const chart = history.map((row) => ({
      t: new Date(row.at).toISOString(),
      equity: centsToDollars(row.equityCents),
    }));
    const point = { t: now().toISOString(), equity: centsToDollars(equityCents) };
    if (!chart.length || Date.parse(chart[chart.length - 1].t) < now().getTime() - 1000) chart.push(point);

    const agent = db.select().from(agents).where(eq(agents.portfolioId, portfolioId)).get();
    return {
      id: portfolio.id,
      name: portfolio.name,
      cash: centsToDollars(state.cashCents),
      startingCash: centsToDollars(portfolio.startingCashCents),
      equity: centsToDollars(equityCents),
      invested: centsToDollars(investedCents),
      totalReturn: centsToDollars(totalReturnCents),
      totalReturnPct,
      createdAt: new Date(portfolio.createdAt).toISOString(),
      agent: agent
        ? { id: agent.id, name: agent.name, status: agent.status }
        : null,
      positions: held,
      chart,
    };
  }

  function insertOrder(
    client: AppDb,
    input: {
      userId: string;
      portfolioId: string;
      agentId: string | null;
      agentName: string | null;
      symbol: string;
      side: Side;
      amountType: AmountType;
      amount: number;
      status: string;
      priceTicks: number | null;
      fill?: { priceTicks: number; microshares: number; notionalCents: number };
      reason: string | null;
      at: number;
    },
  ) {
    const id = newId("ord");
    client.insert(orders).values({
      id,
      userId: input.userId,
      portfolioId: input.portfolioId,
      agentId: input.agentId,
      agentName: input.agentName,
      symbol: input.symbol,
      side: input.side,
      amountType: input.amountType,
      amountMicro: input.amountType === "shares" ? sharesToMicro(input.amount) : null,
      amountCents: input.amountType === "dollars" ? dollarsToCents(input.amount) : null,
      status: input.status,
      requestedPriceTicks: input.priceTicks,
      fillPriceTicks: input.fill?.priceTicks ?? null,
      fillMicroshares: input.fill?.microshares ?? null,
      fillCents: input.fill?.notionalCents ?? null,
      reason: input.reason,
      createdAt: input.at,
      updatedAt: input.at,
      filledAt: input.status === "filled" ? input.at : null,
    }).run();
    return id;
  }

  async function placeOrder(input: {
    userId: string;
    portfolioId: string;
    agentId?: string | null;
    symbol: string;
    side: Side;
    amountType: AmountType;
    amount: number;
  }) {
    const portfolio = db.select().from(portfolios).where(eq(portfolios.id, input.portfolioId)).get();
    if (!portfolio || portfolio.userId !== input.userId) {
      return fail(404, "not_found", "Portfolio not found.");
    }
    const user = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!user) return fail(404, "not_found", "Account not found.");

    let agent = input.agentId
      ? db.select().from(agents).where(eq(agents.id, input.agentId)).get()
      : undefined;
    if (input.agentId) {
      if (!agent || agent.userId !== input.userId || agent.portfolioId !== input.portfolioId) {
        return fail(404, "not_found", "Agent not found.");
      }
      if (agent.status === "revoked") return fail(401, "agent_revoked", "This agent's key has been revoked.");
      if (agent.status === "paused") return fail(403, "agent_paused", "This agent is paused.");
    }

    let quote: Quote | null;
    try {
      quote = await provider.quote(input.symbol);
    } catch (error) {
      const message = error instanceof MarketDataError ? error.message : "Market data is unavailable.";
      return fail(502, "market_data", message);
    }
    if (!quote) return fail(404, "unknown_symbol", `No quote for ${input.symbol.trim().toUpperCase()}.`);

    const at = now().getTime();
    const open = isMarketOpen(now());
    const queueIfClosed = user.fillOnlyDuringMarketHours;
    const priceTicks = dollarsToTicks(quote.price);
    const preview = readState(db, input.portfolioId);
    const marks = await priceMap([...(preview?.positions.map((position) => position.symbol) ?? []), quote.symbol]);
    marks.set(quote.symbol, priceTicks);

    const written = tx((client) => {
      const state = readState(client, input.portfolioId);
      if (!state) return fail(404, "not_found", "Portfolio not found.");
      const freshAgent = input.agentId
        ? client.select().from(agents).where(eq(agents.id, input.agentId)).get()
        : undefined;
      if (input.agentId && !freshAgent) return fail(404, "not_found", "Agent not found.");
      agent = freshAgent ?? agent;
      const dayStart = startOfEtDay(now()).getTime();
      const tradesToday = input.agentId
        ? Number(
            client
              .select({ n: count() })
              .from(orders)
              .where(
                and(
                  eq(orders.agentId, input.agentId),
                  gte(orders.createdAt, dayStart),
                  eq(orders.status, "filled"),
                ),
              )
              .get()?.n ?? 0,
          ) +
          Number(
            client
              .select({ n: count() })
              .from(orders)
              .where(
                and(
                  eq(orders.agentId, input.agentId),
                  gte(orders.createdAt, dayStart),
                  eq(orders.status, "pending"),
                ),
              )
              .get()?.n ?? 0,
          )
        : 0;

      let decision;
      try {
        decision = evaluateOrder({
          state,
          symbol: input.symbol,
          side: input.side,
          amountType: input.amountType,
          amount: input.amount,
          priceTicks,
          marketOpen: open,
          queueIfClosed,
          guardrails: freshAgent
            ? {
                maxOrderCents: freshAgent.maxOrderCents,
                maxTradesPerDay: freshAgent.maxTradesPerDay,
                tradesToday,
                allowedSymbols: parseSymbols(freshAgent.allowedSymbols),
              }
            : null,
        });
      } catch (error) {
        return fail(400, "invalid_amount", error instanceof Error ? error.message : "Invalid order.");
      }

      const symbol = input.symbol.trim().toUpperCase();
      if (decision.status === "rejected") {
        const id = insertOrder(client, {
          userId: input.userId,
          portfolioId: input.portfolioId,
          agentId: freshAgent?.id ?? null,
          agentName: freshAgent?.name ?? null,
          symbol,
          side: input.side,
          amountType: input.amountType,
          amount: input.amount,
          status: "rejected",
          priceTicks,
          reason: decision.message,
          at,
        });
        return { ok: true as const, id, httpStatus: decision.code === "trade_limit" || decision.code === "order_too_large" || decision.code === "symbol_not_allowed" ? 403 : 400, code: decision.code };
      }

      if (decision.status === "pending") {
        const id = insertOrder(client, {
          userId: input.userId,
          portfolioId: input.portfolioId,
          agentId: freshAgent?.id ?? null,
          agentName: freshAgent?.name ?? null,
          symbol,
          side: input.side,
          amountType: input.amountType,
          amount: input.amount,
          status: "pending",
          priceTicks,
          reason: decision.message,
          at,
        });
        return { ok: true as const, id, httpStatus: 202, code: "queued" };
      }

      writeState(client, input.portfolioId, decision.next);
      const id = insertOrder(client, {
        userId: input.userId,
        portfolioId: input.portfolioId,
        agentId: freshAgent?.id ?? null,
        agentName: freshAgent?.name ?? null,
        symbol,
        side: input.side,
        amountType: input.amountType,
        amount: input.amount,
        status: "filled",
        priceTicks,
        fill: decision.fill,
        reason: decision.message,
        at,
      });
      insertSnapshot(client, input.portfolioId, at, equityOf(decision.next, marks), decision.next.cashCents);
      return { ok: true as const, id, httpStatus: 201, code: "filled" };
    });

    if (!written.ok) return written;
    const row = db.select().from(orders).where(eq(orders.id, written.id)).get();
    const summary = await buildPortfolio(input.portfolioId, "1m");
    return {
      ok: true as const,
      status: written.httpStatus,
      code: written.code,
      order: row ? presentOrder(row) : null,
      portfolio: summary
        ? { cash: summary.cash, equity: summary.equity, totalReturn: summary.totalReturn, totalReturnPct: summary.totalReturnPct }
        : null,
    };
  }

  function settlePending(order: OrderRow, priceTicks: number) {
    if (priceTicks <= 0) {
      tx((client) => {
        client
          .update(orders)
          .set({ status: "rejected", reason: "No price was available at the open.", updatedAt: now().getTime() })
          .where(eq(orders.id, order.id))
          .run();
      });
      return "rejected" as const;
    }
    const user = db.select().from(users).where(eq(users.id, order.userId)).get();
    if (!user) return "skipped" as const;
    const open = isMarketOpen(now());
    if (!open && user.fillOnlyDuringMarketHours) return "skipped" as const;
    const agent = order.agentId ? db.select().from(agents).where(eq(agents.id, order.agentId)).get() : undefined;
    if (agent?.status === "paused") return "skipped" as const;

    const at = now().getTime();
    return tx((client) => {
      const current = client.select().from(orders).where(eq(orders.id, order.id)).get();
      if (!current || current.status !== "pending") return "skipped" as const;
      if (agent?.status === "revoked") {
        client
          .update(orders)
          .set({ status: "rejected", reason: "Agent was revoked before the order filled.", updatedAt: at })
          .where(eq(orders.id, order.id))
          .run();
        return "rejected" as const;
      }
      const state = readState(client, order.portfolioId);
      if (!state) return "skipped" as const;
      const amount = order.amountType === "shares" ? microToShares(order.amountMicro ?? 0) : centsToDollars(order.amountCents ?? 0);
      let decision;
      try {
        decision = evaluateOrder({
          state,
          symbol: order.symbol,
          side: order.side as Side,
          amountType: order.amountType as AmountType,
          amount,
          priceTicks,
          marketOpen: true,
          queueIfClosed: false,
          guardrails: agent
            ? {
                maxOrderCents: agent.maxOrderCents,
                maxTradesPerDay: Number.MAX_SAFE_INTEGER,
                tradesToday: 0,
                allowedSymbols: parseSymbols(agent.allowedSymbols),
              }
            : null,
        });
      } catch (error) {
        client
          .update(orders)
          .set({
            status: "rejected",
            reason: error instanceof Error ? error.message : "Could not fill the queued order.",
            updatedAt: at,
          })
          .where(eq(orders.id, order.id))
          .run();
        return "rejected" as const;
      }
      if (decision.status !== "filled") {
        client
          .update(orders)
          .set({ status: "rejected", reason: decision.message, updatedAt: at })
          .where(eq(orders.id, order.id))
          .run();
        return "rejected" as const;
      }
      writeState(client, order.portfolioId, decision.next);
      client
        .update(orders)
        .set({
          status: "filled",
          fillPriceTicks: decision.fill.priceTicks,
          fillMicroshares: decision.fill.microshares,
          fillCents: decision.fill.notionalCents,
          reason: decision.message,
          updatedAt: at,
          filledAt: at,
        })
        .where(eq(orders.id, order.id))
        .run();
      const prices = new Map<string, number>();
      for (const position of decision.next.positions) prices.set(position.symbol, position.avgCostTicks);
      prices.set(order.symbol, decision.fill.priceTicks);
      insertSnapshot(client, order.portfolioId, at, equityOf(decision.next, prices), decision.next.cashCents);
      return "filled" as const;
    });
  }

  return {
    now,
    marketStatus() {
      return marketStatus(now());
    },
    async register(input: { email: string; password: string; name: string }) {
      const email = input.email.trim().toLowerCase();
      const existing = db.select().from(users).where(eq(users.email, email)).get();
      if (existing) return fail(409, "email_taken", "An account with that email already exists.");
      const id = newId("usr");
      const at = now().getTime();
      db.insert(users).values({
        id,
        email,
        name: input.name.trim(),
        passwordHash: await hashPassword(input.password),
        fillOnlyDuringMarketHours: true,
        createdAt: at,
      }).run();
      const token = newSecret("ses");
      db.insert(sessions).values({
        id: newId("ses"),
        userId: id,
        tokenHash: sha256(token),
        createdAt: at,
        expiresAt: at + SESSION_MS,
      }).run();
      const user = db.select().from(users).where(eq(users.id, id)).get()!;
      return { ok: true as const, token, user: presentUser(user) };
    },
    async login(input: { email: string; password: string }) {
      const email = input.email.trim().toLowerCase();
      const user = db.select().from(users).where(eq(users.email, email)).get();
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        return fail(401, "invalid_login", "Email or password is incorrect.");
      }
      const token = newSecret("ses");
      const at = now().getTime();
      db.insert(sessions).values({
        id: newId("ses"),
        userId: user.id,
        tokenHash: sha256(token),
        createdAt: at,
        expiresAt: at + SESSION_MS,
      }).run();
      return { ok: true as const, token, user: presentUser(user) };
    },
    logout(token: string) {
      db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
    },
    userFromToken(token: string) {
      const session = db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token))).get();
      if (!session) return null;
      if (session.expiresAt < now().getTime()) {
        db.delete(sessions).where(eq(sessions.id, session.id)).run();
        return null;
      }
      const user = db.select().from(users).where(eq(users.id, session.userId)).get();
      return user ? presentUser(user) : null;
    },
    updateUser(userId: string, patch: { name?: string; fillOnlyDuringMarketHours?: boolean }) {
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) return fail(404, "not_found", "Account not found.");
      db.update(users)
        .set({
          name: patch.name?.trim() || user.name,
          fillOnlyDuringMarketHours: patch.fillOnlyDuringMarketHours ?? user.fillOnlyDuringMarketHours,
        })
        .where(eq(users.id, userId))
        .run();
      return { ok: true as const, user: presentUser(db.select().from(users).where(eq(users.id, userId)).get()!) };
    },
    async listPortfolios(userId: string) {
      const rows = db.select().from(portfolios).where(eq(portfolios.userId, userId)).all();
      const summaries = [];
      for (const row of rows) {
        const view = await buildPortfolio(row.id, "1m");
        if (!view) continue;
        summaries.push({
          id: view.id,
          name: view.name,
          cash: view.cash,
          equity: view.equity,
          totalReturn: view.totalReturn,
          totalReturnPct: view.totalReturnPct,
          startingCash: view.startingCash,
          agent: view.agent,
          createdAt: view.createdAt,
        });
      }
      return summaries;
    },
    createPortfolio(userId: string, input: { name: string; startingCash: number }) {
      const cents = dollarsToCents(input.startingCash);
      if (cents < MIN_CASH_CENTS || cents > MAX_CASH_CENTS) {
        return fail(400, "invalid_amount", "Starting cash must be between $1 and $1,000,000,000.");
      }
      const id = newId("prt");
      const at = now().getTime();
      db.insert(portfolios).values({
        id,
        userId,
        name: input.name.trim(),
        cashCents: cents,
        startingCashCents: cents,
        createdAt: at,
      }).run();
      insertSnapshot(db, id, at, cents, cents);
      return { ok: true as const, id };
    },
    async getPortfolio(userId: string, portfolioId: string, range: string) {
      const portfolio = db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
      if (!portfolio || portfolio.userId !== userId) return fail(404, "not_found", "Portfolio not found.");
      const view = await buildPortfolio(portfolioId, range);
      if (!view) return fail(404, "not_found", "Portfolio not found.");
      return { ok: true as const, portfolio: view };
    },
    renamePortfolio(userId: string, portfolioId: string, name: string) {
      const portfolio = db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
      if (!portfolio || portfolio.userId !== userId) return fail(404, "not_found", "Portfolio not found.");
      db.update(portfolios).set({ name: name.trim() }).where(eq(portfolios.id, portfolioId)).run();
      return { ok: true as const };
    },
    deletePortfolio(userId: string, portfolioId: string) {
      const portfolio = db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
      if (!portfolio || portfolio.userId !== userId) return fail(404, "not_found", "Portfolio not found.");
      const agent = db.select().from(agents).where(eq(agents.portfolioId, portfolioId)).get();
      if (agent) return fail(409, "portfolio_has_agent", "Delete the agent attached to this portfolio first.");
      db.delete(portfolios).where(eq(portfolios.id, portfolioId)).run();
      return { ok: true as const };
    },
    placeOrder,
    listOrders(userId: string, portfolioId: string, limit: number) {
      const portfolio = db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
      if (!portfolio || portfolio.userId !== userId) return fail(404, "not_found", "Portfolio not found.");
      const rows = db
        .select()
        .from(orders)
        .where(eq(orders.portfolioId, portfolioId))
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .all();
      return { ok: true as const, orders: rows.map(presentOrder) };
    },
    async listWatchlist(userId: string) {
      const rows = db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(desc(watchlist.createdAt)).all();
      const quotes = await provider.quotes(rows.map((row) => row.symbol));
      const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
      return rows.map((row) => ({
        symbol: row.symbol,
        addedAt: new Date(row.createdAt).toISOString(),
        quote: bySymbol.get(row.symbol) ?? null,
      }));
    },
    async addWatch(userId: string, symbol: string) {
      const normalized = symbol.trim().toUpperCase();
      let quote: Quote | null;
      try {
        quote = await provider.quote(normalized);
      } catch (error) {
        const message = error instanceof MarketDataError ? error.message : "Market data is unavailable.";
        return fail(502, "market_data", message);
      }
      if (!quote) return fail(404, "unknown_symbol", `No quote for ${normalized}.`);
      const existing = db
        .select()
        .from(watchlist)
        .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, normalized)))
        .get();
      if (!existing) {
        db.insert(watchlist).values({ userId, symbol: normalized, createdAt: now().getTime() }).run();
      }
      return { ok: true as const, symbol: normalized };
    },
    removeWatch(userId: string, symbol: string) {
      db.delete(watchlist)
        .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol.trim().toUpperCase())))
        .run();
      return { ok: true as const };
    },
    async listAgents(userId: string) {
      const rows = db.select().from(agents).where(eq(agents.userId, userId)).all();
      const result = [];
      for (const agent of rows) {
        const view = await buildPortfolio(agent.portfolioId, "1m");
        result.push(presentAgent(agent, view));
      }
      return result;
    },
    async createAgent(userId: string, input: {
      name: string;
      portfolioId?: string;
      startingCash?: number;
      maxOrderSize: number;
      maxTradesPerDay: number;
      allowedSymbols: string[];
    }) {
      let portfolioId = input.portfolioId;
      if (portfolioId) {
        const portfolio = db.select().from(portfolios).where(eq(portfolios.id, portfolioId)).get();
        if (!portfolio || portfolio.userId !== userId) return fail(404, "not_found", "Portfolio not found.");
        const taken = db.select().from(agents).where(eq(agents.portfolioId, portfolioId)).get();
        if (taken) return fail(409, "portfolio_has_agent", "That portfolio already has an agent.");
      } else {
        const created = this.createPortfolio(userId, {
          name: `${input.name.trim()} book`,
          startingCash: input.startingCash ?? 10_000,
        });
        if (!created.ok) return created;
        portfolioId = created.id;
      }
      const key = newSecret("mks");
      const id = newId("agt");
      db.insert(agents).values({
        id,
        userId,
        portfolioId,
        name: input.name.trim(),
        keyHash: sha256(key),
        keyPrefix: key.slice(0, 12),
        status: "active",
        maxOrderCents: dollarsToCents(input.maxOrderSize),
        maxTradesPerDay: input.maxTradesPerDay,
        allowedSymbols: normalizeSymbols(input.allowedSymbols).join(","),
        createdAt: now().getTime(),
      }).run();
      const agent = db.select().from(agents).where(eq(agents.id, id)).get()!;
      const view = await buildPortfolio(portfolioId, "1m");
      return { ok: true as const, agent: presentAgent(agent, view), apiKey: key };
    },
    async getAgent(userId: string, agentId: string) {
      const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (!agent || agent.userId !== userId) return fail(404, "not_found", "Agent not found.");
      const view = await buildPortfolio(agent.portfolioId, "1m");
      return { ok: true as const, agent: presentAgent(agent, view) };
    },
    async updateAgent(userId: string, agentId: string, patch: {
      name?: string;
      status?: "active" | "paused" | "revoked";
      maxOrderSize?: number;
      maxTradesPerDay?: number;
      allowedSymbols?: string[];
    }) {
      const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (!agent || agent.userId !== userId) return fail(404, "not_found", "Agent not found.");
      db.update(agents)
        .set({
          name: patch.name?.trim() || agent.name,
          status: patch.status ?? agent.status,
          maxOrderCents: patch.maxOrderSize == null ? agent.maxOrderCents : dollarsToCents(patch.maxOrderSize),
          maxTradesPerDay: patch.maxTradesPerDay ?? agent.maxTradesPerDay,
          allowedSymbols: patch.allowedSymbols ? normalizeSymbols(patch.allowedSymbols).join(",") : agent.allowedSymbols,
        })
        .where(eq(agents.id, agentId))
        .run();
      const next = db.select().from(agents).where(eq(agents.id, agentId)).get()!;
      const view = await buildPortfolio(next.portfolioId, "1m");
      return { ok: true as const, agent: presentAgent(next, view) };
    },
    async rotateKey(userId: string, agentId: string) {
      const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (!agent || agent.userId !== userId) return fail(404, "not_found", "Agent not found.");
      const key = newSecret("mks");
      db.update(agents)
        .set({
          keyHash: sha256(key),
          keyPrefix: key.slice(0, 12),
          status: agent.status === "revoked" ? "active" : agent.status,
        })
        .where(eq(agents.id, agentId))
        .run();
      return { ok: true as const, apiKey: key, keyPrefix: key.slice(0, 12) };
    },
    deleteAgent(userId: string, agentId: string) {
      const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (!agent || agent.userId !== userId) return fail(404, "not_found", "Agent not found.");
      db.delete(agents).where(eq(agents.id, agentId)).run();
      return { ok: true as const, portfolioId: agent.portfolioId };
    },
    activity(userId: string, limit: number) {
      const rows = db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, userId), isNotNull(orders.agentName)))
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .all();
      return rows.map(presentOrder);
    },
    async leaderboard(userId: string) {
      const books = db.select().from(portfolios).where(eq(portfolios.userId, userId)).all();
      const rows = [];
      for (const book of books) {
        const view = await buildPortfolio(book.id, "all");
        if (!view) continue;
        rows.push({
          portfolioId: book.id,
          name: view.agent?.name ?? view.name,
          kind: view.agent ? "agent" : "portfolio",
          agentId: view.agent?.id ?? null,
          status: view.agent?.status ?? null,
          equity: view.equity,
          startingCash: view.startingCash,
          totalReturn: view.totalReturn,
          totalReturnPct: view.totalReturnPct,
        });
      }
      rows.sort((a, b) => b.totalReturnPct - a.totalReturnPct);
      return rows.map((row, index) => ({ rank: index + 1, ...row }));
    },
    agentFromKey(key: string) {
      const agent = db.select().from(agents).where(eq(agents.keyHash, sha256(key))).get();
      if (!agent) return null;
      const user = db.select().from(users).where(eq(users.id, agent.userId)).get();
      if (!user) return null;
      return { agent, user: presentUser(user) };
    },
    async portfolioForAgent(agentId: string) {
      const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (!agent) return null;
      return buildPortfolio(agent.portfolioId, "1m");
    },
    ordersForAgent(agentId: string, limit: number) {
      const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (!agent) return [];
      return db
        .select()
        .from(orders)
        .where(eq(orders.portfolioId, agent.portfolioId))
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .all()
        .map(presentOrder);
    },
    async processPending() {
      const pending = db.select().from(orders).where(eq(orders.status, "pending")).orderBy(asc(orders.createdAt)).all();
      if (!pending.length) return { filled: 0, rejected: 0, skipped: 0 };
      let quotes: Quote[] = [];
      try {
        quotes = await provider.quotes([...new Set(pending.map((order) => order.symbol))]);
      } catch (error) {
        console.error(error);
        return { filled: 0, rejected: 0, skipped: pending.length };
      }
      const prices = new Map(quotes.map((quote) => [quote.symbol, dollarsToTicks(quote.price)]));
      let filled = 0;
      let rejected = 0;
      let skipped = 0;
      for (const order of pending) {
        const outcome = settlePending(order, prices.get(order.symbol) ?? 0);
        if (outcome === "filled") filled += 1;
        else if (outcome === "rejected") rejected += 1;
        else skipped += 1;
      }
      if (filled || rejected) console.log(`Pending orders: ${filled} filled, ${rejected} rejected, ${skipped} still waiting.`);
      return { filled, rejected, skipped };
    },
    applyHistoricalFill(input: {
      userId: string;
      portfolioId: string;
      agentId: string | null;
      agentName: string | null;
      symbol: string;
      side: Side;
      amountType: AmountType;
      amount: number;
      price: number;
      at: number;
    }) {
      const priceTicks = dollarsToTicks(input.price);
      tx((client) => {
        const state = readState(client, input.portfolioId);
        if (!state) throw new Error("Missing portfolio during seed.");
        const decision = evaluateOrder({
          state,
          symbol: input.symbol,
          side: input.side,
          amountType: input.amountType,
          amount: input.amount,
          priceTicks,
          marketOpen: true,
          queueIfClosed: false,
        });
        if (decision.status !== "filled") {
          throw new Error(`Seed order failed: ${decision.message}`);
        }
        writeState(client, input.portfolioId, decision.next);
        insertOrder(client, {
          userId: input.userId,
          portfolioId: input.portfolioId,
          agentId: input.agentId,
          agentName: input.agentName,
          symbol: input.symbol.toUpperCase(),
          side: input.side,
          amountType: input.amountType,
          amount: input.amount,
          status: "filled",
          priceTicks,
          fill: decision.fill,
          reason: decision.message,
          at: input.at,
        });
      });
    },
    recordSnapshots(portfolioId: string, points: { at: number; equityCents: number; cashCents: number }[]) {
      tx((client) => {
        for (const point of points) insertSnapshot(client, portfolioId, point.at, point.equityCents, point.cashCents);
      });
    },
    clearSnapshots(portfolioId: string) {
      db.delete(snapshots).where(eq(snapshots.portfolioId, portfolioId)).run();
    },
    readBook(portfolioId: string) {
      return readState(db, portfolioId);
    },
  };
}

function chartStart(range: string, at: number): number | null {
  const day = 86_400_000;
  if (range === "1w") return at - 7 * day;
  if (range === "1m") return at - 31 * day;
  if (range === "3m") return at - 93 * day;
  if (range === "1y") return at - 366 * day;
  if (range === "all") return null;
  return at - 31 * day;
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function presentAgent(
  agent: typeof agents.$inferSelect,
  view: {
    name: string;
    cash: number;
    equity: number;
    totalReturn: number;
    totalReturnPct: number;
    startingCash: number;
  } | null,
) {
  return {
    id: agent.id,
    name: agent.name,
    portfolioId: agent.portfolioId,
    portfolioName: view?.name ?? agent.name,
    status: agent.status,
    keyPrefix: agent.keyPrefix,
    maxOrderSize: centsToDollars(agent.maxOrderCents),
    maxTradesPerDay: agent.maxTradesPerDay,
    allowedSymbols: parseSymbols(agent.allowedSymbols),
    createdAt: new Date(agent.createdAt).toISOString(),
    cash: view?.cash ?? null,
    equity: view?.equity ?? null,
    startingCash: view?.startingCash ?? null,
    totalReturn: view?.totalReturn ?? null,
    totalReturnPct: view?.totalReturnPct ?? null,
  };
}

export type Broker = ReturnType<typeof createBroker>;
