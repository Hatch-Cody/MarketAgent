/**
 * Dividends and splits. Providers return an empty list unless they have the data,
 * and the broker applies whatever shows up. The mock and Finnhub free tier do not
 * currently supply actions, so production is a no-op until a provider does.
 */

export type CorporateAction =
  | {
      id: string;
      type: "dividend";
      symbol: string;
      cashPerShareCents: number;
      date: string;
    }
  | {
      id: string;
      type: "split";
      symbol: string;
      numerator: number;
      denominator: number;
      date: string;
    };

export function applySplit(
  microshares: number,
  avgCostTicks: number,
  numerator: number,
  denominator: number,
): { microshares: number; avgCostTicks: number } {
  if (numerator <= 0 || denominator <= 0) {
    throw new Error("Split ratio must be positive.");
  }
  const qtyNum = BigInt(microshares) * BigInt(numerator);
  const qtyDen = BigInt(denominator);
  const nextQty = Number((qtyNum + qtyDen / 2n) / qtyDen);
  const avgNum = BigInt(avgCostTicks) * BigInt(denominator);
  const avgDen = BigInt(numerator);
  const nextAvg = Number((avgNum + avgDen / 2n) / avgDen);
  return {
    microshares: Math.max(0, nextQty),
    avgCostTicks: Math.max(1, nextAvg),
  };
}

export function dividendCreditCents(microshares: number, centsPerShare: number): number {
  if (microshares <= 0 || centsPerShare <= 0) return 0;
  const num = BigInt(microshares) * BigInt(Math.round(centsPerShare));
  const den = 1_000_000n;
  return Number((num + den / 2n) / den);
}
