import {
  costCents,
  dollarsToCents,
  microForBudget,
  microToShares,
  sharesToMicro,
  ticksToDollars,
  weightedAvgTicks,
} from "../money.js";

export type Side = "buy" | "sell";
export type AmountType = "shares" | "dollars";

export type Position = {
  symbol: string;
  microshares: number;
  avgCostTicks: number;
};

export type AccountState = {
  cashCents: number;
  positions: Position[];
};

export type Guardrails = {
  maxOrderCents: number;
  maxTradesPerDay: number;
  tradesToday: number;
  allowedSymbols: string[];
};

export type Fill = {
  priceTicks: number;
  microshares: number;
  cashDeltaCents: number;
  notionalCents: number;
};

export type Decision =
  | { status: "rejected"; code: string; message: string }
  | { status: "pending"; message: string; priceTicks: number }
  | { status: "filled"; message: string; fill: Fill; next: AccountState };

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;

function reject(code: string, message: string): Decision {
  return { status: "rejected", code, message };
}

function clonePositions(positions: Position[]): Position[] {
  return positions.map((position) => ({ ...position }));
}

function findPosition(positions: Position[], symbol: string): Position | undefined {
  return positions.find((position) => position.symbol === symbol);
}

export function evaluateOrder(args: {
  state: AccountState;
  symbol: string;
  side: Side;
  amountType: AmountType;
  amount: number;
  priceTicks: number;
  marketOpen: boolean;
  queueIfClosed: boolean;
  guardrails?: Guardrails | null;
}): Decision {
  const symbol = args.symbol.trim().toUpperCase();
  if (!SYMBOL.test(symbol)) {
    return reject("invalid_symbol", "Use a ticker like AAPL or BRK.B.");
  }
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    return reject("invalid_amount", "Amount has to be greater than zero.");
  }
  if (!Number.isFinite(args.priceTicks) || args.priceTicks <= 0) {
    return reject("invalid_price", "No price is available for that symbol.");
  }

  const priceTicks = Math.round(args.priceTicks);
  let requestedMicro: number | null = null;
  let requestedCents: number | null = null;
  if (args.amountType === "shares") {
    requestedMicro = sharesToMicro(args.amount);
    if (requestedMicro < 1) {
      return reject("amount_too_small", "That share amount rounds to zero.");
    }
  } else {
    requestedCents = dollarsToCents(args.amount);
    if (requestedCents < 1) {
      return reject("amount_too_small", "Orders must be at least $0.01.");
    }
  }

  const estimatedNotional =
    requestedCents ?? costCents(requestedMicro ?? 0, priceTicks);

  if (args.guardrails) {
    const { allowedSymbols, maxOrderCents, maxTradesPerDay, tradesToday } = args.guardrails;
    if (allowedSymbols.length > 0 && !allowedSymbols.includes(symbol)) {
      return reject(
        "symbol_not_allowed",
        `${symbol} is outside this agent's allowed symbols (${allowedSymbols.join(", ")}).`,
      );
    }
    if (tradesToday >= maxTradesPerDay) {
      return reject(
        "trade_limit",
        `This agent already placed ${tradesToday} orders today. The daily limit is ${maxTradesPerDay}.`,
      );
    }
    if (estimatedNotional > maxOrderCents) {
      return reject(
        "order_too_large",
        `Estimated size is $${(estimatedNotional / 100).toFixed(2)}, above the $${(maxOrderCents / 100).toFixed(2)} order limit.`,
      );
    }
  }

  const held = findPosition(args.state.positions, symbol);
  if (args.side === "buy" && args.amountType === "dollars" && (requestedCents ?? 0) > args.state.cashCents) {
    return reject("insufficient_cash", "Not enough cash for this buy.");
  }
  if (args.side === "buy" && args.amountType === "shares" && estimatedNotional > args.state.cashCents) {
    return reject("insufficient_cash", "Not enough cash for this buy.");
  }
  if (args.side === "sell" && args.amountType === "shares") {
    if (!held || held.microshares < (requestedMicro ?? 0)) {
      return reject("insufficient_shares", `Not enough ${symbol} shares to sell.`);
    }
  }
  if (args.side === "sell" && args.amountType === "dollars") {
    const heldValue = held ? costCents(held.microshares, priceTicks) : 0;
    if (heldValue < (requestedCents ?? 0)) {
      return reject(
        "insufficient_shares",
        `The ${symbol} position is worth $${(heldValue / 100).toFixed(2)}, less than the requested sale.`,
      );
    }
  }

  if (!args.marketOpen && args.queueIfClosed) {
    return {
      status: "pending",
      priceTicks,
      message: "Market is closed. This order is queued and will fill at the next NYSE open.",
    };
  }

  return fillNow({
    state: args.state,
    symbol,
    side: args.side,
    amountType: args.amountType,
    priceTicks,
    requestedMicro,
    requestedCents,
  });
}

