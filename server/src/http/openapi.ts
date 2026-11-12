export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "MarketSim Agent API",
    version: "1.0.0",
    description:
      "Paper-trading API for MarketSim. User routes under /api use a session token from /api/auth/login. Agent routes under /v1 use an agent API key (Authorization: Bearer mks_…). The same key authenticates the MCP endpoint at /mcp.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
            required: ["code", "message"],
          },
        },
        required: ["error"],
      },
      OrderRequest: {
        type: "object",
        properties: {
          symbol: { type: "string", examples: ["AAPL"] },
          side: { type: "string", enum: ["buy", "sell"] },
          amountType: { type: "string", enum: ["shares", "dollars"] },
          amount: { type: "number", exclusiveMinimum: 0 },
        },
        required: ["symbol", "side", "amountType", "amount"],
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Server health, data provider, and NYSE session",
        responses: { "200": { description: "Health" } },
      },
    },
    "/api/auth/register": {
      post: {
        summary: "Create a user and return a session token",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["email", "password", "name"] } } },
        },
        responses: { "201": { description: "Created" }, "409": { description: "Email taken" } },
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Exchange email and password for a session token",
        responses: { "200": { description: "Token" }, "401": { description: "Invalid login" } },
      },
    },
    "/v1/me": {
      get: {
        summary: "Agent account, cash, guardrails, and market session",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Account" }, "401": { description: "Bad key" } },
      },
    },
    "/v1/quote/{symbol}": {
      get: {
        summary: "Latest quote",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "symbol", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Quote" }, "404": { description: "Unknown symbol" } },
      },
    },
    "/v1/quotes": {
      get: {
        summary: "Quotes for a comma-separated symbol list",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "symbols", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Quotes" } },
      },
    },
    "/v1/search": {
      get: {
        summary: "Search companies by name or ticker",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Hits" } },
      },
    },
    "/v1/movers": {
      get: {
        summary: "Most active, top gainers, and top losers",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Movers" } },
      },
    },
    "/v1/history/{symbol}": {
      get: {
        summary: "Price history",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" } },
          { name: "range", in: "query", schema: { type: "string", enum: ["1d", "1w", "1m", "3m", "1y", "5y"] } },
        ],
        responses: { "200": { description: "Candles" } },
      },
    },
    "/v1/portfolio": {
      get: {
        summary: "Cash, equity, return, and positions for this agent's portfolio",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Portfolio" } },
      },
    },
    "/v1/positions": {
      get: {
        summary: "Open positions",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Positions" } },
      },
    },
    "/v1/orders": {
      get: {
        summary: "Order history, newest first",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "Orders" } },
      },
      post: {
        summary: "Place a market order by shares or dollars. Queues until the next NYSE open when the market is closed.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/OrderRequest" } } },
        },
        responses: {
          "201": { description: "Filled" },
          "202": { description: "Queued for the next open" },
          "400": { description: "Rejected (cash, shares, or size)" },
          "403": { description: "Paused, or blocked by a guardrail" },
        },
      },
    },
    "/v1/market": {
      get: {
        summary: "Whether the NYSE regular session is open",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Session" } },
      },
    },
    "/mcp": {
      post: {
        summary: "MCP Streamable HTTP endpoint. Send JSON-RPC with the agent API key.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "JSON-RPC response" } },
      },
    },
  },
} as const;

export function docsHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MarketSim API</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: "Iowan Old Style", Palatino, Georgia, serif; background: #10140f; color: #f3f1e7; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px 80px; }
    h1 { font-weight: 560; letter-spacing: -0.03em; margin-bottom: 0; }
    p, li { line-height: 1.5; }
    a { color: #e3b23c; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
    pre { background: #1c2419; border: 1px solid #2a3326; padding: 14px 16px; border-radius: 12px; overflow: auto; }
    .muted { color: #9aa592; }
  </style>
</head>
<body>
  <main>
    <p class="muted">MarketSim</p>
    <h1>Agent API</h1>
    <p>Paper trading for people and for agents. Session tokens (from the app) call <code>/api</code>. Agent keys call <code>/v1</code> and the MCP endpoint at <code>/mcp</code>.</p>
    <p>Machine-readable spec: <a href="/openapi.json">/openapi.json</a></p>
    <h2>REST</h2>
    <pre>curl -s http://127.0.0.1:8787/v1/me \\
  -H "Authorization: Bearer mks_your_key"

curl -s http://127.0.0.1:8787/v1/orders \\
  -H "Authorization: Bearer mks_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","side":"buy","amountType":"dollars","amount":150}'</pre>
    <p class="muted">Buys and sells are market orders. Fractional shares are allowed. Outside 9:30–16:00 America/New_York on a regular session day, orders stay queued and fill at the next open unless the account turns that off in Settings.</p>
    <h2>MCP</h2>
    <p>Streamable HTTP. Point a client at <code>http://127.0.0.1:8787/mcp</code> and send the same bearer key. Tools: <code>get_market_status</code>, <code>get_quote</code>, <code>search_symbols</code>, <code>get_movers</code>, <code>get_price_history</code>, <code>get_portfolio</code>, <code>get_positions</code>, <code>list_orders</code>, <code>place_order</code>.</p>
    <pre>{
  "mcpServers": {
    "marketsim": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Bearer mks_your_key" }
    }
  }
}</pre>
  </main>
</body>
</html>`;
}
