import type { CorporateAction } from "../engine/corporateActions.js";

export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y" | "5y";

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  currency: "USD";
  asOf: string;
};

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Profile = {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  exchange: string;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  averageVolume: number | null;
};

export type SearchHit = {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
};

export interface MarketDataProvider {
  id: "mock" | "finnhub";
  search(query: string): Promise<SearchHit[]>;
  quote(symbol: string): Promise<Quote | null>;
  quotes(symbols: string[]): Promise<Quote[]>;
  history(symbol: string, range: ChartRange): Promise<Candle[]>;
  movers(): Promise<{ active: Quote[]; gainers: Quote[]; losers: Quote[] }>;
  profile(symbol: string): Promise<Profile | null>;
  corporateActions(): Promise<CorporateAction[]>;
}

export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}
