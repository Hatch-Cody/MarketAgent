import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { cors } from "hono/cors";
import { z } from "zod";
import { handleMcp } from "../mcp.js";
import { MarketDataError, type ChartRange, type MarketDataProvider } from "../market/types.js";
import type { Broker } from "../services/broker.js";
import { docsHtml, openApiSpec } from "./openapi.js";

type Variables = {
  userId: string;
  agentId: string;
  agentStatus: string;
  portfolioId: string;
};

function reply(c: Context, body: unknown, status: number) {
  return c.json(body, status as ContentfulStatusCode);
}

const symbolSchema = z.string().trim().min(1).max(12);
const orderSchema = z.object({
  symbol: symbolSchema,
  side: z.enum(["buy", "sell"]),
  amountType: z.enum(["shares", "dollars"]),
  amount: z.number().positive().finite(),
});

const ranges = ["1d", "1w", "1m", "3m", "1y", "5y"] as const;

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; message: string } {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    return { ok: false, message };
  }
  return { ok: true, data: result.data };
}

export function createApp(deps: { broker: Broker; provider: MarketDataProvider }) {
  const { broker, provider } = deps;
  const app = new Hono<{ Variables: Variables }>();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type", "Accept", "Mcp-Protocol-Version", "Mcp-Session-Id", "X-Api-Key"],
      exposeHeaders: ["Mcp-Session-Id"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: { code: "internal", message: "Unexpected server error." } }, 500);
  });

  app.get("/", (c) => c.html(docsHtml()));
  app.get("/docs", (c) => c.html(docsHtml()));
  app.get("/openapi.json", (c) => c.json(openApiSpec));
  app.get("/health", (c) =>
    c.json({
      ok: true,
      provider: provider.id,
      ...broker.marketStatus(),
    }),
  );

  app.all("/mcp", (c) => handleMcp(c.req.raw, broker, provider));

  app.post("/api/auth/register", async (c) => {
    const body = parsed(
      z.object({
        email: z.string().trim().email().max(200),
        password: z.string().min(8).max(200),
        name: z.string().trim().min(1).max(80),
      }),
      await c.req.json().catch(() => null),
    );
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.register(body.data);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const body = parsed(
      z.object({ email: z.string().trim().email(), password: z.string().min(1) }),
      await c.req.json().catch(() => null),
    );
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.login(body.data);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/auth/register" || c.req.path === "/api/auth/login") {
      await next();
      return;
    }
    const token = bearer(c.req.header("authorization"));
    const user = token ? broker.userFromToken(token) : null;
    if (!user) return c.json({ error: { code: "unauthorized", message: "Sign in again." } }, 401);
    c.set("userId", user.id);
    await next();
  });

  app.post("/api/auth/logout", (c) => {
    const token = bearer(c.req.header("authorization"));
    if (token) broker.logout(token);
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", (c) => {
    const token = bearer(c.req.header("authorization"));
    const user = token ? broker.userFromToken(token) : null;
    if (!user) return c.json({ error: { code: "unauthorized", message: "Sign in again." } }, 401);
    return c.json({ user, market: broker.marketStatus() });
  });

  app.patch("/api/me", async (c) => {
    const body = parsed(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        fillOnlyDuringMarketHours: z.boolean().optional(),
      }),
      await c.req.json().catch(() => null),
    );
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = broker.updateUser(c.get("userId"), body.data);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.get("/api/portfolios", async (c) => c.json({ portfolios: await broker.listPortfolios(c.get("userId")) }));

  app.post("/api/portfolios", async (c) => {
    const body = parsed(
      z.object({
        name: z.string().trim().min(1).max(40),
        startingCash: z.number().min(1).max(1_000_000_000),
      }),
      await c.req.json().catch(() => null),
    );
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = broker.createPortfolio(c.get("userId"), body.data);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    const view = await broker.getPortfolio(c.get("userId"), result.id, "1m");
    return c.json(view, 201);
  });

  app.get("/api/portfolios/:id", async (c) => {
    const range = c.req.query("range") ?? "1m";
    const result = await broker.getPortfolio(c.get("userId"), c.req.param("id"), range);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.patch("/api/portfolios/:id", async (c) => {
    const body = parsed(z.object({ name: z.string().trim().min(1).max(40) }), await c.req.json().catch(() => null));
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = broker.renamePortfolio(c.get("userId"), c.req.param("id"), body.data.name);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.delete("/api/portfolios/:id", (c) => {
    const result = broker.deletePortfolio(c.get("userId"), c.req.param("id"));
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.get("/api/portfolios/:id/orders", (c) => {
    const limit = clampLimit(c.req.query("limit"));
    const result = broker.listOrders(c.get("userId"), c.req.param("id"), limit);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.post("/api/portfolios/:id/orders", async (c) => {
    const body = parsed(orderSchema, await c.req.json().catch(() => null));
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.placeOrder({
      userId: c.get("userId"),
      portfolioId: c.req.param("id"),
      ...body.data,
    });
    return orderResponse(c, result);
  });

  app.get("/api/watchlist", async (c) => c.json({ watchlist: await broker.listWatchlist(c.get("userId")) }));
  app.post("/api/watchlist", async (c) => {
    const body = parsed(z.object({ symbol: symbolSchema }), await c.req.json().catch(() => null));
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.addWatch(c.get("userId"), body.data.symbol);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result, 201);
  });
  app.delete("/api/watchlist/:symbol", (c) => {
    broker.removeWatch(c.get("userId"), c.req.param("symbol"));
    return c.json({ ok: true });
  });

  app.get("/api/agents", async (c) => c.json({ agents: await broker.listAgents(c.get("userId")) }));
  app.post("/api/agents", async (c) => {
    const body = parsed(
      z.object({
        name: z.string().trim().min(1).max(40),
        portfolioId: z.string().optional(),
        startingCash: z.number().min(1).max(1_000_000_000).optional(),
        maxOrderSize: z.number().positive().max(1_000_000_000).optional(),
        maxTradesPerDay: z.number().int().min(1).max(10_000).optional(),
        allowedSymbols: z.array(z.string()).max(100).optional(),
      }),
      await c.req.json().catch(() => null),
    );
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.createAgent(c.get("userId"), {
      name: body.data.name,
      portfolioId: body.data.portfolioId,
      startingCash: body.data.startingCash,
      maxOrderSize: body.data.maxOrderSize ?? 2_000,
      maxTradesPerDay: body.data.maxTradesPerDay ?? 20,
      allowedSymbols: body.data.allowedSymbols ?? [],
    });
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result, 201);
  });

  app.get("/api/agents/activity", (c) => {
    return c.json({ activity: broker.activity(c.get("userId"), clampLimit(c.req.query("limit"))) });
  });
  app.get("/api/leaderboard", async (c) => c.json({ leaderboard: await broker.leaderboard(c.get("userId")) }));

  app.get("/api/agents/:id", async (c) => {
    const result = await broker.getAgent(c.get("userId"), c.req.param("id"));
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });
  app.patch("/api/agents/:id", async (c) => {
    const body = parsed(
      z.object({
        name: z.string().trim().min(1).max(40).optional(),
        status: z.enum(["active", "paused", "revoked"]).optional(),
        maxOrderSize: z.number().positive().max(1_000_000_000).optional(),
        maxTradesPerDay: z.number().int().min(1).max(10_000).optional(),
        allowedSymbols: z.array(z.string()).max(100).optional(),
      }),
      await c.req.json().catch(() => null),
    );
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.updateAgent(c.get("userId"), c.req.param("id"), body.data);
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });
  app.post("/api/agents/:id/rotate-key", async (c) => {
    const result = await broker.rotateKey(c.get("userId"), c.req.param("id"));
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });
  app.delete("/api/agents/:id", (c) => {
    const result = broker.deleteAgent(c.get("userId"), c.req.param("id"));
    if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
    return c.json(result);
  });

  app.get("/api/market/status", (c) => c.json(broker.marketStatus()));
  app.get("/api/market/search", async (c) => {
    try {
      return c.json({ results: await provider.search(c.req.query("q") ?? "") });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/api/market/quotes", async (c) => {
    const symbols = (c.req.query("symbols") ?? "").split(",").map((symbol) => symbol.trim()).filter(Boolean).slice(0, 40);
    try {
      return c.json({ quotes: await provider.quotes(symbols) });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/api/market/quote/:symbol", async (c) => {
    try {
      const quote = await provider.quote(c.req.param("symbol"));
      if (!quote) return c.json({ error: { code: "unknown_symbol", message: "No quote for that symbol." } }, 404);
      return c.json({ quote });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/api/market/history/:symbol", async (c) => {
    const range = ranges.includes(c.req.query("range") as ChartRange) ? (c.req.query("range") as ChartRange) : "1m";
    try {
      return c.json({ symbol: c.req.param("symbol").toUpperCase(), range, candles: await provider.history(c.req.param("symbol"), range) });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/api/market/profile/:symbol", async (c) => {
    try {
      const profile = await provider.profile(c.req.param("symbol"));
      if (!profile) return c.json({ error: { code: "unknown_symbol", message: "No profile for that symbol." } }, 404);
      return c.json({ profile });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/api/market/movers", async (c) => {
    try {
      return c.json(await provider.movers());
    } catch (error) {
      return marketFailure(c, error);
    }
  });

  app.use("/v1/*", async (c, next) => {
    const key = bearer(c.req.header("authorization")) ?? c.req.header("x-api-key") ?? "";
    const ctx = key ? broker.agentFromKey(key) : null;
    if (!ctx || ctx.agent.status === "revoked") {
      return c.json(
        { error: { code: ctx ? "agent_revoked" : "unauthorized", message: ctx ? "This agent key has been revoked." : "Unknown API key." } },
        401,
      );
    }
    c.set("userId", ctx.user.id);
    c.set("agentId", ctx.agent.id);
    c.set("agentStatus", ctx.agent.status);
    c.set("portfolioId", ctx.agent.portfolioId);
    await next();
  });

  app.get("/v1/me", async (c) => {
    const agentId = c.get("agentId");
    const portfolio = await broker.portfolioForAgent(agentId);
    const agent = (await broker.listAgents(c.get("userId"))).find((item) => item.id === agentId);
    return c.json({
      agent,
      portfolio,
      market: broker.marketStatus(),
    });
  });
  app.get("/v1/market", (c) => c.json(broker.marketStatus()));
  app.get("/v1/quote/:symbol", async (c) => {
    try {
      const quote = await provider.quote(c.req.param("symbol"));
      if (!quote) return c.json({ error: { code: "unknown_symbol", message: "No quote for that symbol." } }, 404);
      return c.json({ quote });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/v1/quotes", async (c) => {
    const symbols = (c.req.query("symbols") ?? "").split(",").map((symbol) => symbol.trim()).filter(Boolean).slice(0, 40);
    try {
      return c.json({ quotes: await provider.quotes(symbols) });
    } catch (error) {
      return marketFailure(c, error);
    }
  });
  app.get("/v1/search", async (c) => c.json({ results: await provider.search(c.req.query("q") ?? "") }));
  app.get("/v1/movers", async (c) => c.json(await provider.movers()));
  app.get("/v1/history/:symbol", async (c) => {
    const range = ranges.includes(c.req.query("range") as ChartRange) ? (c.req.query("range") as ChartRange) : "1m";
    return c.json({ symbol: c.req.param("symbol").toUpperCase(), range, candles: await provider.history(c.req.param("symbol"), range) });
  });
  app.get("/v1/portfolio", async (c) => {
    const portfolio = await broker.portfolioForAgent(c.get("agentId"));
    if (!portfolio) return c.json({ error: { code: "not_found", message: "Portfolio not found." } }, 404);
    return c.json({ portfolio });
  });
  app.get("/v1/positions", async (c) => {
    const portfolio = await broker.portfolioForAgent(c.get("agentId"));
    if (!portfolio) return c.json({ error: { code: "not_found", message: "Portfolio not found." } }, 404);
    return c.json({ cash: portfolio.cash, positions: portfolio.positions });
  });
  app.get("/v1/orders", (c) => {
    return c.json({ orders: broker.ordersForAgent(c.get("agentId"), clampLimit(c.req.query("limit"))) });
  });
  app.post("/v1/orders", async (c) => {
    if (c.get("agentStatus") === "paused") {
      return c.json({ error: { code: "agent_paused", message: "This agent is paused." } }, 403);
    }
    const body = parsed(orderSchema, await c.req.json().catch(() => null));
    if (!body.ok) return c.json({ error: { code: "invalid_body", message: body.message } }, 400);
    const result = await broker.placeOrder({
      userId: c.get("userId"),
      portfolioId: c.get("portfolioId"),
      agentId: c.get("agentId"),
      ...body.data,
    });
    return orderResponse(c, result);
  });

  return app;
}

function orderResponse(
  c: Context,
  result:
    | { ok: false; status: number; code: string; message: string }
    | { ok: true; status: number; code: string; order: { status: string; message: string | null } | null; portfolio: unknown },
) {
  if (!result.ok) return reply(c, { error: { code: result.code, message: result.message } }, result.status);
  if (result.status >= 400) {
    return reply(
      c,
      { error: { code: result.code, message: result.order?.message ?? "Order rejected." }, order: result.order },
      result.status,
    );
  }
  return reply(c, { code: result.code, order: result.order, portfolio: result.portfolio }, result.status);
}

function clampLimit(value: string | undefined): number {
  const parsedLimit = Number(value ?? 50);
  if (!Number.isFinite(parsedLimit)) return 50;
  return Math.min(200, Math.max(1, Math.floor(parsedLimit)));
}

function marketFailure(c: Context, error: unknown) {
  const message = error instanceof MarketDataError ? error.message : "Market data is unavailable.";
  return reply(c, { error: { code: "market_data", message } }, 502);
}
