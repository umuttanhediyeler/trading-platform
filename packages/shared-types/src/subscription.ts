/**
 * Subscription & entitlement domain types — shared by apps/web and apps/api.
 *
 * Mirrors the `Subscription` and `Entitlement` Prisma models (see
 * cursor_detailed_spec.md §3). Entitlement values are stored as strings and
 * parsed in the service layer (`"true"` / `"false"` / `"50"`).
 */

/** The three subscription tiers. */
export type PlanTier = "free" | "basic" | "premium";

/** Stripe-driven subscription status. */
export type SubscriptionStatus = "active" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  userId: string;
  planTier: PlanTier;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubId: string | null;
  /** ISO 8601 timestamp, or `null` if no active period. */
  currentPeriodEnd: string | null;
}

/**
 * Well-known entitlement keys enforced by the backend
 * `@RequiresEntitlement(...)` guard.
 */
export type EntitlementKey =
  | "ai_signals_enabled"
  | "auto_trade_enabled"
  | "one_click_enabled"
  | "broker_integration_enabled"
  | "realtime_data_enabled"
  | "backtest_access"
  | "max_watchlists"
  | "max_scan_filters";

/**
 * A single plan capability. `value` is a stringified boolean or number, parsed
 * by the service layer. Unique per `(planTier, key)`.
 */
export interface Entitlement {
  planTier: PlanTier;
  key: EntitlementKey | (string & {});
  /** e.g. `"true"`, `"false"`, `"50"`. */
  value: string;
}
