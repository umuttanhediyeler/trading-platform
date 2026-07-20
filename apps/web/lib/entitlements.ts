import type { EntitlementMap, PlanTier } from "./types";

const ENTITLEMENTS: Record<PlanTier, EntitlementMap> = {
  free: {
    max_watchlists: 3,
    max_scan_filters: 5,
    ai_signals_enabled: false,
    backtest_enabled: false,
    backtest_unlimited: false,
    simulation_enabled: true,
    one_click_trade: false,
    auto_trade_enabled: false,
    broker_integration: false,
    realtime_data: false,
  },
  basic: {
    max_watchlists: 25,
    max_scan_filters: "unlimited",
    ai_signals_enabled: false,
    backtest_enabled: true,
    backtest_unlimited: false,
    simulation_enabled: true,
    one_click_trade: true,
    auto_trade_enabled: false,
    broker_integration: true,
    realtime_data: true,
  },
  premium: {
    max_watchlists: 50,
    max_scan_filters: "unlimited",
    ai_signals_enabled: true,
    backtest_enabled: true,
    backtest_unlimited: true,
    simulation_enabled: true,
    one_click_trade: true,
    auto_trade_enabled: true,
    broker_integration: true,
    realtime_data: true,
  },
};

export function getEntitlements(planTier: PlanTier): EntitlementMap {
  return ENTITLEMENTS[planTier];
}

export function hasEntitlement(
  planTier: PlanTier,
  key: keyof EntitlementMap,
): boolean {
  const value = ENTITLEMENTS[planTier][key];
  if (typeof value === "boolean") return value;
  if (value === "unlimited") return true;
  return Number(value) > 0;
}

export function canUseScanFilterCount(planTier: PlanTier, count: number): boolean {
  const max = ENTITLEMENTS[planTier].max_scan_filters;
  if (max === "unlimited") return true;
  return count <= max;
}

export function planLabel(planTier: PlanTier): string {
  return planTier.charAt(0).toUpperCase() + planTier.slice(1);
}
