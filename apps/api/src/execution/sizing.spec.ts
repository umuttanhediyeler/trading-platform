import { describe, expect, it } from '@jest/globals';
import {
  computePositionSize,
  computePositionSizeDetailed,
  fullKellyFraction,
  tradeQualityScore,
} from './position-sizing';
import { computeRiskTargets, pickStrategyId } from './risk-targets';

describe('position-sizing', () => {
  it('uses half-Kelly risk inside maxRiskPerTrade, not a flat 3–8% notional band', () => {
    const mid = computePositionSizeDetailed({
      equity: 100_000,
      entryPrice: 200,
      stopPrice: 196,
      targetPrice: 208,
      confidence: 0.7,
      maxRiskPerTrade: 2,
    });
    const strong = computePositionSizeDetailed({
      equity: 100_000,
      entryPrice: 200,
      stopPrice: 196,
      targetPrice: 212,
      confidence: 0.9,
      maxRiskPerTrade: 2,
    });
    expect(strong.qty).toBeGreaterThan(mid.qty);
    // Strong setup may exceed the old 8% ($16k) band when stop risk allows.
    expect(strong.notional).toBeGreaterThan(8_000);
    // Still inside single-name soft ceiling (~22%).
    expect(strong.notional).toBeLessThanOrEqual(22_000 + entrySlack(200));
    expect(strong.riskPct).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it('allocates more shares to higher R:R / better Kelly setups', () => {
    const weak = computePositionSize({
      equity: 100_000,
      entryPrice: 100,
      stopPrice: 98,
      targetPrice: 102,
      confidence: 0.55,
      maxRiskPerTrade: 2,
    });
    const strong = computePositionSize({
      equity: 100_000,
      entryPrice: 100,
      stopPrice: 98,
      targetPrice: 108,
      confidence: 0.85,
      maxRiskPerTrade: 2,
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it('does not flatten weak and strong setups to the same ~$8k notional', () => {
    const weak = computePositionSizeDetailed({
      equity: 100_000,
      entryPrice: 100,
      stopPrice: 98,
      targetPrice: 102,
      confidence: 0.55,
      maxRiskPerTrade: 2,
    });
    const strong = computePositionSizeDetailed({
      equity: 100_000,
      entryPrice: 100,
      stopPrice: 98,
      targetPrice: 110,
      confidence: 0.9,
      maxRiskPerTrade: 2,
    });
    expect(strong.notional).toBeGreaterThan(weak.notional + 4_000);
    expect(strong.notional).toBeGreaterThan(15_000);
    expect(weak.notional).toBeLessThan(14_000);
    expect(strong.riskPct).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it('respects exposure cap and remaining budget', () => {
    const qty = computePositionSize({
      equity: 100_000,
      entryPrice: 200,
      stopPrice: 196,
      targetPrice: 208,
      confidence: 0.8,
      maxRiskPerTrade: 2,
      maxTotalExposurePct: 10,
      currentExposure: 0,
    });
    expect(qty).toBe(50);
  });

  it('shrinks into leftover book room instead of skipping', () => {
    const qty = computePositionSize({
      equity: 100_000,
      entryPrice: 100,
      stopPrice: 98,
      targetPrice: 106,
      confidence: 0.85,
      maxRiskPerTrade: 2,
      maxTotalExposurePct: 70,
      currentExposure: 65_000, // $5k room left
    });
    expect(qty).toBeGreaterThan(0);
    expect(qty).toBeLessThanOrEqual(50);
  });

  it('scores high confidence + high R:R above 1', () => {
    const score = tradeQualityScore({
      entryPrice: 100,
      stopPrice: 98,
      targetPrice: 108,
      confidence: 0.85,
    });
    expect(score).toBeGreaterThan(1);
  });

  it('computes positive full Kelly for favorable odds', () => {
    expect(fullKellyFraction(0.65, 2)).toBeGreaterThan(0.4);
    expect(fullKellyFraction(0.4, 1)).toBe(0);
  });
});

function entrySlack(entry: number): number {
  return entry; // one share of rounding slack for floor()
}

describe('risk-targets', () => {
  it('widens reward target with higher risk appetite', () => {
    const conservative = computeRiskTargets({
      entry: 100,
      strategyId: 'tb_balanced',
      maxRiskPerTrade: 1,
      confidence: 0.6,
    });
    const aggressive = computeRiskTargets({
      entry: 100,
      strategyId: 'tb_balanced',
      maxRiskPerTrade: 3,
      confidence: 0.75,
    });
    expect(aggressive.takeProfitPercent).toBeGreaterThan(
      conservative.takeProfitPercent,
    );
  });

  it('picks diversified strategies from regime + confidence', () => {
    expect(pickStrategyId('trend', 0.8)).toBe('tb_momentum');
    expect(pickStrategyId('range', 0.65)).toBe('tb_mean_revert');
    expect(pickStrategyId('high_vol', 0.6)).toBe('tb_tight_scalp');
    expect(pickStrategyId('high_vol', 0.8)).toBe('tb_wide_swing');
    expect(pickStrategyId('unknown', 0.66)).toBe('tb_balanced');
  });
});
