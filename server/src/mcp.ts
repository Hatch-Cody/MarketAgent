import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Broker } from "./services/broker.js";
import { MarketDataError, type MarketDataProvider } from "./market/types.js";

type AgentContext = NonNullable<ReturnType<Broker["agentFromKey"]>>;

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

function createServer(broker: Broker, provider: MarketDataProvider, ctx: AgentContext) {
  const mcp = new McpServer({ name: "marketsim", version: "1.0.0" });
  const agent = ctx.agent;

  mcp.registerTool(
    "get_market_status",
    {
      title: "Market status",
      description: "Whether the NYSE regular session is open, and when it next opens.",
      inputSchema: {},
    },
    async () => text({ ...broker.marketStatus(), fillOnlyDuringMarketHours: ctx.user.fillOnlyDuringMarketHours }),
  );

  mcp.registerTool(
    "get_quote",
    {
      title: "Get quote",
      description: "Latest price quote for a ticker.",
      inputSchema: { symbol: z.string().describe("Ticker symbol, for example AAPL") },
    },
    async ({ symbol }) => {
      try {
        const quote = await provider.quote(symbol);
        if (!quote) return toolError(`No quote for ${symbol}.`);
        return text(quote);
      } catch (error) {
        return toolError(error instanceof MarketDataError ? error.message : "Market data is unavailable.");
      }
    },
  );

  mcp.registerTool(
    "search_symbols",
    {
      title: "Search symbols",
      description: "Search companies by name or ticker.",
      inputSchema: { query: z.string().describe("Name or ticker fragment") },
    },
    async ({ query }) => text({ results: await provider.search(query) }),
  );

  mcp.registerTool(
    "get_movers",
    {
      title: "Get movers",
      description: "Most active names, top gainers, and top losers.",
      inputSchema: {},
    },
    async () => text(await provider.movers()),
  );

  mcp.registerTool(
    "get_price_history",
    {
      title: "Price history",
      description: "Candles for a symbol. Range is 1d, 1w, 1m, 3m, 1y, or 5y.",
      inputSchema: {
        symbol: z.string(),
        range: z.enum(["1d", "1w", "1m", "3m", "1y", "5y"]).optional(),
      },
    },
    async ({ symbol, range }) => text({ symbol, range: range ?? "1m", candles: await provider.history(symbol, range ?? "1m") }),
  );

  mcp.registerTool(
    "get_portfolio",
    {
      title: "Get portfolio",
      description: "Cash, equity, return, and positions for this agent's portfolio.",
      inputSchema: {},
    },
    async () => {
      const portfolio = await broker.portfolioForAgent(agent.id);
      if (!portfolio) return toolError("Portfolio not found.");
      return text(portfolio);
    },
  );

  mcp.registerTool(
    "get_positions",
    {
      title: "Get positions",
      description: "Open positions with shares, average cost, and market value.",
      inputSchema: {},
    },
    async () => {
      const portfolio = await broker.portfolioForAgent(agent.id);
      if (!portfolio) return toolError("Portfolio not found.");
      return text({ cash: portfolio.cash, positions: portfolio.positions });
    },
  );

  mcp.registerTool(
    "list_orders",
    {
      title: "List orders",
      description: "Recent orders for this agent, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => text({ orders: broker.ordersForAgent(agent.id, limit ?? 50) }),
  );

  mcp.registerTool(
    "place_order",
    {
      title: "Place order",
      description:
        "Place a market buy or sell by share count or dollar amount. Fractional shares are allowed. Orders placed while the NYSE is closed are queued for the next open when the account requires it. Guardrails (max order size, daily trade limit, allowed symbols) are enforced.",
      inputSchema: {
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        amountType: z.enum(["shares", "dollars"]),
        amount: z.number().positive(),
      },
    },
    async ({ symbol, side, amountType, amount }) => {
      if (agent.status === "paused") return toolError("This agent is paused.");
      if (agent.status === "revoked") return toolError("This agent key has been revoked.");
      const result = await broker.placeOrder({
        userId: agent.userId,
        portfolioId: agent.portfolioId,
        agentId: agent.id,
        symbol,
        side,
        amountType,
        amount,
      });
      if (!result.ok) return toolError(result.message);
      if (result.order?.status === "rejected") return toolError(result.order.message ?? "Order rejected.");
      return text({ code: result.code, order: result.order, portfolio: result.portfolio });
    },
  );

  return mcp;
}

export async function handleMcp(request: Request, broker: Broker, provider: MarketDataProvider): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const key = match?.[1]?.trim() || request.headers.get("x-api-key")?.trim() || "";
  if (!key) {
    return new Response(JSON.stringify({ error: { code: "unauthorized", message: "Send the agent API key as a bearer token." } }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
    });
  }
  const ctx = broker.agentFromKey(key);
  if (!ctx || ctx.agent.status === "revoked") {
    return new Response(
      JSON.stringify({
        error: {
          code: ctx ? "agent_revoked" : "unauthorized",
          message: ctx ? "This agent key has been revoked." : "Unknown API key.",
        },
      }),
      { status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } },
    );
  }

  const mcp = createServer(broker, provider, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  const response = await transport.handleRequest(request);
  if (request.method !== "GET") {
    await mcp.close().catch(() => undefined);
  } else {
    request.signal.addEventListener("abort", () => {
      void mcp.close();
    });
  }
  return response;
}
