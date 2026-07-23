/**
 * Production strategy policy (Jul 2026 recovery).
 *
 * PRIMARY (default): `tb_balanced` only.
 *   - One proven champion, 1% stop / 2% target barriers.
 *   - Jul-20 live window was ~88% hit rate on this profile.
 *   - Env: SIGNAL_FORCE_BALANCED=1 (API), ML_FORCE_BALANCED=1 (ML).
 *
 * ALTERNATIVE (opt-in later): curated portfolio slots via shadow soak.
 *   1. Train slot offline / shadow only (activate_best=false).
 * 2. Require soak: enough resolved samples, hit rate ≥ balanced floor,
 *     expectancy > 0.
 *   3. Hard-promote only (no soft-activate).
 *   4. Live kill-switch: if rolling hit rate collapses, demote to shadow
 *     and fall traffic back to tb_balanced.
 *   Enable by setting SIGNAL_FORCE_BALANCED=0 and ML_FORCE_BALANCED=0
 *   after soak gates exist end-to-end.
 */

export const PRIMARY_STRATEGY_ID = 'tb_balanced' as const;

/** Default production confidence floor for signal creation. */
export const PRIMARY_MIN_CONFIDENCE = 0.7;

export function isBalancedForced(raw: string | undefined): boolean {
  return raw !== '0' && raw !== 'false';
}
