import { describe, expect, it } from "vitest";
import { applySplit, dividendCreditCents } from "../src/engine/corporateActions.js";
import { evaluateOrder, type AccountState } from "../src/engine/trading.js";
import { costCents, dollarsToCents, dollarsToTicks, microToShares, sharesToMicro } from "../src/money.js";

const cash = (dollars: number): AccountState => ({ cashCents: dollarsToCents(dollars), positions: [] });
const px = (dollars: number) => dollarsToTicks(dollars);

function buy(state: AccountState, extra: Partial<Parameters<typeof evaluateOrder>[0]>) {
  return evaluateOrder({
    state,
    symbol: "AAPL",
    side: "buy",
    amountType: "shares",
    amount: 1,
    priceTicks: px(100),
    marketOpen: true,
    queueIfClosed: true,
    ...extra,
  });
}

describe("fills", () => {
  it("buys whole shares and reduces cash", () => {
    const decision = buy(cash(1_000), { amount: 2, priceTicks: px(100) });
    expect(decision.status).toBe("filled");
    if (decision.status !== "filled") return;
    expect(decision.next.cashCents).toBe(dollarsToCents(800));
    expect(decision.next.positions).toEqual([{ symbol: "AAPL", microshares: sharesToMicro(2), avgCostTicks: px(100) }]);
  });

  it("rejects a share buy that costs more than cash", () => {
    const decision = buy(cash(500), { amount: 10, priceTicks: px(100) });
    expect(decision).toMatchObject({ status: "rejected", code: "insufficient_cash" });
  });

  it("buys a fractional share", () => {
    const decision = buy(cash(100), { amount: 0.5, priceTicks: px(100) });
    expect(decision.status).toBe("filled");
    if (decision.status !== "filled") return;
    expect(decision.fill.microshares).toBe(sharesToMicro(0.5));
    expect(decision.next.cashCents).toBe(dollarsToCents(50));
  });

  it("buys by dollars without spending more than the budget", () => {
    const decision = buy(cash(1_000), { amountType: "dollars", amount: 100, priceTicks: px(33.33) });
    expect(decision.status).toBe("filled");
    if (decision.status !== "filled") return;
    expect(decision.fill.notionalCents).toBeLessThanOrEqual(dollarsToCents(100));
    expect(decision.fill.notionalCents).toBeGreaterThan(dollarsToCents(99));
    expect(microToShares(decision.fill.microshares)).not.toBe(Math.round(microToShares(decision.fill.microshares)));
    expect(decision.next.cashCents).toBe(dollarsToCents(1_000) - decision.fill.notionalCents);
  });

  it("updates average cost on a second buy", () => {
    const first = buy(cash(1_000), { amount: 1, priceTicks: px(10) });
    if (first.status !== "filled") throw new Error("first fill");
    const second = buy(first.next, { amount: 1, priceTicks: px(30) });
    expect(second.status).toBe("filled");
    if (second.status !== "filled") return;
    expect(second.next.positions[0]?.avgCostTicks).toBe(px(20));
    expect(second.next.positions[0]?.microshares).toBe(sharesToMicro(2));
  });

  it("keeps average cost when selling part of a position", () => {
    const opened = buy(cash(1_000), { amount: 2, priceTicks: px(10) });
    if (opened.status !== "filled") throw new Error("open");
    const sold = evaluateOrder({
      state: opened.next,
      symbol: "AAPL",
      side: "sell",
      amountType: "shares",
      amount: 0.5,
      priceTicks: px(16),
      marketOpen: true,
      queueIfClosed: true,
    });
    expect(sold.status).toBe("filled");
    if (sold.status !== "filled") return;
    expect(sold.next.positions[0]?.avgCostTicks).toBe(px(10));
    expect(sold.next.positions[0]?.microshares).toBe(sharesToMicro(1.5));
    expect(sold.next.cashCents).toBe(opened.next.cashCents + costCents(sharesToMicro(0.5), px(16)));
  });

  it("removes a position that is sold out", () => {
    const opened = buy(cash(1_000), { amount: 1, priceTicks: px(10) });
    if (opened.status !== "filled") throw new Error("open");
    const sold = evaluateOrder({
      state: opened.next,
      symbol: "AAPL",
      side: "sell",
      amountType: "shares",
      amount: 1,
      priceTicks: px(12),
      marketOpen: true,
      queueIfClosed: true,
    });
    expect(sold.status).toBe("filled");
    if (sold.status !== "filled") return;
    expect(sold.next.positions).toEqual([]);
  });

  it("rejects a sale larger than the position", () => {
    const opened = buy(cash(1_000), { amount: 1, priceTicks: px(10) });
    if (opened.status !== "filled") throw new Error("open");
    const sold = evaluateOrder({
      state: opened.next,
      symbol: "AAPL",
      side: "sell",
      amountType: "shares",
      amount: 2,
      priceTicks: px(10),
      marketOpen: true,
      queueIfClosed: true,
    });
    expect(sold).toMatchObject({ status: "rejected", code: "insufficient_shares" });
  });

  it("sells by dollar amount", () => {
    const opened = buy(cash(1_000), { amount: 10, priceTicks: px(20) });
    if (opened.status !== "filled") throw new Error("open");
    const sold = evaluateOrder({
      state: opened.next,
      symbol: "AAPL",
      side: "sell",
      amountType: "dollars",
      amount: 50,
      priceTicks: px(20),
      marketOpen: true,
      queueIfClosed: true,
    });
    expect(sold.status).toBe("filled");
    if (sold.status !== "filled") return;
    expect(sold.fill.notionalCents).toBeLessThanOrEqual(dollarsToCents(50));
    expect(sold.fill.notionalCents).toBeGreaterThan(dollarsToCents(49));
  });

  it("rejects a dollar sale larger than the position", () => {
    const opened = buy(cash(1_000), { amount: 1, priceTicks: px(20) });
    if (opened.status !== "filled") throw new Error("open");
    const sold = evaluateOrder({
      state: opened.next,
      symbol: "AAPL",
      side: "sell",
      amountType: "dollars",
      amount: 100,
      priceTicks: px(20),
      marketOpen: true,
      queueIfClosed: true,
    });
    expect(sold).toMatchObject({ status: "rejected", code: "insufficient_shares" });
  });

  it("rejects a non-positive amount", () => {
    expect(buy(cash(100), { amount: 0 })).toMatchObject({ status: "rejected", code: "invalid_amount" });
    expect(buy(cash(100), { amount: -2 })).toMatchObject({ status: "rejected", code: "invalid_amount" });
  });
});

