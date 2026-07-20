/**
 * Signal domain types — shared by apps/web and apps/api.
 *
 * Mirrors the `Signal` Prisma model (see cursor_detailed_spec.md §3). The DB
 * stores prices as Decimal; the API serializes them to `number` over the wire,
 * so consumers that require exact precision should re-parse from the raw source.
 */

/**
 * Lifecycle of a generated signal.
 * - `open`       : live, neither barrier hit yet
 * - `hit_target` : take-profit barrier reached
 * - `hit_stop`   : stop-loss barrier reached
 * - `expired`    : max holding window elapsed without hitting a barrier
 */
export type SignalStatus = "open" | "hit_target" | "hit_stop" | "expired";

export interface Signal {
  id: string;
  symbol: string;
  /** Identifier of the strategy that produced the signal. */
  strategyId: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  /** Calibrated model probability in the range [0, 1]. */
  confidence: number;
  /** ISO 8601 timestamp of when the signal was generated. */
  generatedAt: string;
  status: SignalStatus;
  /** ISO 8601 timestamp of resolution, or `null` while still open. */
  resolvedAt: string | null;
}

/**
 * Payload of the `signal:new` WebSocket event (server → client, namespace `/ws`).
 */
export type SignalNewEvent = Signal;
