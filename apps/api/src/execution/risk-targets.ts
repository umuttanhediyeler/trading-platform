/** Strategy baselines — scaled by user risk appetite at order time. */
export const STRATEGY_RISK: Record<
  string,
  { stopLossPercent: number; takeProfitPercent: number }
> = {
  tb_tight_scalp: { stopLossPercent: 0.005, takeProfitPercent: 0.01 },
  tb_balanced: { stopLossPercent: 0.01, takeProfitPercent: 0.02 },
  tb_wide_swing: { stopLossPercent: 0.02, takeProfitPercent: 0.04 },
  tb_momentum: { stopLossPercent: 0.01, takeProfitPercent: 0.03 },
  tb_mean_revert: { stopLossPercent: 0.015, takeProfitPercent: 0.015 },
};

export interface RiskTargetInput {
  entry: number;
  strategyId: string;
  /** User RiskSettings.maxRiskPerTrade (percent of equity). */
  maxRiskPerTrade: number;
  /** Model confidence 0–1; higher confidence widens reward target. */
  confidence?: number;
  /** Long (buy) or short (sell). Shorts invert stop/target around entry. */
  side?: 'buy' | 'sell';
}

export interface RiskTargetResult {
  stopPrice: number;
  targetPrice: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  side: 'buy' | 'sell';
}

/**
 * Derive stop/target from strategy baseline + user risk appetite.
 * Higher maxRiskPerTrade → slightly wider stop and higher reward:risk target
 * (capped so risk guard stays the backstop).
 */
export function computeRiskTargets(input: RiskTargetInput): RiskTargetResult {
  const side = input.side ?? 'buy';
  const base = STRATEGY_RISK[input.strategyId] ?? STRATEGY_RISK.tb_balanced;
  const appetite = Math.min(3, Math.max(0.5, input.maxRiskPerTrade / 1));

  const stopLossPercent = Math.min(
    0.04,
    base.stopLossPercent * (0.85 + appetite * 0.12),
  );

  const confidence = input.confidence ?? 0.6;
  const confidenceBoost = Math.max(0, (confidence - 0.55) * 2);
  const rewardRatio = Math.min(
    5,
    Math.max(
      1.8,
      (base.takeProfitPercent / base.stopLossPercent) +
        confidenceBoost +
        (appetite - 1) * 0.35,
    ),
  );
  const takeProfitPercent = Math.min(0.12, stopLossPercent * rewardRatio);

  if (side === 'sell') {
    return {
      stopPrice: input.entry * (1 + stopLossPercent),
      targetPrice: input.entry * (1 - takeProfitPercent),
      stopLossPercent,
      takeProfitPercent,
      side,
    };
  }

  return {
    stopPrice: input.entry * (1 - stopLossPercent),
    targetPrice: input.entry * (1 + takeProfitPercent),
    stopLossPercent,
    takeProfitPercent,
    side,
  };
}

/** Infer trade side from barrier geometry when Signal has no explicit side. */
export function inferSignalSide(
  entry: number,
  stop: number,
  target: number,
): 'buy' | 'sell' {
  if (stop > entry && target < entry) return 'sell';
  return 'buy';
}
