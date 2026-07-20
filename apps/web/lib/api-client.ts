import type {
  BacktestMetrics,
  BacktestRun,
  BacktestStrategy,
  BrokerName,
  BrokerOrderLedgerEntry,
  BrokerProvider,
  BrokerReconcileResult,
  FilterDSL,
  RiskSettings,
  ScanDefinition,
  ScanRow,
  ScanTemplate,
  Signal,
  SignalStatus,
  SignalSummary,
  SimulationAccount,
  StockStats,
  Watchlist,
} from "./types";

export interface MarketSymbol {
  symbol: string;
  name: string;
  sector?: string;
  exchange?: string;
  inWatchlist: boolean;
  inUniverse?: boolean;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
};

function getBaseUrl() {
  // Absolute API origin from env (e.g. http://localhost:3001 locally,
  // https://<api>.koyeb.app in production). INTERNAL_API_URL is an optional
  // server-only override for SSR/NextAuth when it must differ from the public URL.
  if (typeof window === "undefined") {
    return (
      process.env.INTERNAL_API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:3001"
    );
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, parsed);
  }

  return parsed as T;
}

export const apiClient = {
  register: (email: string, password: string) =>
    request<{ id: string; email: string }>("/auth/register", {
      method: "POST",
      body: { email, password },
    }),

  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken?: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  googleLogin: (idToken: string) =>
    request<{ accessToken: string; refreshToken?: string }>("/auth/google", {
      method: "POST",
      body: { idToken },
    }),

  refresh: (refreshToken: string) =>
    request<{ accessToken: string; refreshToken?: string }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    }),

  listModels: (token: string) =>
    request<{
      soakGates: { minSoakHours: number; minShadowSamples: number };
      models: Array<{
        version: string;
        trainedAt?: string;
        precision: number;
        recall: number;
        expectancy: number;
        maxDrawdown: number;
        regime: string;
        isActive: boolean;
        status: "shadow" | "active" | "rejected";
        artifactPath?: string | null;
        artifactSha256?: string | null;
        trainingSamples?: number | null;
        promotedAt?: string | null;
        promotionReason?: string | null;
        shadowStartedAt?: string | null;
        latestPerformance?: {
          calculatedAt: string;
          sampleSize: number;
          wins: number;
          losses: number;
          expired: number;
          hitRate: number | null;
          averageReturn: number | null;
        } | null;
        shadowSoak?: {
          soakStartedAt: string;
          soakAgeHours: number;
          openEvaluations: number;
          resolvedSamples: number;
          hitRate: number | null;
          averageReturn: number | null;
          soakAgeSatisfied: boolean;
          samplesSatisfied: boolean;
        } | null;
      }>;
      performance: {
        openSignals: number;
        resolved: number;
        hitTarget: number;
        hitStop: number;
        hitRate: number | null;
        calibration: {
          sampleSize: number;
          brierScore: number | null;
        };
        drift: {
          sampleSize: number;
          score: number | null;
          level: "insufficient_data" | "stable" | "watch" | "alert";
        };
      };
      timeline: Array<{
        modelVersion: string;
        calculatedAt: string;
        expectedReturn: number;
        actualReturn: number | null;
        hitRate: number | null;
        sampleSize: number;
        regime: string;
        isChampion: boolean;
      }>;
    }>("/models", { token }),

  promoteModel: (token: string, version: string) =>
    request<{
      version: string;
      isActive: boolean;
      promoted: boolean;
      gateFailures: string[];
    }>(
      `/models/${encodeURIComponent(version)}/promote`,
      { method: "POST", token },
    ),

  generateSignals: (token: string) =>
    request<{
      predictions: number;
      signalsCreated: number;
      shadowPredictions: number;
      shadowEvaluations: number;
    }>("/models/generate-signals", {
      method: "POST",
      token,
    }),

  resolveSignals: (token: string) =>
    request<{ resolved: number; shadowResolved: number }>("/models/resolve-signals", {
      method: "POST",
      token,
    }),

  runModelLifecycle: (token: string) =>
    request<{
      promotions: Array<{ version: string; regime: string; reason: string }>;
      rollbacks: Array<{ version: string; regime: string; reason: string }>;
      holds: Array<{ version: string; regime: string; reason: string }>;
      retrains: string[];
      drift: { score: number | null; level: string };
    }>("/models/lifecycle/run", {
      method: "POST",
      token,
    }),

  me: (token: string) =>
    request<{
      id: string;
      email: string;
      createdAt: string;
      executionMode: string;
      plan: { tier: string; status: string; currentPeriodEnd: string | null };
      riskSettings: {
        maxDailyTrades: number;
        maxDailyLossPercent: number;
        maxRiskPerTrade: number;
        killSwitchActive: boolean;
      } | null;
      broker: {
        broker: BrokerName;
        mode: "paper" | "live";
        connectedAt: string;
      } | null;
    }>("/users/me", { token }),

  checkout: (token: string, planTier: "basic" | "premium") =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      token,
      body: { planTier },
    }),

  portal: (token: string) =>
    request<{ url: string }>("/billing/portal", { method: "POST", token }),

  listScans: (token: string) =>
    request<ScanDefinition[]>("/scans", { token }),

  scanTemplates: (token: string) =>
    request<ScanTemplate[]>("/scans/templates", { token }),

  createScan: (token: string, name: string, filterDSL: FilterDSL) =>
    request<ScanDefinition>("/scans", {
      method: "POST",
      token,
      body: { name, filterDSL },
    }),

  updateScan: (token: string, id: string, name: string, filterDSL: FilterDSL) =>
    request<ScanDefinition>(`/scans/${id}`, {
      method: "PUT",
      token,
      body: { name, filterDSL },
    }),

  deleteScan: (token: string, id: string) =>
    request<{ deleted: boolean }>(`/scans/${id}`, {
      method: "DELETE",
      token,
    }),

  runScan: (token: string, scanId: string) =>
    request<{ scanId: string; rows: ScanRow[] }>(`/scans/${scanId}/run`, {
      method: "POST",
      token,
    }),

  signals: (token: string, status: SignalStatus | "all" = "open") =>
    request<Signal[]>(`/signals?status=${encodeURIComponent(status)}`, { token }),

  signalSummary: (token: string) =>
    request<SignalSummary>("/signals/summary", { token }),

  runBacktest: (
    token: string,
    payload: {
      symbol: string;
      strategyId: string;
      params?: Record<string, number | boolean>;
    },
  ) =>
    request<BacktestMetrics>("/backtest/run", {
      method: "POST",
      token,
      body: payload,
    }),

  backtestRuns: (token: string) =>
    request<BacktestRun[]>("/backtest/runs", { token }),

  backtestStrategies: (token: string) =>
    request<BacktestStrategy[]>("/backtest/strategies", { token }),

  backtestQuota: (token: string) =>
    request<{
      limit: number | null;
      used: number;
      remaining: number | null;
      periodStart: string;
      periodEnd: string;
    }>("/backtest/quota", { token }),

  simulationAccount: (token: string) =>
    request<SimulationAccount>("/simulation/account", { token }),

  placeSimOrder: (
    token: string,
    payload: {
      symbol: string;
      side: "buy" | "sell";
      quantity: number;
      stopPrice: number;
      targetPrice: number;
    },
  ) =>
    request<{ id: string }>("/simulation/orders", {
      method: "POST",
      token,
      body: payload,
    }),

  closeSimOrder: (token: string, orderId: string, exitPrice: number) =>
    request<{ id: string }>(`/simulation/orders/${orderId}/close`, {
      method: "POST",
      token,
      body: { exitPrice },
    }),

  setExecutionMode: (
    token: string,
    mode: "manual" | "one_click" | "full_auto",
    riskAcknowledged?: boolean,
  ) =>
    request<{ executionMode: string }>("/execution/mode", {
      method: "POST",
      token,
      body: { mode, riskAcknowledged },
    }),

  killSwitch: (token: string, active: boolean) =>
    active
      ? request<{ killSwitchActive: boolean }>("/execution/kill-switch", {
          method: "POST",
          token,
          body: { reason: "manual" },
        })
      : request<{ killSwitchActive: boolean }>("/execution/kill-switch", {
          method: "DELETE",
          token,
        }),

  updateRisk: (token: string, settings: Partial<RiskSettings>) =>
    request<RiskSettings>("/users/me/risk", {
      method: "PUT",
      token,
      body: {
        maxDailyTrades: settings.maxDailyTrades,
        maxDailyLossPercent: settings.maxDailyLossPercent,
        maxRiskPerTrade: settings.maxRiskPerTrade,
      },
    }),

  listWatchlists: (token: string) =>
    request<Watchlist[]>("/watchlists", { token }),

  createWatchlist: (token: string, name: string, symbols: string[]) =>
    request<Watchlist>("/watchlists", {
      method: "POST",
      token,
      body: { name, symbols },
    }),

  updateWatchlist: (
    token: string,
    id: string,
    payload: { name: string; symbols: string[] },
  ) =>
    request<Watchlist>(`/watchlists/${id}`, {
      method: "PUT",
      token,
      body: payload,
    }),

  deleteWatchlist: (token: string, id: string) =>
    request<{ deleted: boolean }>(`/watchlists/${id}`, {
      method: "DELETE",
      token,
    }),

  connectBroker: (
    token: string,
    payload: {
      broker: BrokerName;
      apiKey: string;
      apiSecret: string;
      mode: "paper" | "live";
    },
  ) =>
    request<{ broker: BrokerName; mode: "paper" | "live"; connectedAt: string }>(
      "/broker/connect",
      {
      method: "POST",
      token,
      body: payload,
      },
    ),

  brokerProviders: (token: string) =>
    request<BrokerProvider[]>("/broker/providers", { token }),

  brokerPositions: (token: string) =>
    request<Array<{ symbol: string; qty: number; marketValue: number }>>(
      "/broker/positions",
      { token },
    ),

  brokerOrders: (token: string) =>
    request<BrokerOrderLedgerEntry[]>("/broker/orders", { token }),

  reconcileBrokerOrders: (token: string) =>
    request<BrokerReconcileResult>("/broker/orders/reconcile", {
      method: "POST",
      token,
    }),

  placeBrokerOrder: (
    token: string,
    payload: {
      symbol: string;
      side: "buy" | "sell";
      quantity: number;
      type: "market" | "limit";
      limitPrice?: number;
      clientOrderId: string;
    },
  ) =>
    request<{
      id: string;
      clientOrderId: string;
      symbol: string;
      side: string;
      quantity: number;
      status: string;
      filledQty?: number;
      filledAvgPrice?: number | null;
    }>("/broker/orders", { method: "POST", token, body: payload }),

  getBars: (
    token: string,
    symbol: string,
    options: { timeframe?: "1min" | "5min" | "15min" | "1h" | "1d"; days?: number } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (options.timeframe) params.set("timeframe", options.timeframe);
    if (options.days) params.set("days", String(options.days));
    const qs = params.toString();
    return request<{
      symbol: string;
      timeframe: string;
      provider: string;
      bars: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>;
    }>(`/market-data/bars/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ""}`, {
      token,
      signal,
    });
  },

  getQuote: (token: string, symbol: string) =>
    request<{
      symbol: string;
      price: number;
      volume: number;
      ts: number;
      stale: boolean;
      source: string;
    }>(`/market-data/quote/${encodeURIComponent(symbol)}`, { token }),

  getStockStats: (token: string, symbol: string) =>
    request<StockStats>(`/market-data/stats/${encodeURIComponent(symbol)}`, {
      token,
    }),

  getMarketSymbols: (token: string) =>
    request<MarketSymbol[]>("/market-data/symbols", { token }),
};