function fillNow(args: {
  state: AccountState;
  symbol: string;
  side: Side;
  amountType: AmountType;
  priceTicks: number;
  requestedMicro: number | null;
  requestedCents: number | null;
}): Decision {
  const { state, symbol, side, amountType, priceTicks } = args;
  const positions = clonePositions(state.positions);
  const held = findPosition(positions, symbol);

  let qty = 0;
  if (amountType === "shares") {
    qty = args.requestedMicro ?? 0;
  } else if (side === "buy") {
    qty = microForBudget(Math.min(args.requestedCents ?? 0, state.cashCents), priceTicks);
  } else {
    qty = microForBudget(args.requestedCents ?? 0, priceTicks);
    if (held && qty > held.microshares) qty = held.microshares;
  }

  if (qty < 1) {
    return reject("amount_too_small", "That order is too small to buy or sell even a fraction of a share.");
  }

  const notional = costCents(qty, priceTicks);
  if (notional < 1) {
    return reject("amount_too_small", "That order rounds to less than $0.01.");
  }

  if (side === "buy") {
    if (notional > state.cashCents) {
      return reject("insufficient_cash", "Not enough cash to fill this buy at the current price.");
    }
    const nextPositions = positions.map((position) => ({ ...position }));
    const index = nextPositions.findIndex((position) => position.symbol === symbol);
    if (index < 0) {
      nextPositions.push({ symbol, microshares: qty, avgCostTicks: priceTicks });
    } else {
      const current = nextPositions[index];
      nextPositions[index] = {
        symbol,
        microshares: current.microshares + qty,
        avgCostTicks: weightedAvgTicks(current.microshares, current.avgCostTicks, qty, priceTicks),
      };
    }
    const price = ticksToDollars(priceTicks);
    return {
      status: "filled",
      message: `Bought ${formatShares(qty)} shares of ${symbol} at $${price.toFixed(2)}.`,
      fill: { priceTicks, microshares: qty, cashDeltaCents: -notional, notionalCents: notional },
      next: { cashCents: state.cashCents - notional, positions: nextPositions },
    };
  }

  if (!held || held.microshares < qty) {
    return reject("insufficient_shares", `Not enough ${symbol} shares to sell.`);
  }
  const nextPositions = positions
    .map((position) =>
      position.symbol === symbol
        ? { ...position, microshares: position.microshares - qty }
        : { ...position },
    )
    .filter((position) => position.microshares > 0);
  const price = ticksToDollars(priceTicks);
  return {
    status: "filled",
    message: `Sold ${formatShares(qty)} shares of ${symbol} at $${price.toFixed(2)}.`,
    fill: { priceTicks, microshares: qty, cashDeltaCents: notional, notionalCents: notional },
    next: { cashCents: state.cashCents + notional, positions: nextPositions },
  };
}

function formatShares(micro: number): string {
  return microToShares(micro).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function positionValueCents(position: Position, priceTicks: number): number {
  return costCents(position.microshares, priceTicks);
}
