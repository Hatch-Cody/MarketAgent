import { isSessionDate, nyParts, type NyParts } from "../engine/marketHours.js";
import { LISTING_BY_SYMBOL, UNIVERSE, type Listing } from "./universe.js";
import type { Candle, ChartRange, MarketDataProvider, Profile, Quote, SearchHit } from "./types.js";

const ANCHOR = "2026-11-10";
const HISTORY_START = Date.UTC(2021, 0, 4);

type Bar = { date: string; close: number; volume: number };
type Series = { listing: Listing; bars: Bar[]; byDate: Map<string, Bar> };

const seriesCache = new Map<string, Series>();
let dayKeys: string[] | null = null;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function businessDayKeys(): string[] {
  if (dayKeys) return dayKeys;
  const end = Date.now() + 10 * 86_400_000;
  const keys: string[] = [];
  for (let t = HISTORY_START; t <= end; t += 86_400_000) {
    const date = new Date(t);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    keys.push(date.toISOString().slice(0, 10));
  }
  dayKeys = keys;
  return keys;
}

function syntheticListing(symbol: string): Listing {
  const hash = hashString(symbol);
  const target = 8 + (hash % 240) + ((hash >>> 8) % 100) / 100;
  return {
    symbol,
    name: `${symbol} Holdings`,
    sector: "Simulated",
    industry: "Simulated listing",
    description: "A generated listing in the built-in paper market. Add a Finnhub key for the live tape.",
    exchange: "SIM",
    target: Math.round(target * 100) / 100,
    vol: 0.02,
    baseVolume: 500_000 + (hash % 4_000_000),
    sharesOutstanding: 50_000_000 + (hash % 500_000_000),
    eps: null,
    dividendYield: null,
    type: "Common Stock",
  };
}

function listingFor(symbol: string): Listing {
  return LISTING_BY_SYMBOL.get(symbol) ?? syntheticListing(symbol);
}

function buildSeries(listing: Listing): Series {
  const cached = seriesCache.get(listing.symbol);
  if (cached) return cached;
  const days = businessDayKeys();
  const rng = mulberry32(hashString(`${listing.symbol}:px`));
  const volumeRng = mulberry32(hashString(`${listing.symbol}:vol`));
  let price = 100;
  const raw: number[] = [];
  const returns: number[] = [];
  for (let i = 0; i < days.length; i += 1) {
    const change = gaussian(rng) * listing.vol;
    returns.push(change);
    price *= Math.exp(change);
    raw.push(price);
  }
  let anchor = days.indexOf(ANCHOR);
  if (anchor < 0) anchor = days.length - 1;
  const scale = listing.target / raw[anchor];
  const bars: Bar[] = days.map((date, index) => ({
    date,
    close: Math.max(0.5, raw[index] * scale),
    volume: Math.round(listing.baseVolume * (0.55 + volumeRng() * 0.9) * (1 + Math.min(3, Math.abs(returns[index]) * 40))),
  }));
  const series: Series = { listing, bars, byDate: new Map(bars.map((bar) => [bar.date, bar])) };
  seriesCache.set(listing.symbol, series);
  return series;
}

function previousKey(keys: string[], dateKey: string): string | null {
  let prior: string | null = null;
  for (const key of keys) {
    if (key >= dateKey) break;
    prior = key;
  }
  return prior;
}

