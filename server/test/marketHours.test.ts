import { describe, expect, it } from "vitest";
import { isMarketOpen, nextMarketOpen } from "../src/engine/marketHours.js";

describe("NYSE hours", () => {
  it("is closed before 9:30 and open at 9:30 in January (EST)", () => {
    expect(isMarketOpen(new Date("2026-01-15T14:29:00Z"))).toBe(false);
    expect(isMarketOpen(new Date("2026-01-15T14:30:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-01-15T20:59:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-01-15T21:00:00Z"))).toBe(false);
  });

  it("is closed before 9:30 and open at 9:30 in July (EDT)", () => {
    expect(isMarketOpen(new Date("2026-07-15T13:29:00Z"))).toBe(false);
    expect(isMarketOpen(new Date("2026-07-15T13:30:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-07-15T19:59:00Z"))).toBe(true);
    expect(isMarketOpen(new Date("2026-07-15T20:00:00Z"))).toBe(false);
  });

  it("is closed on weekends and on Thanksgiving 2026", () => {
    expect(isMarketOpen(new Date("2026-11-14T15:00:00Z"))).toBe(false);
    expect(isMarketOpen(new Date("2026-11-26T15:00:00Z"))).toBe(false);
  });

  it("queues until the next regular open", () => {
    const beforeOpen = nextMarketOpen(new Date("2026-11-12T14:00:00Z"));
    expect(beforeOpen.toISOString()).toBe("2026-11-12T14:30:00.000Z");

    const afterClose = nextMarketOpen(new Date("2026-11-13T21:30:00Z"));
    expect(afterClose.toISOString()).toBe("2026-11-16T14:30:00.000Z");

    const saturday = nextMarketOpen(new Date("2026-11-14T16:00:00Z"));
    expect(saturday.toISOString()).toBe("2026-11-16T14:30:00.000Z");

    const thanksgiving = nextMarketOpen(new Date("2026-11-26T15:00:00Z"));
    expect(thanksgiving.toISOString()).toBe("2026-11-27T14:30:00.000Z");

    const julyHoliday = nextMarketOpen(new Date("2026-07-03T16:00:00Z"));
    expect(julyHoliday.toISOString()).toBe("2026-07-06T13:30:00.000Z");
  });
});
