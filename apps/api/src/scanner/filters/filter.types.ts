import { Bar } from '../../market-data/providers/market-data-provider.interface';
import { gapPercent } from './gap-up.filter';
import { priceVsVwap } from './price-vs-vwap.filter';
import { rsi14 } from './rsi-threshold.filter';
import { volumeRatio } from './volume-spike.filter';

export type FilterOp = '>' | '<' | '>=' | '<=' | '==' | '!=';

export interface FilterCondition {
  field: string;
  op: FilterOp;
  value: number;
}

export interface FilterGroup {
  operator: 'AND' | 'OR';
  conditions: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export function isGroup(node: FilterNode): node is FilterGroup {
  return (node as FilterGroup).operator !== undefined;
}

/**
 * Computes a single numeric indicator from time-ordered bars (oldest first).
 * Implementations must only look backwards in time.
 */
export type FieldComputer = (bars: Bar[]) => number;

/**
 * Every DSL `field` name maps to a computer here. Adding a filter requires:
 * (1) a new file in scanner/filters, (2) an entry in this registry,
 * (3) the frontend ScanBuilder dropdown.
 */
export const FIELD_REGISTRY: Record<string, FieldComputer> = {
  volume_ratio: volumeRatio,
  gap_percent: gapPercent,
  rsi_14: rsi14,
  price_vs_vwap: priceVsVwap,
};

export function computeFields(bars: Bar[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [field, compute] of Object.entries(FIELD_REGISTRY)) {
    values[field] = compute(bars);
  }
  return values;
}

const OPS: Record<FilterOp, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/** Recursively evaluates a filter DSL tree against pre-computed field values. */
export function evaluateDSL(
  node: FilterNode,
  values: Record<string, number>,
): boolean {
  if (isGroup(node)) {
    if (node.operator === 'AND') {
      return node.conditions.every((c) => evaluateDSL(c, values));
    }
    return node.conditions.some((c) => evaluateDSL(c, values));
  }
  const actual = values[node.field];
  if (actual === undefined || Number.isNaN(actual)) {
    return false;
  }
  const op = OPS[node.op];
  if (!op) {
    throw new Error(`Unknown operator '${node.op}'`);
  }
  return op(actual, node.value);
}

/** Counts leaf conditions — used to enforce the plan's max_scan_filters limit. */
export function countConditions(node: FilterNode): number {
  if (isGroup(node)) {
    return node.conditions.reduce((sum, c) => sum + countConditions(c), 0);
  }
  return 1;
}

/** Validates that every referenced field exists in the registry. */
export function validateDSL(node: FilterNode): string[] {
  const errors: string[] = [];
  const walk = (n: FilterNode) => {
    if (!n || typeof n !== 'object') {
      errors.push('Every filter node must be an object');
      return;
    }
    if (isGroup(n)) {
      if (n.operator !== 'AND' && n.operator !== 'OR') {
        errors.push(`Invalid group operator '${(n as FilterGroup).operator}'`);
      }
      if (!Array.isArray(n.conditions) || n.conditions.length === 0) {
        errors.push('Filter groups must contain at least one condition');
        return;
      }
      n.conditions.forEach(walk);
      return;
    }
    if (!(n.field in FIELD_REGISTRY)) {
      errors.push(`Unknown field '${n.field}'`);
    }
    if (!(n.op in OPS)) {
      errors.push(`Unknown operator '${n.op}'`);
    }
    if (typeof n.value !== 'number' || !Number.isFinite(n.value)) {
      errors.push(`Invalid value for '${n.field}'`);
    }
  };
  walk(node);
  return errors;
}
