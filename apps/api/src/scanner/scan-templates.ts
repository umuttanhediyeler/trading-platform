import type { ScanTemplate } from '@trading-platform/shared-types';
import { FilterGroup } from './filters/filter.types';

/** Ready-made scan templates so users never have to start from scratch. */
export const SCAN_TEMPLATES: Array<ScanTemplate & { filterDSL: FilterGroup }> = [
  {
    id: 'volume-breakout',
    name: 'Volume Breakout',
    description: 'Volume at least 3x the 20-bar average',
    filterDSL: {
      operator: 'AND',
      conditions: [{ field: 'volume_ratio', op: '>', value: 3 }],
    },
  },
  {
    id: 'gap-and-go',
    name: 'Gap & Go',
    description: 'Gapped up 4%+ with heavy volume',
    filterDSL: {
      operator: 'AND',
      conditions: [
        { field: 'gap_percent', op: '>', value: 4 },
        { field: 'volume_ratio', op: '>', value: 2 },
      ],
    },
  },
  {
    id: 'oversold-reversal',
    name: 'Oversold Reversal',
    description: 'RSI below 30 — potential bounce candidates',
    filterDSL: {
      operator: 'AND',
      conditions: [{ field: 'rsi_14', op: '<', value: 30 }],
    },
  },
  {
    id: 'overbought-fade',
    name: 'Overbought Fade',
    description: 'RSI above 70 — potential mean-reversion shorts',
    filterDSL: {
      operator: 'AND',
      conditions: [{ field: 'rsi_14', op: '>', value: 70 }],
    },
  },
  {
    id: 'gap-down-panic',
    name: 'Gap Down Panic',
    description: 'Gapped down 4%+ on elevated volume',
    filterDSL: {
      operator: 'AND',
      conditions: [
        { field: 'gap_percent', op: '<', value: -4 },
        { field: 'volume_ratio', op: '>', value: 1.5 },
      ],
    },
  },
  {
    id: 'quiet-accumulation',
    name: 'Quiet Accumulation',
    description: 'Mild volume pickup without a big gap',
    filterDSL: {
      operator: 'AND',
      conditions: [
        { field: 'volume_ratio', op: '>', value: 1.5 },
        { field: 'volume_ratio', op: '<', value: 3 },
        { field: 'gap_percent', op: '<', value: 1 },
        { field: 'gap_percent', op: '>', value: -1 },
      ],
    },
  },
  {
    id: 'momentum-continuation',
    name: 'Momentum Continuation',
    description: 'Strong RSI with a modest gap up',
    filterDSL: {
      operator: 'AND',
      conditions: [
        { field: 'rsi_14', op: '>', value: 55 },
        { field: 'rsi_14', op: '<', value: 70 },
        { field: 'gap_percent', op: '>', value: 1 },
      ],
    },
  },
  {
    id: 'capitulation-bounce',
    name: 'Capitulation Bounce',
    description: 'Deeply oversold OR panic gap down on volume',
    filterDSL: {
      operator: 'OR',
      conditions: [
        { field: 'rsi_14', op: '<', value: 20 },
        {
          operator: 'AND',
          conditions: [
            { field: 'gap_percent', op: '<', value: -6 },
            { field: 'volume_ratio', op: '>', value: 2 },
          ],
        },
      ],
    },
  },
  {
    id: 'volume-dry-up',
    name: 'Volume Dry-Up',
    description: 'Volume well below average — consolidation watch',
    filterDSL: {
      operator: 'AND',
      conditions: [{ field: 'volume_ratio', op: '<', value: 0.5 }],
    },
  },
  {
    id: 'gap-fill-candidate',
    name: 'Gap Fill Candidate',
    description: 'Gapped 2-5% either way on unremarkable volume',
    filterDSL: {
      operator: 'AND',
      conditions: [
        {
          operator: 'OR',
          conditions: [
            { field: 'gap_percent', op: '>', value: 2 },
            { field: 'gap_percent', op: '<', value: -2 },
          ],
        },
        { field: 'volume_ratio', op: '<', value: 1.5 },
      ],
    },
  },
  {
    id: 'neutral-rsi-spike',
    name: 'Neutral RSI Volume Spike',
    description: 'Volume spike while RSI is still mid-range',
    filterDSL: {
      operator: 'AND',
      conditions: [
        { field: 'volume_ratio', op: '>', value: 3 },
        { field: 'rsi_14', op: '>', value: 40 },
        { field: 'rsi_14', op: '<', value: 60 },
      ],
    },
  },
  {
    id: 'extreme-mover',
    name: 'Extreme Mover',
    description: 'Any extreme condition: huge gap, huge volume, or extreme RSI',
    filterDSL: {
      operator: 'OR',
      conditions: [
        { field: 'gap_percent', op: '>', value: 8 },
        { field: 'gap_percent', op: '<', value: -8 },
        { field: 'volume_ratio', op: '>', value: 5 },
        { field: 'rsi_14', op: '>', value: 80 },
        { field: 'rsi_14', op: '<', value: 20 },
      ],
    },
  },
];
