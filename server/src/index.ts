import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { openDatabase } from "./db/index.js";
import { createApp } from "./http/app.js";
import { createMarketDataProvider } from "./market/index.js";
import { seedIfEmpty } from "./seed.js";
import { createBroker } from "./services/broker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.DATABASE_PATH ?? path.join(root, "data", "marketsim.sqlite");
const { db } = openDatabase(dbPath);
const provider = createMarketDataProvider();
const broker = createBroker(db, provider);

await seedIfEmpty(db, provider, broker, path.join(root, "data", "demo-keys.json"));

const app = createApp({ broker, provider });
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`MarketSim server http://127.0.0.1:${info.port}`);
  console.log(`Market data: ${provider.id}`);
  console.log(`Docs http://127.0.0.1:${info.port}/docs`);
});

const timer = setInterval(() => {
  broker.processPending().catch((error) => console.error(error));
}, 15_000);
timer.unref();
void broker.processPending();