function roundPrice(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sessionMinute(parts: NyParts): number | null {
  if (!isSessionDate(parts.dateKey, parts.weekday)) return null;
  return parts.hour * 60 + parts.minute - (9 * 60 + 30);
}

function intradayPrice(listing: Listing, dateKey: string, minute: number, open: number, close: number): number {
  const clamped = Math.max(0, Math.min(389, minute));
  const progress = clamped / 390;
  const bridge = open + (close - open) * progress;
  const envelope = Math.sin(Math.PI * progress);
  const rng = mulberry32(hashString(`${listing.symbol}:${dateKey}:${clamped}`));
  const noise = (rng() - 0.5) * 2;
  return Math.max(0.5, bridge * (1 + noise * 0.004 * envelope));
}

type Mark = {
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  sessionDate: string;
};

function markAt(symbol: string, at: Date): Mark {
  const listing = listingFor(symbol);
  const series = buildSeries(listing);
  const parts = nyParts(at);
  const minute = sessionMinute(parts);
  const today = series.byDate.get(parts.dateKey);
  const prevKey = previousKey(series.bars.map((bar) => bar.date), parts.dateKey);
  const previous = prevKey ? series.byDate.get(prevKey) : undefined;
  const dayBeforeKey = prevKey ? previousKey(series.bars.map((bar) => bar.date), prevKey) : null;
  const dayBefore = dayBeforeKey ? series.byDate.get(dayBeforeKey) : undefined;

  const inSession = minute !== null && minute >= 0 && today;
  if (!inSession || !today || !previous) {
    const close = previous?.close ?? listing.target;
    const prior = dayBefore?.close ?? close;
    return {
      price: roundPrice(close),
      open: roundPrice(prior),
      high: roundPrice(Math.max(close, prior)),
      low: roundPrice(Math.min(close, prior)),
      previousClose: roundPrice(prior),
      volume: previous?.volume ?? listing.baseVolume,
      sessionDate: prevKey ?? parts.dateKey,
    };
  }

  const open = previous.close * (1 + (today.close / previous.close - 1) * 0.2);
  const elapsed = Math.min(minute, 389);
  const price = minute >= 390 ? today.close : intradayPrice(listing, parts.dateKey, elapsed, open, today.close);
  let high = price;
  let low = price;
  const step = 5;
  for (let cursor = 0; cursor <= elapsed; cursor += step) {
    const sample = intradayPrice(listing, parts.dateKey, cursor, open, today.close);
    high = Math.max(high, sample);
    low = Math.min(low, sample);
  }
  high = Math.max(high, open, price);
  low = Math.min(low, open, price);
  const progress = Math.min(1, Math.max(0.05, minute / 390));
  return {
    price: roundPrice(price),
    open: roundPrice(open),
    high: roundPrice(high),
    low: roundPrice(low),
    previousClose: roundPrice(previous.close),
    volume: Math.round(today.volume * progress),
    sessionDate: parts.dateKey,
  };
}

function toQuote(symbol: string, at: Date): Quote {
  const listing = listingFor(symbol);
  const mark = markAt(symbol, at);
  const change = roundPrice(mark.price - mark.previousClose);
  const changePercent = mark.previousClose === 0 ? 0 : (change / mark.previousClose) * 100;
  return {
    symbol,
    name: listing.name,
    price: mark.price,
    change,
    changePercent: Math.round(changePercent * 100) / 100,
    open: mark.open,
    high: mark.high,
    low: mark.low,
    previousClose: mark.previousClose,
    volume: mark.volume,
    currency: "USD",
    asOf: at.toISOString(),
  };
}

function barTime(dateKey: string, minuteOffset: number): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 14, 30, 0) + minuteOffset * 60_000;
}

function sessionPath(symbol: string, dateKey: string): { minute: number; price: number }[] {
  const listing = listingFor(symbol);
  const series = buildSeries(listing);
  const today = series.byDate.get(dateKey);
  const prevKey = previousKey(series.bars.map((bar) => bar.date), dateKey);
  const previous = prevKey ? series.byDate.get(prevKey) : undefined;
  if (!today || !previous) return [];
  const open = previous.close * (1 + (today.close / previous.close - 1) * 0.2);
  const points: { minute: number; price: number }[] = [];
  for (let minute = 0; minute <= 389; minute += 1) {
    points.push({ minute, price: intradayPrice(listing, dateKey, minute, open, today.close) });
  }
  points.push({ minute: 390, price: today.close });
  return points;
}

function aggregate(points: { minute: number; price: number }[], dateKey: string, bucket: number, volume: number): Candle[] {
  const candles: Candle[] = [];
  for (let start = 0; start < 390; start += bucket) {
    const slice = points.filter((point) => point.minute >= start && point.minute < start + bucket);
    if (!slice.length) continue;
    const prices = slice.map((point) => point.price);
    candles.push({
      t: barTime(dateKey, start),
      o: roundPrice(prices[0]),
      h: roundPrice(Math.max(...prices)),
      l: roundPrice(Math.min(...prices)),
      c: roundPrice(prices[prices.length - 1]),
      v: Math.round(volume / (390 / bucket)),
    });
  }
  return candles;
}

