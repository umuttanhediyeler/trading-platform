import type {
  BacktestMetrics,
  Candle,
  FilterDSL,
  ScanRow,
  Signal,
  SimulationAccount,
} from "./types";

/** Representative demo rows for UI development — not live market data. */
const DEMO_ROW_META = {
  priceVsVwap: 0,
  values: {},
  matchedAt: "2026-01-01T00:00:00.000Z",
};

export const DEMO_SCAN_ROWS: ScanRow[] = [
  {
    ...DEMO_ROW_META,
    symbol: "AAPL",
    price: 198.42,
    changePercent: 1.24,
    volume: 42_150_000,
    volumeRatio: 2.1,
    rsi14: 58.2,
    gapPercent: 0.8,
  },
  {
    ...DEMO_ROW_META,
    symbol: "NVDA",
    price: 118.65,
    changePercent: 3.41,
    volume: 68_420_000,
    volumeRatio: 3.4,
    rsi14: 72.1,
    gapPercent: 2.2,
  },
  {
    ...DEMO_ROW_META,
    symbol: "TSLA",
    price: 241.18,
    changePercent: -1.05,
    volume: 91_200_000,
    volumeRatio: 1.6,
    rsi14: 44.5,
    gapPercent: -0.4,
    stale: true,
  },
  {
    ...DEMO_ROW_META,
    symbol: "AMD",
    price: 162.33,
    changePercent: 2.08,
    volume: 55_800_000,
    volumeRatio: 2.8,
    rsi14: 61.0,
    gapPercent: 1.5,
  },
  {
    ...DEMO_ROW_META,
    symbol: "META",
    price: 512.9,
    changePercent: 0.62,
    volume: 18_400_000,
    volumeRatio: 1.2,
    rsi14: 53.4,
    gapPercent: 0.3,
  },
];

export const DEMO_SIGNALS: Signal[] = [
  {
    id: "sig-demo-1",
    symbol: "NVDA",
    strategyId: "momentum-breakout-v3",
    entryPrice: 117.5,
    stopPrice: 113.2,
    targetPrice: 126.0,
    confidence: 0.72,
    generatedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    status: "open",
  },
  {
    id: "sig-demo-2",
    symbol: "AMD",
    strategyId: "oversold-reversal-v2",
    entryPrice: 160.1,
    stopPrice: 155.4,
    targetPrice: 170.0,
    confidence: 0.64,
    generatedAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    status: "open",
  },
];

export const DEMO_FILTER_DSL: FilterDSL = {
  operator: "AND",
  conditions: [
    { field: "volume_ratio", op: ">", value: 3 },
    { field: "gap_percent", op: ">", value: 4 },
    {
      operator: "OR",
      conditions: [
        { field: "rsi_14", op: "<", value: 30 },
        { field: "price_vs_vwap", op: "<", value: -2 },
      ],
    },
  ],
};

export const SCAN_TEMPLATES: Array<{ id: string; name: string; description: string }> = [
  { id: "new-high", name: "New High Continuation", description: "52w high + volume confirmation" },
  { id: "gap-continue", name: "Gap & Go", description: "Gap up > 4% with follow-through" },
  { id: "oversold", name: "Oversold Reversal", description: "RSI < 30 near VWAP reclaim" },
  { id: "volume-spike", name: "Volume Spike", description: "Volume > 3x 20-day average" },
  { id: "trend-pullback", name: "Trend Pullback", description: "Uptrend pullback to EMA20" },
];

export const FIELD_OPTIONS = [
  { field: "volume_ratio", label: "Volume ratio" },
  { field: "gap_percent", label: "Gap %" },
  { field: "rsi_14", label: "RSI (14)" },
  { field: "price_vs_vwap", label: "Price vs VWAP %" },
  { field: "atr_percent", label: "ATR %" },
  { field: "change_percent", label: "Change %" },
] as const;

export function buildDemoCandles(seed = 100): Candle[] {
  const candles: Candle[] = [];
  let price = seed;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 120; i >= 0; i -= 1) {
    const open = price;
    const drift = (Math.sin(i / 8) + (i % 5) * 0.02) * 0.6;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + 0.4;
    const low = Math.min(open, close) - 0.4;
    candles.push({
      time: now - i * 60 * 15,
      open,
      high,
      low,
      close,
      volume: 800_000 + (i % 7) * 120_000,
    });
    price = close;
  }
  return candles;
}

export const DEMO_BACKTEST: BacktestMetrics = {
  runId: "demo",
  totalReturn: 18.4,
  sharpe: 1.32,
  maxDrawdown: -9.7,
  winRate: 54.2,
  expectancy: 0.42,
  profitFactor: 1.48,
  numTrades: 42,
  liveSharpe30d: 0.21,
};

export const DEMO_SIM_ACCOUNT: SimulationAccount = {
  balance: 100_000,
  equity: 101_842.55,
  dayPnl: 412.3,
  openPositions: [
    {
      id: "pos-1",
      symbol: "AAPL",
      side: "buy",
      quantity: 40,
      entryPrice: 196.2,
      currentPrice: 198.42,
      pnl: 88.8,
      status: "open",
      source: "manual",
    },
    {
      id: "pos-2",
      symbol: "NVDA",
      side: "buy",
      quantity: 25,
      entryPrice: 115.0,
      currentPrice: 118.65,
      pnl: 91.25,
      status: "open",
      source: "ai_signal",
    },
  ],
  closedTrades: [
    {
      id: "pos-3",
      symbol: "AMD",
      side: "buy",
      quantity: 50,
      entryPrice: 158.0,
      currentPrice: 161.2,
      pnl: 160,
      status: "closed",
      source: "manual",
    },
  ],
};

export const DEMO_WATCHLISTS = [
  { id: "wl-1", name: "Momentum", symbols: ["NVDA", "AMD", "META"] },
  { id: "wl-2", name: "Mega Cap", symbols: ["AAPL", "MSFT", "GOOGL"] },
];