describe("closed-market queuing", () => {
  it("queues a funded order and does not touch cash", () => {
    const state = cash(1_000);
    const decision = buy(state, { marketOpen: false, queueIfClosed: true, amount: 1, priceTicks: px(50) });
    expect(decision.status).toBe("pending");
    expect(state.cashCents).toBe(dollarsToCents(1_000));
    expect(state.positions).toEqual([]);
  });

  it("rejects an unaffordable order instead of queueing it", () => {
    const decision = buy(cash(10), { marketOpen: false, queueIfClosed: true, amount: 1, priceTicks: px(50) });
    expect(decision).toMatchObject({ status: "rejected", code: "insufficient_cash" });
  });

  it("fills immediately when after-hours fills are allowed", () => {
    const decision = buy(cash(100), { marketOpen: false, queueIfClosed: false, amount: 1, priceTicks: px(40) });
    expect(decision.status).toBe("filled");
  });

  it("rejects a share buy that gaps above available cash at the open", () => {
    const decision = buy(cash(100), { marketOpen: true, amount: 1, priceTicks: px(140) });
    expect(decision).toMatchObject({ status: "rejected", code: "insufficient_cash" });
  });
});

describe("guardrails", () => {
  const guard = {
    maxOrderCents: dollarsToCents(100),
    maxTradesPerDay: 2,
    tradesToday: 0,
    allowedSymbols: ["AAPL"],
  };

  it("blocks an order above the dollar cap", () => {
    const decision = buy(cash(10_000), { amountType: "dollars", amount: 150, guardrails: guard });
    expect(decision).toMatchObject({ status: "rejected", code: "order_too_large" });
  });

  it("blocks a share order whose notional exceeds the cap", () => {
    const decision = buy(cash(10_000), { amount: 3, priceTicks: px(40), guardrails: guard });
    expect(decision).toMatchObject({ status: "rejected", code: "order_too_large" });
  });

  it("blocks the trade after the daily limit", () => {
    const decision = buy(cash(10_000), { amountType: "dollars", amount: 25, guardrails: { ...guard, tradesToday: 2 } });
    expect(decision).toMatchObject({ status: "rejected", code: "trade_limit" });
  });

  it("blocks symbols outside the allow list and permits an empty list", () => {
    const blocked = buy(cash(10_000), { symbol: "MSFT", amountType: "dollars", amount: 25, guardrails: guard });
    expect(blocked).toMatchObject({ status: "rejected", code: "symbol_not_allowed" });
    const open = buy(cash(10_000), {
      symbol: "MSFT",
      amountType: "dollars",
      amount: 25,
      guardrails: { ...guard, allowedSymbols: [] },
    });
    expect(open.status).toBe("filled");
  });
});

describe("corporate actions", () => {
  it("applies a 2-for-1 split", () => {
    const next = applySplit(sharesToMicro(3), px(100), 2, 1);
    expect(next.microshares).toBe(sharesToMicro(6));
    expect(next.avgCostTicks).toBe(px(50));
  });

  it("credits a cash dividend for fractional shares", () => {
    expect(dividendCreditCents(sharesToMicro(100.5), 25)).toBe(2513);
  });
});
