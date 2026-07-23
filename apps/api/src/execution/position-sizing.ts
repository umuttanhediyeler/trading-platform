export interface PositionSizeInput {
  equity: number;
  entryPrice: number;
  stopPrice: number;
  maxRiskPerTrade: number;
  /** Take-profit level — used for reward:risk (Kelly odds). */
  targetPrice?: number;
  /** Model confidence 0–1 — lightly blended; empirical edge dominates. */
  confidence?: number;
  /** Total exposure cap as percent of equity (default 70). */
  maxTotalExposurePct?: number;
  /** Current open notional exposure in dollars. */
  currentExposure?: number;
  /**
   * Monthly subscription fee in USD (premium default $79).
   * Soft aspirational floor: size so positive-EV clips are not
   * under-bet relative to ~2× fee / month on a typical book.
   * Not a guarantee — we are not analysts.
   */
  monthlySubscriptionUsd?: number;
}

/**
 * Empirical priors from resolved Apex signals (~30d ledger):
 * decisive TP vs SL win rate ≈ 78%; including expired ≈ 65%.
 * High raw confidence was *miscalibrated* (ge85 win% << mid buckets),
 * so confidence only gently tilts p — geometry + empirics drive Kelly.
 *
 * Literature: Kelly maximizes long-run log growth (Kelly 1956; Thorp);
 * fractional Kelly trades growth vs security (MacLean, Ziemba, Blazenko 1992).
 * We use half-Kelly inside the user's maxRiskPerTrade safe harbor.
 */
export const EMPIRICAL_WIN_RATE = 0.65;
export const KELLY_FRACTION = 0.5; // half-Kelly
/** Soft single-name notional ceiling — allows differentiation, blocks one-name blowups when stops are tiny. */
export const MAX_SINGLE_NAME_NOTIONAL_PCT = 0.22;
export const DEFAULT_PREMIUM_SUBSCRIPTION_USD = 79;

/**
 * Edge score for ranking which setups claim capital first.
 * Centered near ~1 for conf≈0.7 / R:R≈2.
 */
export function tradeQualityScore(input: {
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number;
  confidence?: number;
}): number {
  const entry = Math.max(input.entryPrice, 0.01);
  const stopDistance = Math.max(
    Math.abs(entry - input.stopPrice),
    entry * 0.003,
  );
  const rewardDistance =
    input.targetPrice != null && Number.isFinite(input.targetPrice)
      ? Math.max(Math.abs(Number(input.targetPrice) - entry), stopDistance * 0.5)
      : stopDistance * 2;
  const rewardRisk = rewardDistance / stopDistance;

  const confidence = Math.min(0.95, Math.max(0.5, input.confidence ?? 0.65));
  const confFactor = 0.55 + (confidence - 0.5) * 1.6; // ~0.55–1.27
  const rrFactor = Math.min(1.55, Math.max(0.55, rewardRisk / 2)); // RR=2 → 1
  return Math.min(1.65, Math.max(0.4, confFactor * rrFactor));
}

/** Binary-outcome Kelly fraction of bankroll (full Kelly). */
export function fullKellyFraction(winProb: number, rewardRisk: number): number {
  const p = Math.min(0.95, Math.max(0.05, winProb));
  const b = Math.max(rewardRisk, 0.01);
  const f = (p * (b + 1) - 1) / b;
  return Math.max(0, f);
}

/**
 * Win probability: shrink model confidence toward empirical base rate.
 * Confidence alone is not treated as calibrated p(win).
 */
export function estimateWinProbability(
  confidence: number | undefined,
  empiricalWinRate = EMPIRICAL_WIN_RATE,
): number {
  const conf = Math.min(0.95, Math.max(0.5, confidence ?? 0.65));
  // Mild model tilt only — empirics dominate (calibration fix).
  const modelP = 0.55 + (conf - 0.5) * 0.35; // ~0.55–0.71
  const p = 0.7 * empiricalWinRate + 0.3 * modelP;
  return Math.min(0.9, Math.max(0.45, p));
}

export interface PositionSizeBreakdown {
  qty: number;
  quality: number;
  rewardRisk: number;
  winProb: number;
  fullKelly: number;
  halfKelly: number;
  riskPct: number;
  notional: number;
}

