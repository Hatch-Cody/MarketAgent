/** Integer money. 1 share = 1_000_000 microshares. $1 = 10_000 price ticks (4 dp). Cash is cents. */

export const SHARE = 1_000_000;
export const TICKS = 10_000;
const COST_DENOM = 100_000_000n;

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function dollarsToTicks(dollars: number): number {
  return Math.round(dollars * TICKS);
}

export function ticksToDollars(ticks: number): number {
  return Number((ticks / TICKS).toFixed(4));
}

export function sharesToMicro(shares: number): number {
  return Math.round(shares * SHARE);
}

export function microToShares(micro: number): number {
  return Number((micro / SHARE).toFixed(6));
}

/** Notional in cents, rounded half up. */
export function costCents(microshares: number, priceTicks: number): number {
  if (microshares <= 0 || priceTicks <= 0) return 0;
  const cents = (BigInt(microshares) * BigInt(priceTicks) + COST_DENOM / 2n) / COST_DENOM;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Order notional is too large.");
  }
  return Number(cents);
}

/** Largest whole microshare quantity whose rounded cost does not exceed the budget. */
export function microForBudget(budgetCents: number, priceTicks: number): number {
  if (budgetCents <= 0 || priceTicks <= 0) return 0;
  const rough = Number((BigInt(budgetCents) * COST_DENOM) / BigInt(priceTicks));
  let hi = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, rough) + 2);
  if (costCents(hi, priceTicks) <= budgetCents) {
    return hi;
  }
  let lo = 0;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (costCents(mid, priceTicks) <= budgetCents) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function weightedAvgTicks(qtyA: number, priceA: number, qtyB: number, priceB: number): number {
  const den = BigInt(qtyA) + BigInt(qtyB);
  if (den <= 0n) return 0;
  const num = BigInt(qtyA) * BigInt(priceA) + BigInt(qtyB) * BigInt(priceB);
  const avg = (num + den / 2n) / den;
  return Number(avg);
}
