/**
 * @trading-platform/shared-types
 *
 * Single source of truth for cross-service data contracts. Imported by both
 * apps/web (Next.js) and apps/api (NestJS). Python services (packages/ml,
 * packages/backtest) re-declare the equivalent shapes on their side.
 */
export * from "./signal";
export * from "./scan";
export * from "./subscription";
