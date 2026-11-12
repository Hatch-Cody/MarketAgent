export type User = {
  id: string;
  email: string;
  name: string;
  fillOnlyDuringMarketHours: boolean;
  createdAt: string;
};

export type MarketState = {
  exchange: string;
  timezone: string;
  open: boolean;
  session: string;
  nextOpen: string | null;
  asOf: string;
};

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
  asOf: string;
};

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

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

export type SearchHit = { symbol: string; name: string; type: string; exchange: string };

export type Position = {
  symbol: string;
  name: string;
  shares: number;
  averageCost: number;
  price: number;
  marketValue: number;
  totalReturn: number;
  totalReturnPct: number;
  contribution: number;
  dayChangePercent: number;
};

export type PortfolioDetail = {
  id: string;
  name: string;
  cash: number;
  startingCash: number;
  equity: number;
  invested: number;
  totalReturn: number;
  totalReturnPct: number;
  createdAt: string;
  agent: { id: string; name: string; status: string } | null;
  positions: Position[];
  chart: { t: string; equity: number }[];
};

export type PortfolioSummary = {
  id: string;
  name: string;
  cash: number;
  equity: number;
  totalReturn: number;
  totalReturnPct: number;
  startingCash: number;
  agent: { id: string; name: string; status: string } | null;
  createdAt: string;
};

export type Order = {
  id: string;
  portfolioId: string;
  agentId: string | null;
  agentName: string | null;
  symbol: string;
  side: "buy" | "sell";
  amountType: "shares" | "dollars";
  amount: number;
  status: "pending" | "filled" | "rejected" | string;
  fillPrice: number | null;
  fillShares: number | null;
  fillAmount: number | null;
  message: string | null;
  createdAt: string;
  filledAt: string | null;
};

export type Agent = {
  id: string;
  name: string;
  portfolioId: string;
  portfolioName: string;
  status: string;
  keyPrefix: string;
  maxOrderSize: number;
  maxTradesPerDay: number;
  allowedSymbols: string[];
  createdAt: string;
  cash: number | null;
  equity: number | null;
  startingCash: number | null;
  totalReturn: number | null;
  totalReturnPct: number | null;
};

export type LeaderRow = {
  rank: number;
  portfolioId: string;
  name: string;
  kind: "agent" | "portfolio";
  agentId: string | null;
  status: string | null;
  equity: number;
  startingCash: number;
  totalReturn: number;
  totalReturnPct: number;
};
