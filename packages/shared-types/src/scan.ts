/**
 * Scanner domain types — shared by apps/web and apps/api.
 *
 * The filter DSL is persisted as `ScanDefinition.filterDSL` (Prisma `Json`,
 * see cursor_detailed_spec.md §3 and §5). It is a recursive AND/OR tree of
 * comparison conditions evaluated against per-symbol computed fields.
 */

/** Comparison operators supported by a leaf condition. */
export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";

/** Boolean combinators for a filter group. */
export type LogicalOperator = "AND" | "OR";

/**
 * Known scan fields. Every entry MUST have a matching calculation function
 * under `apps/api/src/scanner/filters/` and be registered in that module's
 * `FIELD_REGISTRY` (see §5). Kept as a const tuple so the union type and the
 * runtime list stay in sync.
 */
export const SCAN_FIELDS = [
  "volume_ratio",
  "gap_percent",
  "rsi_14",
  "price_vs_vwap",
] as const;

export type ScanField = (typeof SCAN_FIELDS)[number];

/** A single leaf comparison, e.g. `{ field: "volume_ratio", op: ">", value: 3 }`. */
export interface ScanCondition {
  /** Registered field name; typed as string to allow forward-compatible fields. */
  field: ScanField | (string & {});
  op: ComparisonOperator;
  value: number;
}

/** A group of conditions combined with a logical operator; may nest. */
export interface ScanFilterGroup {
  operator: LogicalOperator;
  conditions: Array<ScanCondition | ScanFilterGroup>;
}

/** Root of a scan's filter DSL (always a group). */
export type ScanFilter = ScanFilterGroup;

export const COMPARISON_OPERATORS = [">", ">=", "<", "<=", "==", "!="] as const;

export interface ScanFieldDefinition {
  field: ScanField;
  label: string;
  unit?: string;
}

export const SCAN_FIELD_DEFINITIONS: readonly ScanFieldDefinition[] = [
  { field: "volume_ratio", label: "Volume ratio", unit: "×" },
  { field: "gap_percent", label: "Gap", unit: "%" },
  { field: "rsi_14", label: "RSI (14)" },
  { field: "price_vs_vwap", label: "Price vs VWAP", unit: "%" },
];

export interface ScanTemplate {
  id: string;
  name: string;
  description: string;
  filterDSL: ScanFilter;
}

export interface CreateScanRequest {
  name: string;
  filterDSL: ScanFilter;
}

export type UpdateScanRequest = CreateScanRequest;

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

/** A saved scan definition (mirrors the `ScanDefinition` Prisma model). */
export interface ScanDefinition {
  id: string;
  userId: string;
  name: string;
  filterDSL: ScanFilter;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A single row emitted by a scan run. */
export interface ScanRow {
  symbol: string;
  price: number;
  volume: number;
  volumeRatio: number;
  gapPercent: number;
  rsi14: number;
  priceVsVwap: number;
  changePercent: number;
  values: Record<string, number>;
  stale?: boolean;
  /** ISO 8601 timestamp of when this row matched. */
  matchedAt: string;
}

/**
 * Result of a scan run. Also the payload of the `scan:result` WebSocket event
 * (server → client, namespace `/ws`).
 */
export interface ScanResult {
  scanId: string;
  rows: ScanRow[];
}
