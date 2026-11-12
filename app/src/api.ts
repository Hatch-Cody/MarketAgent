import type {
  Agent,
  Candle,
  LeaderRow,
  MarketState,
  Order,
  PortfolioDetail,
  PortfolioSummary,
  Profile,
  Quote,
  SearchHit,
  User,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ClientConfig = { baseUrl: string; token: string | null };

export function createApi(getConfig: () => ClientConfig) {
  async function request<T>(path: string, options?: { method?: string; body?: unknown; auth?: boolean }): Promise<T> {
    const { baseUrl, token } = getConfig();
    const headers: Record<string, string> = { accept: "application/json" };
    if (options?.body !== undefined) headers["content-type"] = "application/json";
    if (options?.auth !== false && token) headers.authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options?.method ?? "GET",
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new ApiError(`Can't reach ${baseUrl}. Check the server address in Settings.`, 0, "network");
    }
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      const message = payload?.error?.message ?? `Request failed (${response.status}).`;
      const code = payload?.error?.code ?? "error";
      throw new ApiError(message, response.status, code);
    }
    return payload as T;
  }

  return {
    request,
    health: () => request<MarketState & { ok: boolean; provider: string }>("/health", { auth: false }),
    register: (body: { email: string; password: string; name: string }) =>
      request<{ token: string; user: User }>("/api/auth/register", { method: "POST", body, auth: false }),
    login: (body: { email: string; password: string }) =>
      request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body, auth: false }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    me: () => request<{ user: User; market: MarketState }>("/api/auth/me"),
    updateMe: (body: { name?: string; fillOnlyDuringMarketHours?: boolean }) =>
      request<{ user: User }>("/api/me", { method: "PATCH", body }),
    portfolios: () => request<{ portfolios: PortfolioSummary[] }>("/api/portfolios"),
    portfolio: (id: string, range: string) =>
      request<{ portfolio: PortfolioDetail }>(`/api/portfolios/${id}?range=${range}`),
    createPortfolio: (body: { name: string; startingCash: number }) =>
      request<{ portfolio: PortfolioDetail }>("/api/portfolios", { method: "POST", body }),
    orders: (id: string) => request<{ orders: Order[] }>(`/api/portfolios/${id}/orders?limit=100`),
    placeOrder: (id: string, body: { symbol: string; side: "buy" | "sell"; amountType: "shares" | "dollars"; amount: number }) =>
      request<{ code: string; order: Order; portfolio: { cash: number; equity: number } }>(`/api/portfolios/${id}/orders`, {
        method: "POST",
        body,
      }),
    search: (q: string) => request<{ results: SearchHit[] }>(`/api/market/search?q=${encodeURIComponent(q)}`),
    quote: (symbol: string) => request<{ quote: Quote }>(`/api/market/quote/${encodeURIComponent(symbol)}`),
    history: (symbol: string, range: string) =>
      request<{ candles: Candle[] }>(`/api/market/history/${encodeURIComponent(symbol)}?range=${range}`),
    profile: (symbol: string) => request<{ profile: Profile }>(`/api/market/profile/${encodeURIComponent(symbol)}`),
    movers: () => request<{ active: Quote[]; gainers: Quote[]; losers: Quote[] }>("/api/market/movers"),
    market: () => request<MarketState>("/api/market/status"),
    watchlist: () => request<{ watchlist: { symbol: string; addedAt: string; quote: Quote | null }[] }>("/api/watchlist"),
    addWatch: (symbol: string) => request("/api/watchlist", { method: "POST", body: { symbol } }),
    removeWatch: (symbol: string) => request(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
    agents: () => request<{ agents: Agent[] }>("/api/agents"),
    agent: (id: string) => request<{ agent: Agent }>(`/api/agents/${id}`),
    createAgent: (body: {
      name: string;
      portfolioId?: string;
      startingCash?: number;
      maxOrderSize?: number;
      maxTradesPerDay?: number;
      allowedSymbols?: string[];
    }) => request<{ agent: Agent; apiKey: string }>("/api/agents", { method: "POST", body }),
    updateAgent: (id: string, body: Record<string, unknown>) => request<{ agent: Agent }>(`/api/agents/${id}`, { method: "PATCH", body }),
    rotateKey: (id: string) => request<{ apiKey: string; keyPrefix: string }>(`/api/agents/${id}/rotate-key`, { method: "POST" }),
    deleteAgent: (id: string) => request(`/api/agents/${id}`, { method: "DELETE" }),
    activity: () => request<{ activity: Order[] }>("/api/agents/activity?limit=40"),
    leaderboard: () => request<{ leaderboard: LeaderRow[] }>("/api/leaderboard"),
  };
}

export type Api = ReturnType<typeof createApi>;

function safeJson(text: string): { error?: { message?: string; code?: string } } | null {
  try {
    return JSON.parse(text) as { error?: { message?: string; code?: string } };
  } catch {
    return null;
  }
}
