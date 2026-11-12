import { LISTING_BY_SYMBOL, UNIVERSE } from "./universe.js";
import { MarketDataError, type Candle, type ChartRange, type MarketDataProvider, type Profile, type Quote, type SearchHit } from "./types.js";

type CacheEntry<T> = { at: number; value: T };

function createCache() {
  const store = new Map<string, CacheEntry<unknown>>();
  return async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const value = await load();
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

async function finnhubGet(apiKey: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`https://finnhub.io/api/v1${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("token", apiKey);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new MarketDataError("Finnhub did not respond. Check the network and FINNHUB_API_KEY.");
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new MarketDataError(body?.error || `Finnhub returned ${response.status}.`);
  }
  if (body && typeof body === "object" && "error" in body && body.error) {
    throw new MarketDataError(body.error);
  }
  return body;
}

function asQuote(symbol: string, raw: Record<string, number>, name: string): Quote | null {
  if (!raw || !Number.isFinite(raw.c) || raw.c <= 0) return null;
  const price = raw.c;
  const previousClose = Number.isFinite(raw.pc) && raw.pc > 0 ? raw.pc : price;
  const change = Number.isFinite(raw.d) ? raw.d : price - previousClose;
  const changePercent = Number.isFinite(raw.dp) ? raw.dp : previousClose ? (change / previousClose) * 100 : 0;
  return {
    symbol,
    name,
    price,
    change,
    changePercent,
    open: Number.isFinite(raw.o) ? raw.o : price,
    high: Number.isFinite(raw.h) ? raw.h : price,
    low: Number.isFinite(raw.l) ? raw.l : price,
    previousClose,
    volume: 0,
    currency: "USD",
    asOf: raw.t ? new Date(raw.t * 1000).toISOString() : new Date().toISOString(),
  };
}

export function createFinnhubProvider(apiKey: string): MarketDataProvider {
  const cached = createCache();
  const nameFor = (symbol: string) => LISTING_BY_SYMBOL.get(symbol)?.name ?? symbol;

  async function oneQuote(symbol: string): Promise<Quote | null> {
    const normalized = symbol.trim().toUpperCase();
    return cached(`q:${normalized}`, 15_000, async () => {
      const raw = (await finnhubGet(apiKey, "/quote", { symbol: normalized })) as Record<string, number>;
      return asQuote(normalized, raw, nameFor(normalized));
    });
  }

  return {
    id: "finnhub",
    async search(query: string): Promise<SearchHit[]> {
      const q = query.trim();
      if (!q) {
        return UNIVERSE.slice(0, 12).map((listing) => ({
          symbol: listing.symbol,
          name: listing.name,
          type: listing.type,
          exchange: listing.exchange,
        }));
      }
      const raw = (await cached(`s:${q.toUpperCase()}`, 60_000, () =>
        finnhubGet(apiKey, "/search", { q }),
      )) as { result?: { symbol: string; description: string; type: string }[] };
      return (raw.result ?? [])
        .filter((hit) => hit.symbol && !hit.symbol.includes("."))
        .filter((hit) => /stock|etf|etp|adr/i.test(hit.type) || hit.type === "Common Stock")
        .slice(0, 20)
        .map((hit) => ({
          symbol: hit.symbol.toUpperCase(),
          name: hit.description,
          type: hit.type,
          exchange: "",
        }));
    },
    quote: oneQuote,
    async quotes(symbols: string[]) {
      const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
      const quotes: Quote[] = [];
      for (const symbol of unique) {
        const quote = await oneQuote(symbol);
        if (quote) quotes.push(quote);
      }
      return quotes;
    },
    async history(symbol: string, range: ChartRange): Promise<Candle[]> {
      const normalized = symbol.trim().toUpperCase();
      const resolution = range === "1d" ? "5" : range === "1w" ? "30" : range === "5y" ? "W" : "D";
      const spanDays = range === "1d" ? 3 : range === "1w" ? 14 : range === "1m" ? 40 : range === "3m" ? 130 : range === "1y" ? 400 : 1900;
      const to = Math.floor(Date.now() / 1000);
      const from = to - spanDays * 86_400;
      const raw = (await cached(`h:${normalized}:${range}`, 60_000, () =>
        finnhubGet(apiKey, "/stock/candle", {
          symbol: normalized,
          resolution,
          from: String(from),
          to: String(to),
        }),
      )) as { s?: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
      if (raw.s !== "ok" || !raw.t) return [];
      return raw.t.map((t, index) => ({
        t: t * 1000,
        o: raw.o?.[index] ?? 0,
        h: raw.h?.[index] ?? 0,
        l: raw.l?.[index] ?? 0,
        c: raw.c?.[index] ?? 0,
        v: raw.v?.[index] ?? 0,
      }));
    },
    async movers() {
      return cached("movers", 60_000, async () => {
        const quotes: Quote[] = [];
        const symbols = UNIVERSE.map((listing) => listing.symbol);
        for (let i = 0; i < symbols.length; i += 5) {
          const batch = await Promise.all(symbols.slice(i, i + 5).map((symbol) => oneQuote(symbol).catch(() => null)));
          for (const quote of batch) if (quote) quotes.push(quote);
        }
        return {
          active: [...quotes].sort((a, b) => b.volume - a.volume || Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 10),
          gainers: [...quotes].sort((a, b) => b.changePercent - a.changePercent).slice(0, 10),
          losers: [...quotes].sort((a, b) => a.changePercent - b.changePercent).slice(0, 10),
        };
      });
    },
    async profile(symbol: string): Promise<Profile | null> {
      const normalized = symbol.trim().toUpperCase();
      return cached(`p:${normalized}`, 60 * 60_000, async () => {
        const [profile, metricWrap] = await Promise.all([
          finnhubGet(apiKey, "/stock/profile2", { symbol: normalized }) as Promise<Record<string, unknown>>,
          finnhubGet(apiKey, "/stock/metric", { symbol: normalized, metric: "all" }).catch(() => null) as Promise<{ metric?: Record<string, number> } | null>,
        ]);
        if (!profile || (!profile.name && !profile.ticker)) return null;
        const metric = metricWrap?.metric ?? {};
        const marketCapMillions = typeof profile.marketCapitalization === "number" ? profile.marketCapitalization : null;
        const listing = LISTING_BY_SYMBOL.get(normalized);
        return {
          symbol: normalized,
          name: String(profile.name ?? listing?.name ?? normalized),
          description: listing?.description ?? `${profile.name ?? normalized} on ${profile.exchange ?? "US"} markets.`,
          sector: listing?.sector ?? String(profile.finnhubIndustry ?? "—"),
          industry: String(profile.finnhubIndustry ?? listing?.industry ?? "—"),
          exchange: String(profile.exchange ?? listing?.exchange ?? ""),
          marketCap: marketCapMillions !== null ? Math.round(marketCapMillions * 1_000_000) : null,
          pe: numberOrNull(metric.peBasicExclExtraTTM ?? metric.peTTM),
          eps: numberOrNull(metric.epsBasicExclExtraItemsTTM ?? metric.epsTTM),
          dividendYield: numberOrNull(metric.dividendYieldIndicatedAnnual) !== null
            ? (metric.dividendYieldIndicatedAnnual as number) / 100
            : listing?.dividendYield ?? null,
          week52High: numberOrNull(metric["52WeekHigh"]),
          week52Low: numberOrNull(metric["52WeekLow"]),
          averageVolume: numberOrNull(metric["10DayAverageTradingVolume"]) !== null
            ? Math.round((metric["10DayAverageTradingVolume"] as number) * 1_000_000)
            : null,
        };
      });
    },
    async corporateActions() {
      return [];
    },
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
