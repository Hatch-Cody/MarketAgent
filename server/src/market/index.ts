import { createFinnhubProvider } from "./finnhub.js";
import { createMockProvider } from "./mock.js";
import type { MarketDataProvider } from "./types.js";

export function createMarketDataProvider(env: NodeJS.ProcessEnv = process.env): MarketDataProvider {
  const choice = (env.MARKET_DATA_PROVIDER ?? "auto").toLowerCase();
  const apiKey = env.FINNHUB_API_KEY?.trim();
  if ((choice === "finnhub" || choice === "auto") && apiKey) {
    return createFinnhubProvider(apiKey);
  }
  if (choice === "finnhub" && !apiKey) {
    console.warn("MARKET_DATA_PROVIDER=finnhub but FINNHUB_API_KEY is empty. Using the built-in market.");
  }
  return createMockProvider();
}

export type { MarketDataProvider } from "./types.js";