/**
 * Size by half-Kelly risk dollars inside the user's maxRiskPerTrade cap.
 * Removes the old flat ~3–8% notional band that forced every clip to ~$7.5–8k.
 *
 * Safe harbor:
 *  - dollars at risk ≤ maxRiskPerTrade% of equity (user setting)
 *  - half-Kelly never exceeds that cap
 *  - total book ≤ maxTotalExposurePct
 *  - single name ≤ ~22% equity (noise-stop blow-up guard)
 *
 * Soft goal: premium fee × 2 / month as aspirational EV floor — we avoid
 * under-betting positive half-Kelly setups (no hard PnL promise).
 */
export function computePositionSize(input: PositionSizeInput): number {
  return computePositionSizeDetailed(input).qty;
}

export function computePositionSizeDetailed(
  input: PositionSizeInput,
): PositionSizeBreakdown {
  const equity = Math.max(input.equity, 0);
  const entry = Math.max(input.entryPrice, 0.01);
  const stopDistance = Math.max(
    Math.abs(entry - input.stopPrice),
    entry * 0.003,
  );
  const rewardDistance =
    input.targetPrice != null && Number.isFinite(input.targetPrice)
      ? Math.max(Math.abs(Number(input.targetPrice) - entry), stopDistance * 0.5)
      : stopDistance * 2;
  const rewardRisk = rewardDistance / stopDistance;

  const quality = tradeQualityScore({
    entryPrice: entry,
    stopPrice: input.stopPrice,
    targetPrice: input.targetPrice,
    confidence: input.confidence,
  });

  const winProb = estimateWinProbability(input.confidence);
  const fullKelly = fullKellyFraction(winProb, rewardRisk);
  const halfKelly = fullKelly * KELLY_FRACTION;

  // User safe harbor: never risk more than maxRiskPerTrade% of equity.
  const maxRiskPct = Math.max(0.25, input.maxRiskPerTrade) / 100;

  // Scale toward the Kelly optimum inside the harbor: weak/zero-edge → small;
  // strong half-Kelly → full allowed risk. quality tilts within that band.
  let riskPct = 0;
  if (halfKelly <= 0) {
    riskPct = 0;
  } else {
    const kellyFill = Math.min(1, halfKelly / Math.max(maxRiskPct, 1e-6));
    const qualityFill = Math.min(1.15, Math.max(0.45, quality));
    riskPct = maxRiskPct * Math.min(1, kellyFill * qualityFill);
  }

  // Soft subscription aspirational floor (premium $79 → ~$158/mo):
  // if edge is clearly positive, don't leave risk below ~half of the harbor.
  const fee = input.monthlySubscriptionUsd ?? DEFAULT_PREMIUM_SUBSCRIPTION_USD;
  const aspirationalMonthly = fee * 2;
  if (halfKelly > 0.02 && quality >= 0.9 && equity > 0) {
    // Rough: need enough risk capacity that a few +EV clips can cover 2× fee.
    // On $100k book, 0.8% risk × ~2% expectancy ≈ material vs $158.
    const softFloor = Math.min(
      maxRiskPct,
      Math.max(maxRiskPct * 0.5, aspirationalMonthly / equity),
    );
    riskPct = Math.max(riskPct, softFloor * Math.min(1, quality));
  }

  riskPct = Math.min(maxRiskPct, Math.max(0, riskPct));

  let qty = Math.floor((equity * riskPct) / stopDistance);

  const exposurePct = input.maxTotalExposurePct ?? 70;
  const maxExposure = equity * (exposurePct / 100);
  const remaining = Math.max(0, maxExposure - (input.currentExposure ?? 0));

  // Quality/Kelly-scaled name ceiling: weak ~8–12%, strong up to ~22%.
  // Stops the old behavior where every clip pinned the same hard notional %.
  const nameCapPct = Math.min(
    MAX_SINGLE_NAME_NOTIONAL_PCT,
    Math.max(0.08, 0.06 + 0.12 * Math.min(1.2, quality) * Math.min(1, halfKelly / 0.05)),
  );
  const maxByName = Math.floor((equity * nameCapPct) / entry);
  const maxByExposure = Math.floor(remaining / entry);

  const caps = [qty];
  if (maxByName > 0) caps.push(maxByName);
  if (Number.isFinite(maxByExposure) && maxByExposure >= 0) {
    caps.push(maxByExposure);
  }
  qty = Math.min(...caps);
  qty = Math.max(0, qty);

  return {
    qty,
    quality,
    rewardRisk,
    winProb,
    fullKelly,
    halfKelly,
    riskPct,
    notional: qty * entry,
  };
}
