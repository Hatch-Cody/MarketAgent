import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.MARKETSIM_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

function apiKey(): string {
  if (process.env.MARKETSIM_API_KEY) return process.env.MARKETSIM_API_KEY;
  const parsed = JSON.parse(readFileSync(path.join(root, "server/data/demo-keys.json"), "utf8")) as {
    agents: { name: string; apiKey: string }[];
  };
  return (parsed.agents.find((agent) => agent.name === "Hawk") ?? parsed.agents[0]).apiKey;
}

const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${apiKey()}` } },
});
const client = new Client({ name: "marketsim-example", version: "1.0.0" });
await client.connect(transport);

const listed = await client.listTools();
console.log("Tools:", listed.tools.map((tool) => tool.name).join(", "));

const quote = await client.callTool({ name: "get_quote", arguments: { symbol: "NVDA" } });
console.log(textOf(quote));

const order = await client.callTool({
  name: "place_order",
  arguments: { symbol: "KO", side: "buy", amountType: "dollars", amount: 75 },
});
console.log(textOf(order));

await client.close();

function textOf(result: { content?: { type: string; text?: string }[]; isError?: boolean }): string {
  const text = (result.content ?? []).map((block) => block.text ?? "").join("\n");
  return result.isError ? `Error: ${text}` : text;
}
