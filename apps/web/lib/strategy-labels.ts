/** Human-readable labels for trade-barrier strategy IDs. */
export const STRATEGY_LABELS: Record<string, string> = {
  tb_tight_scalp: "Sıkı scalp · %0.5 stop / %1 hedef",
  tb_balanced: "Dengeli · %1 stop / %2 hedef",
  tb_wide_swing: "Geniş swing · %2 stop / %4 hedef",
  tb_momentum: "Momentum · %1 stop / %3 hedef",
  tb_mean_revert: "Mean revert · %1.5 stop / %1.5 hedef",
};

export function strategyLabel(strategyId: string): string {
  return STRATEGY_LABELS[strategyId] ?? strategyId;
}

/** Infer long/short from barrier geometry when API has no explicit side. */
export function inferSignalSide(
  entry: number,
  stop: number,
  target: number,
): "buy" | "sell" {
  if (stop > entry && target < entry) return "sell";
  return "buy";
}
