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
  /** Override default request timeout (ms). */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Per-route budgets. Long work must return quickly (job id) or be listed here —
 * never fall through to a surprise client abort.
 */
function timeoutForPath(path: string): number | undefined {
  if (path.includes("/backtest/run")) return 20_000;
  if (path.includes("/backtest/jobs/")) return 15_000;
  if (path.includes("/backtest/")) return 20_000;
  if (path.includes("/models/generate-signals")) return 20_000;
  if (path.includes("/models/resolve-signals")) return 30_000;
  if (path.includes("/models/lifecycle/run")) return 60_000;
  if (path.includes("/models/portfolio/retrain")) return 30_000;
  if (path.includes("/models/retrain")) return 30_000;
  if (path.includes("/models")) return 25_000;
  if (path.includes("/scans/") && path.includes("/run")) return 35_000;
  if (path.includes("/scans/pulse")) return 25_000;
  if (path.includes("/scans")) return 20_000;
  if (path.includes("/market-data")) return 25_000;
  if (path.includes("/broker")) return 25_000;
  if (path.includes("/simulation")) return 20_000;
  if (path.includes("/auth/")) return 20_000;
  if (path.includes("/users/")) return 20_000;
  if (path.includes("/signals")) return 20_000;
  if (path.includes("/watchlists")) return 20_000;
  if (path.includes("/billing")) return 25_000;
  if (path.includes("/execution")) return 20_000;
  return undefined;
}

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

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  const msg = err.message || "";
  return (
    msg === "Failed to fetch" ||
    msg === "Load failed" ||
    msg === "NetworkError when attempting to fetch resource." ||
    /networkerror|load failed|failed to fetch|econnreset|etimedout/i.test(msg)
  );
}

async function requestOnce<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    signal,
    timeoutMs = timeoutForPath(path) ?? DEFAULT_TIMEOUT_MS,
  } = options;
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        `İstek zaman aşımına uğradı (${Math.round(timeoutMs / 1000)}s). Sayfayı yenileyip tekrar deneyin.`,
        408,
      );
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

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
    let message = `Request failed (${res.status})`;
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      const raw = (parsed as { message: unknown }).message;
      if (typeof raw === "string") message = raw;
      else if (Array.isArray(raw)) message = raw.map(String).join("; ");
    }
    // Never surface opaque Nest "Internal server error" without context.
    if (res.status >= 500 && (!message || /internal server error/i.test(message))) {
      message = `Sunucu hatası (${res.status}). Birkaç saniye sonra tekrar deneyin.`;
    }
    throw new ApiError(message, res.status, parsed);
  }

  return parsed as T;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  try {
    return await requestOnce<T>(path, options);
  } catch (err) {
    // One automatic retry for transient GET/network blips (not timeouts).
    if (method === "GET" && isTransientNetworkError(err)) {
      await new Promise((r) => setTimeout(r, 500));
      return requestOnce<T>(path, options);
    }
    throw err;
  }
}

/** Safari uses "Load failed"; Chrome "Failed to fetch" — both mean network/API down. */
export function networkErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  if (
    raw === "Failed to fetch" ||
    raw === "Load failed" ||
    raw === "NetworkError when attempting to fetch resource." ||
    /networkerror|load failed|failed to fetch/i.test(raw)
  ) {
    return "API’ye bağlanılamadı — sayfayı yenileyin. Sorun sürerse sunucu kısa süreliğine kapalı olabilir.";
  }
  return raw || fallback;
}