function historyFor(symbol: string, range: ChartRange, at: Date): Candle[] {
  const listing = listingFor(symbol);
  const series = buildSeries(listing);
  const parts = nyParts(at);
  const minute = sessionMinute(parts);
  const keys = series.bars.map((bar) => bar.date);

  if (range === "1d" || range === "1w") {
    let sessionDates: string[] = [];
    const activeToday = minute !== null && minute >= 0 && series.byDate.has(parts.dateKey);
    const last = activeToday ? parts.dateKey : previousKey(keys, parts.dateKey);
    if (!last) return [];
    if (range === "1d") {
      sessionDates = [last];
    } else {
      const index = keys.indexOf(last);
      sessionDates = keys.slice(Math.max(0, index - 4), index + 1);
    }
    const candles: Candle[] = [];
    for (const dateKey of sessionDates) {
      const path = sessionPath(symbol, dateKey);
      const limit = dateKey === parts.dateKey && minute !== null && minute >= 0 && minute < 390 ? minute : 390;
      const visible = path.filter((point) => point.minute <= limit);
      const bucket = range === "1d" ? 5 : 30;
      const volume = series.byDate.get(dateKey)?.volume ?? listing.baseVolume;
      candles.push(...aggregate(visible, dateKey, bucket, volume).filter((candle) => candle.t <= at.getTime() + 60_000));
    }
    return candles;
  }

  const span = range === "1m" ? 22 : range === "3m" ? 66 : range === "1y" ? 252 : series.bars.length;
  const step = range === "5y" ? 5 : 1;
  const endKey = previousKey(keys, parts.dateKey) ?? parts.dateKey;
  const endIndex = Math.max(0, keys.indexOf(endKey));
  const startIndex = Math.max(0, endIndex - span * step);
  const candles: Candle[] = [];
  for (let index = startIndex; index <= endIndex; index += step) {
    const bar = series.bars[index];
    const prev = series.bars[index - step] ?? series.bars[index - 1] ?? bar;
    candles.push({
      t: Date.parse(`${bar.date}T21:00:00Z`),
      o: roundPrice(prev.close),
      h: roundPrice(Math.max(prev.close, bar.close) * 1.004),
      l: roundPrice(Math.min(prev.close, bar.close) * 0.996),
      c: roundPrice(bar.close),
      v: bar.volume,
    });
  }
  return candles;
}

function profileFor(symbol: string, at: Date): Profile | null {
  const listing = listingFor(symbol);
  if (!LISTING_BY_SYMBOL.has(symbol) && !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return null;
  const series = buildSeries(listing);
  const quote = toQuote(symbol, at);
  const tail = series.bars.slice(-252);
  const closes = tail.map((bar) => bar.close);
  const week52High = closes.length ? Math.max(...closes) : null;
  const week52Low = closes.length ? Math.min(...closes) : null;
  const averageVolume = closes.length
    ? Math.round(tail.reduce((sum, bar) => sum + bar.volume, 0) / tail.length)
    : null;
  return {
    symbol,
    name: listing.name,
    description: listing.description,
    sector: listing.sector,
    industry: listing.industry,
    exchange: listing.exchange,
    marketCap: Math.round(listing.sharesOutstanding * quote.price),
    pe: listing.eps && listing.eps > 0 ? Math.round((quote.price / listing.eps) * 100) / 100 : null,
    eps: listing.eps,
    dividendYield: listing.dividendYield,
    week52High: week52High ? roundPrice(week52High) : null,
    week52Low: week52Low ? roundPrice(week52Low) : null,
    averageVolume,
  };
}

export function createMockProvider(now: () => Date = () => new Date()): MarketDataProvider {
  let moverCache: { at: number; value: { active: Quote[]; gainers: Quote[]; losers: Quote[] } } | null = null;
  return {
    id: "mock",
    async search(query: string): Promise<SearchHit[]> {
      const q = query.trim().toUpperCase();
      const hits = UNIVERSE.filter((listing) => {
        if (!q) return true;
        return listing.symbol.includes(q) || listing.name.toUpperCase().includes(q);
      })
        .slice(0, q ? 20 : 12)
        .map((listing) => ({
          symbol: listing.symbol,
          name: listing.name,
          type: listing.type,
          exchange: listing.exchange,
        }));
      if (q && /^[A-Z][A-Z0-9.-]{0,9}$/.test(q) && !hits.some((hit) => hit.symbol === q)) {
        const synthetic = syntheticListing(q);
        hits.push({ symbol: q, name: synthetic.name, type: synthetic.type, exchange: synthetic.exchange });
      }
      return hits;
    },
    async quote(symbol: string) {
      const normalized = symbol.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) return null;
      return toQuote(normalized, now());
    },
    async quotes(symbols: string[]) {
      const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))];
      const quotes: Quote[] = [];
      for (const symbol of unique) {
        if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) continue;
        quotes.push(toQuote(symbol, now()));
      }
      return quotes;
    },
    async history(symbol: string, range: ChartRange) {
      const normalized = symbol.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) return [];
      return historyFor(normalized, range, now());
    },
    async movers() {
      const at = now().getTime();
      if (moverCache && at - moverCache.at < 5_000) return moverCache.value;
      const quotes = UNIVERSE.map((listing) => toQuote(listing.symbol, now()));
      const value = {
        active: [...quotes].sort((a, b) => b.volume - a.volume).slice(0, 10),
        gainers: [...quotes].sort((a, b) => b.changePercent - a.changePercent).slice(0, 10),
        losers: [...quotes].sort((a, b) => a.changePercent - b.changePercent).slice(0, 10),
      };
      moverCache = { at, value };
      return value;
    },
    async profile(symbol: string) {
      const normalized = symbol.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) return null;
      return profileFor(normalized, now());
    },
    async corporateActions() {
      return [];
    },
  };
}
