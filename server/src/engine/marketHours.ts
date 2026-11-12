/**
 * US cash-equity session: weekdays 9:30–16:00 America/New_York, excluding full NYSE closures.
 * Early closes are treated as a normal 16:00 close.
 */

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Full-day NYSE closures, 2025–2027. */
export const NYSE_HOLIDAYS = new Set<string>([
  "2025-01-01",
  "2025-01-09",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

export type NyParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  dateKey: string;
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function nyParts(date: Date): NyParts {
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: WEEKDAY[get("weekday")] ?? 0,
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** Convert a New York civil time to a UTC instant. */
export function etToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(desired);
  const seen = nyParts(guess);
  const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  return new Date(guess.getTime() - (seenAsUtc - desired));
}

export function isSessionDate(dateKey: string, weekday: number): boolean {
  return weekday >= 1 && weekday <= 5 && !NYSE_HOLIDAYS.has(dateKey);
}

export function isMarketOpen(date: Date): boolean {
  const parts = nyParts(date);
  if (!isSessionDate(parts.dateKey, parts.weekday)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function nextMarketOpen(date: Date): Date {
  const parts = nyParts(date);
  const minutes = parts.hour * 60 + parts.minute;
  if (isSessionDate(parts.dateKey, parts.weekday) && minutes < 9 * 60 + 30) {
    return etToUtc(parts.year, parts.month, parts.day, 9, 30);
  }
  const [year, month, day] = parts.dateKey.split("-").map(Number);
  for (let offset = 1; offset <= 14; offset += 1) {
    const next = new Date(Date.UTC(year, month - 1, day + offset));
    const key = next.toISOString().slice(0, 10);
    const weekday = next.getUTCDay();
    if (isSessionDate(key, weekday)) {
      const [y, m, d] = key.split("-").map(Number);
      return etToUtc(y, m, d, 9, 30);
    }
  }
  return etToUtc(year, month, day + 1, 9, 30);
}

export function startOfEtDay(date: Date): Date {
  const parts = nyParts(date);
  return etToUtc(parts.year, parts.month, parts.day, 0, 0);
}

export function marketStatus(date: Date) {
  const open = isMarketOpen(date);
  const next = open ? null : nextMarketOpen(date);
  return {
    exchange: "XNYS",
    timezone: "America/New_York",
    open,
    session: open ? "regular" : "closed",
    nextOpen: next ? next.toISOString() : null,
    asOf: date.toISOString(),
  };
}