export const apiClient = {
  register: (email: string, password: string) =>
    request<{ id: string; email: string }>("/auth/register", {
      method: "POST",
      body: { email, password },
    }),

  login: (email: string, password: string, rememberMe = true) =>
    request<{
      accessToken: string;
      refreshToken?: string;
      user: {
        id: string;
        email: string;
        executionMode: string;
        planTier: string;
        killSwitchActive: boolean;
      };
    }>("/auth/login", {
      method: "POST",
      body: { email, password, rememberMe },
    }),

  googleLogin: (idToken: string, rememberMe = true) =>
    request<{
      accessToken: string;
      refreshToken?: string;
      user: {
        id: string;
        email: string;
        executionMode: string;
        planTier: string;
        killSwitchActive: boolean;
      };
    }>("/auth/google", {
      method: "POST",
      body: { idToken, rememberMe },
    }),

  refresh: (refreshToken: string) =>
    request<{
      accessToken: string;
      refreshToken?: string;
      user?: {
        id: string;
        email: string;
        executionMode: string;
        planTier: string;
        killSwitchActive: boolean;
      };
    }>("/auth/refresh", {
      method: "POST",
      body: { refreshToken },
      timeoutMs: 8_000,
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
        strategyId?: string | null;
        isActive: boolean;
        status: "shadow" | "active" | "rejected" | "archived";
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
    }>("/models", { token, timeoutMs: 20_000 }),

  scanPulse: (token: string, limit = 40) =>
    request<{
      rows: ScanRow[];
      scannedSymbols: number;
      totalSymbols: number;
    }>(`/scans/pulse?limit=${limit}`, { token, timeoutMs: 20_000 }),

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

  generateSignals: async (token: string) => {
    type GenerateResult = {
      status?: "running" | "done" | "error";
      jobId?: string;
      predictions?: number;
      signalsCreated?: number;
      shadowPredictions?: number;
      shadowEvaluations?: number;
      error?: string;
      elapsedMs?: number;
    };

    // Start returns in milliseconds; work continues on the API.
    const started = await request<GenerateResult>("/models/generate-signals", {
      method: "POST",
      token,
      timeoutMs: 20_000,
    });

    if (
      started.status === "done" ||
      (typeof started.predictions === "number" && !started.jobId)
    ) {
      return started;
    }

    if (!started.jobId) {
      throw new ApiError("Signal generation did not return a job id", 500);
    }

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const job = await request<GenerateResult>(
        `/models/generate-signals/jobs/${encodeURIComponent(started.jobId)}`,
        { token, timeoutMs: 15_000 },
      );
      if (job.status === "done") return job;
      if (job.status === "error") {
        throw new ApiError(job.error || "Signal generation failed", 500);
      }
    }
    throw new ApiError("Signal generation timed out after 180000ms", 408);
  },

  resolveSignals: (token: string) =>
    request<{
      queued?: boolean;
      jobId?: string;
      resolved?: number;
      shadowResolved?: number;
    }>("/models/resolve-signals", {
      method: "POST",
      token,
      timeoutMs: 20_000,
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
        killSwitchReason?: string | null;
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

  runScan: (
    token: string,
    scanId: string,
    opts?: { limit?: number; offset?: number; timeoutMs?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<{
      scanId: string;
      rows: ScanRow[];
      scannedSymbols?: number;
      batchSize?: number;
      totalSymbols?: number;
      offset?: number;
      limit?: number;
      hasMore?: boolean;
      nextOffset?: number | null;
    }>(`/scans/${scanId}/run${qs ? `?${qs}` : ""}`, {
      method: "POST",
      token,
      timeoutMs: opts?.timeoutMs ?? 25_000,
    });
  },

  signals: (token: string, status: SignalStatus | "all" = "open") =>
    request<Signal[]>(`/signals?status=${encodeURIComponent(status)}`, { token }),

  signalSummary: (token: string) =>
    request<SignalSummary>("/signals/summary", { token }),

  runBacktest: async (
    token: string,
    payload: {
      symbol: string;
      strategyId: string;
      params?: Record<string, number | boolean>;
    },
  ) => {
    type Job = {
      status?: "running" | "done" | "error";
      jobId?: string;
      result?: BacktestMetrics;
      error?: string;
    } & Partial<BacktestMetrics>;

    const started = await request<Job>("/backtest/run", {
      method: "POST",
      token,
      body: payload,
      timeoutMs: 20_000,
    });

    // Legacy sync response (metrics directly on body).
    if (started.runId && started.equityCurve) {
      return started as BacktestMetrics;
    }
    if (started.status === "done" && started.result) {
      return started.result;
    }
    if (!started.jobId) {
      throw new ApiError("Backtest did not return a job id", 500);
    }

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      const job = await request<Job>(
        `/backtest/jobs/${encodeURIComponent(started.jobId)}`,
        { token, timeoutMs: 15_000 },
      );
      if (job.status === "done" && job.result) return job.result;
      if (job.status === "error") {
        throw new ApiError(job.error || "Backtest failed", 500);
      }
    }
    throw new ApiError("Backtest timed out", 408);
  },

  backtestRuns: (token: string) =>
    request<BacktestRun[]>("/backtest/runs", { token, timeoutMs: 20_000 }),

  backtestStrategies: (token: string) =>
    request<BacktestStrategy[]>("/backtest/strategies", {
      token,
      timeoutMs: 20_000,
    }),

  backtestQuota: (token: string) =>
    request<{
      limit: number | null;
      used: number;
      remaining: number | null;
      periodStart: string;
      periodEnd: string;
    }>("/backtest/quota", { token, timeoutMs: 15_000 }),

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
    request<{ executionMode: string; killSwitchActive?: boolean }>("/execution/mode", {
      method: "POST",
      token,
      body: { mode, riskAcknowledged },
    }),

  killSwitch: (token: string, active: boolean) =>
    active
      ? request<{ killSwitchActive: boolean; executionMode?: string }>(
          "/execution/kill-switch",
          {
            method: "POST",
            token,
            body: { reason: "manual" },
          },
        )
      : request<{ killSwitchActive: boolean; executionMode?: string }>(
          "/execution/kill-switch",
          {
            method: "DELETE",
            token,
          },
        ),

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

  getMarketSymbols: (token: string, q?: string) => {
    const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    return request<MarketSymbol[]>(`/market-data/symbols${query}`, { token });
  },
};
