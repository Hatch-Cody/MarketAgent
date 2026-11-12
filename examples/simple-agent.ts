import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.MARKETSIM_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

function apiKey(): string {
  if (process.env.MARKETSIM_API_KEY) return process.env.MARKETSIM_API_KEY;
  const file = path.join(root, "server/data/demo-keys.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { agents: { name: string; apiKey: string }[] };
  const scout = parsed.agents.find((agent) => agent.name === "Scout") ?? parsed.agents[0];
  if (!scout?.apiKey) throw new Error(`No API key in ${file}. Create an agent in the app and set MARKETSIM_API_KEY.`);
  return scout.apiKey;
}

async function call(pathname: string, options?: { method?: string; body?: unknown }) {
  const response = await fetch(`${base}${pathname}`, {
    method: options?.method ?? "GET",
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(options?.body ? { "content-type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(`${options?.method ?? "GET"} ${pathname} -> ${response.status}: ${message}`);
  }
  return payload;
}

const key = apiKey();
const me = await call("/v1/me");
console.log(`Agent ${me.agent.name} · cash $${me.portfolio.cash.toFixed(2)} · NYSE ${me.market.open ? "open" : "closed"}`);

const search = await call("/v1/search?q=apple");
console.log(`Search "apple" -> ${search.results.slice(0, 3).map((hit: { symbol: string }) => hit.symbol).join(", ")}`);

const quote = await call("/v1/quote/AAPL");
console.log(`AAPL ${quote.quote.price} (${quote.quote.changePercent}%)`);

const buy = await call("/v1/orders", {
  method: "POST",
  body: { symbol: "AAPL", side: "buy", amountType: "dollars", amount: 150 },
});
console.log(buy.order.message);

const fractional = await call("/v1/orders", {
  method: "POST",
  body: { symbol: "MSFT", side: "buy", amountType: "shares", amount: 0.25 },
});
console.log(fractional.order.message);

const portfolio = await call("/v1/portfolio");
console.log(
  `Book now $${portfolio.portfolio.equity.toFixed(2)} cash $${portfolio.portfolio.cash.toFixed(2)} · ${portfolio.portfolio.positions.length} positions`,
);
const orders = await call("/v1/orders?limit=5");
for (const order of orders.orders) {
  console.log(`- ${order.status} ${order.side} ${order.symbol} ${order.amountType} ${order.amount}`);
}
