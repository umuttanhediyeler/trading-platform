export type PlanTier = "free" | "basic" | "premium";

export type ExecutionMode = "manual" | "one_click" | "full_auto";
export type BrokerName = "alpaca" | "binance";

export interface BrokerCapabilities {
  marketOrders: boolean;
  limitOrders: boolean;
  bracketOrders: boolean;
  fractionalQuantity: boolean;
  positions: "full" | "balances_only";
  paper: boolean;
  live: boolean;
}

export interface BrokerProvider {
  id: BrokerName | "interactive_brokers" | "bank";
  name: string;
  availability: "available" | "disabled" | "unavailable";
  credentialLabels: { apiKey: string; apiSecret: string } | null;
  capabilities: BrokerCapabilities | null;
  description: string;
  setupRequirements?: string[];
}

export type SignalStatus = "open" | "hit_target" | "hit_stop" | "expired";

export interface UserProfile {
  id: string;
  email: string;
  planTier: PlanTier;
  executionMode: ExecutionMode;
  killSwitchActive: boolean;
}

export interface EntitlementMap {
  max_watchlists: number;
  max_scan_filters: number | "unlimited";
  ai_signals_enabled: boolean;
  backtest_enabled: boolean;
  backtest_unlimited: boolean;
  simulation_enabled: boolean;
  one_click_trade: boolean;
  auto_trade_enabled: boolean;
  broker_integration: boolean;
  realtime_data: boolean;
}

export type {
  ScanCondition,
  ScanDefinition,
  ScanFilterGroup as ScanGroup,
  ScanRow,
  ScanTemplate,
  Watchlist,
} from "@trading-platform/shared-types";
export type { ScanFilter as FilterDSL } from "@trading-platform/shared-types";

export interface Signal {
  id: string;
  symbol: string;
  strategyId: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  /** Present on newer API responses; inferred from barriers when missing. */
  side?: "buy" | "sell";
  confidence: number;
  generatedAt: string;
  status: SignalStatus;
  resolvedAt?: string | null;
  resolvedPrice?: number | null;
  realizedReturn?: number | null;
  modelVersion?: string | null;
}

export interface SignalSummary {
  open: number;
  hitTarget: number;
  hitStop: number;
  expired: number;
  resolved: number;
  hitRate: number | null;
  averageReturn: number | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface RiskSettings {
  maxDailyTrades: number;
  maxDailyLossPercent: number;
  maxRiskPerTrade: number;
  killSwitchActive: boolean;
  executionMode: ExecutionMode;
}

export interface SimulatedPosition {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  status: "open" | "closed";
  source: "manual" | "ai_signal";
}

export interface SimulationAccount {
  balance: number;
  equity: number;
  dayPnl: number;
  openPositions: SimulatedPosition[];
  closedTrades: SimulatedPosition[];
}

export type BrokerOrderSource = "one_click" | "full_auto" | "manual" | string;
export type BrokerOrderStatus = "pending" | "submitted" | "failed" | "canceled" | string;

export interface BrokerOrderLedgerEntry {
  id: string;
  clientOrderId: string;
  brokerOrderId: string | null;
  broker: string;
  mode: "paper" | "live" | string;
  symbol: string;
  side: "buy" | "sell" | string;
  quantity: number;
  orderType: string;
  limitPrice: number | null;
  source: BrokerOrderSource;
  signalId: string | null;
  status: BrokerOrderStatus;
  brokerStatus: string | null;
  failureReason: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerReconcileResult {
  checked: number;
  updated: number;
  cleaned?: number;
  errors: Array<{ clientOrderId: string; message: string }>;
}

export interface BacktestMetrics {
  runId: string;
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  numTrades?: number;
  equityCurve?: Array<{ ts: string; equity: number }>;
  liveSharpe30d?: number;
}

export type StrategyCategory = "trend-following" | "mean-reversion" | "breakout";

export interface StrategyParameter {
  name: string;
  label: string;
  type: "number" | "boolean";
  default: number | boolean;
  min?: number;
  max?: number;
}

export interface BacktestStrategy {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;
  params: StrategyParameter[];
}

export interface BacktestRun {
  id: string;
  symbol: string;
  strategyId: string;
  status: "running" | "completed" | "failed";
  metrics: BacktestMetrics | null;
  failureReason: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StockStats {
  symbol: string;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  week52High: number | null;
  week52Low: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  peRatio: number | null;
  priceToBook: number | null;
  asOf: string;
}

export interface PlanFeatureRow {
  feature: string;
  free: string | boolean;
  basic: string | boolean;
  premium: string | boolean;
}

export const PLAN_FEATURES: PlanFeatureRow[] = [
  { feature: "Data delay", free: "15 min", basic: "Realtime*", premium: "Realtime*" },
  { feature: "Scan filters", free: "5", basic: "Unlimited", premium: "Unlimited" },
  { feature: "AI signal engine", free: false, basic: false, premium: true },
  { feature: "Backtest / OddsMaker", free: false, basic: "Limited", premium: "Unlimited" },
  { feature: "Simulation account", free: true, basic: true, premium: true },
  { feature: "One-click trade", free: false, basic: true, premium: true },
  { feature: "Full auto trade", free: false, basic: false, premium: "With risk approval" },
  { feature: "Broker integration", free: false, basic: true, premium: true },
];
