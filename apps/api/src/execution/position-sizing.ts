export interface PositionSizeInput {
  equity: number;
  entryPrice: number;
  stopPrice: number;
  maxRiskPerTrade: number;
  /** Total exposure cap as percent of equity (default 50). */
  maxTotalExposurePct?: number;
  /** Current open notional exposure in dollars. */
  currentExposure?: number;
}

/**
 * Size a long position so dollar risk at stop ≈ maxRiskPerTrade% of equity,
 * then cap by remaining exposure budget. No arbitrary share-count ceiling.
 */
export function computePositionSize(input: PositionSizeInput): number {
  const equity = Math.max(input.equity, 0);
  const entry = Math.max(input.entryPrice, 0.01);
  const stopDistance = Math.max(
    Math.abs(entry - input.stopPrice),
    entry * 0.003,
  );
  const riskBudget = equity * (input.maxRiskPerTrade / 100);
  let qty = Math.floor(riskBudget / stopDistance);

  const exposurePct = input.maxTotalExposurePct ?? 50;
  const maxExposure = equity * (exposurePct / 100);
  const remaining = Math.max(0, maxExposure - (input.currentExposure ?? 0));
  const maxByExposure = Math.floor(remaining / entry);
  if (maxByExposure > 0) {
    qty = Math.min(qty, maxByExposure);
  }

  return Math.max(1, qty);
}
