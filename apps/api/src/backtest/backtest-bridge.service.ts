import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
} from '../market-data/providers/market-data-provider.interface';
import { PrismaService } from '../prisma/prisma.service';

export interface BacktestRequest {
  strategyId: string;
  symbol: string;
  from?: string; // ISO date
  to?: string; // ISO date
  params?: Record<string, unknown>;
}

export interface BacktestResult {
  runId: string;
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  numTrades: number;
  equityCurve: Array<{ ts: string; equity: number }>;
}

export interface StrategyCatalogItem {
  id: string;
  name: string;
  description: string;
  category: 'trend-following' | 'mean-reversion' | 'breakout';
  params: Array<{
    name: string;
    label: string;
    type: 'number' | 'boolean';
    default: number | boolean;
    min?: number;
    max?: number;
  }>;
}

/** HTTP proxy to the Python backtest service (packages/backtest, FastAPI). */
@Injectable()
export class BacktestBridgeService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(MARKET_DATA_PROVIDER)
    private readonly marketData: MarketDataProvider,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('BACKTEST_SERVICE_URL', 'http://localhost:8002');
  }

  async run(userId: string, request: BacktestRequest): Promise<BacktestResult> {
    const symbol = request.symbol.toUpperCase();
    const to = request.to
      ? new Date(request.to)
      : new Date(Date.now() - 16 * 60_000);
    const from = request.from
      ? new Date(request.from)
      : new Date(to.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
    const bars = await this.marketData.getHistoricalBars(
      symbol,
      '1d',
      from,
      to,
    );
    if (bars.length < 60) {
      throw new BadRequestException(
        `Backtest requires at least 60 daily bars; received ${bars.length}`,
      );
    }

    const strategy = this.strategySpec(request.strategyId, request.params);
    const initialCash = Number(request.params?.initialCash ?? 100_000);
    let stored = { totalReturn: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, expectancy: 0, profitFactor: 0 };
    let equityCurve: Array<{ ts: string; equity: number }> = [];
    let numTrades = 0;

    let usedPython = false;
    try {
      const res = await fetch(`${this.baseUrl}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          symbol,
          bars: bars.map((bar) => ({
            timestamp: bar.timestamp.toISOString(),
            open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
          })),
          strategy,
          initial_cash: initialCash,
          commission_pct: Number(request.params?.commissionPct ?? 0.001),
          slippage_pct: Number(request.params?.slippagePct ?? 0.0005),
        }),
      });
      if (res.ok) {
        usedPython = true;
        const raw = await res.json();
        const m = raw.metrics ?? {};
        equityCurve = (raw.equity_curve ?? []).map((equity: number, index: number) => ({
          ts: raw.timestamps?.[index] ?? String(index),
          equity,
        }));
        stored = {
          totalReturn: Number(m.total_return ?? 0) * 100,
          sharpe: Number(m.sharpe_ratio ?? 0),
          maxDrawdown: -Number(m.max_drawdown ?? 0) * 100,
          winRate: Number(m.win_rate ?? 0) * 100,
          expectancy: Number(m.expectancy ?? 0),
          profitFactor: Number(m.profit_factor ?? 0),
        };
        numTrades = Number(m.num_trades ?? 0);
      }
    } catch {
      // Python service unreachable — use built-in engine
    }

    if (!usedPython) {
      const result = this.runBuiltIn(bars, strategy, initialCash);
      stored = result.metrics;
      equityCurve = result.equityCurve;
      numTrades = result.numTrades;
    }
    const run = await this.prisma.backtestRun.create({
      data: {
        userId,
        symbol,
        strategyId: request.strategyId,
        params: (request.params ?? {}) as Prisma.InputJsonValue,
        periodFrom: from,
        periodTo: to,
        barCount: bars.length,
        ...stored,
        equityCurve: equityCurve as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      runId: run.id,
      ...stored,
      numTrades,
      equityCurve,
    };
  }

  async listStrategies(): Promise<StrategyCatalogItem[]> {
    try {
      const res = await fetch(`${this.baseUrl}/strategies`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return (await res.json()) as StrategyCatalogItem[];
    } catch {
      // Python backtest service unreachable — return built-in catalog.
    }
    return this.builtInStrategies();
  }

  private builtInStrategies(): StrategyCatalogItem[] {
    return [
      {
        id: 'sma_cross',
        name: 'SMA Crossover',
        description: 'Hızlı ve yavaş basit hareketli ortalama kesişimi ile alım/satım.',
        category: 'trend-following',
        params: [
          { name: 'fast', label: 'Hızlı Periyot', type: 'number', default: 10, min: 2, max: 100 },
          { name: 'slow', label: 'Yavaş Periyot', type: 'number', default: 30, min: 5, max: 200 },
          { name: 'allow_short', label: 'Açığa Satış', type: 'boolean', default: false },
        ],
      },
      {
        id: 'macd_cross',
        name: 'MACD Cross',
        description: 'MACD ve sinyal hattı kesişimi ile trend takibi.',
        category: 'trend-following',
        params: [
          { name: 'fast', label: 'Hızlı EMA', type: 'number', default: 12, min: 2, max: 50 },
          { name: 'slow', label: 'Yavaş EMA', type: 'number', default: 26, min: 5, max: 100 },
          { name: 'signal_period', label: 'Sinyal Periyodu', type: 'number', default: 9, min: 2, max: 30 },
          { name: 'allow_short', label: 'Açığa Satış', type: 'boolean', default: false },
        ],
      },
      {
        id: 'rsi_reversal',
        name: 'RSI Reversal',
        description: 'RSI aşırı alım/satım bölgelerinden dönüş.',
        category: 'mean-reversion',
        params: [
          { name: 'rsi_period', label: 'RSI Periyodu', type: 'number', default: 14, min: 2, max: 50 },
          { name: 'rsi_buy_below', label: 'Alım Eşiği', type: 'number', default: 30, min: 5, max: 50 },
          { name: 'rsi_sell_above', label: 'Satım Eşiği', type: 'number', default: 70, min: 50, max: 95 },
        ],
      },
      {
        id: 'bollinger_revert',
        name: 'Bollinger Reversion',
        description: 'Bollinger bantlarından ortalamaya dönüş stratejisi.',
        category: 'mean-reversion',
        params: [
          { name: 'period', label: 'Periyot', type: 'number', default: 20, min: 5, max: 100 },
          { name: 'num_std', label: 'Standart Sapma', type: 'number', default: 2, min: 1, max: 4 },
        ],
      },
      {
        id: 'donchian_breakout',
        name: 'Donchian Breakout',
        description: 'Donchian kanal kırılımı ile pozisyon açma.',
        category: 'breakout',
        params: [
          { name: 'breakout_period', label: 'Kırılım Periyodu', type: 'number', default: 20, min: 5, max: 100 },
          { name: 'exit_period', label: 'Çıkış Periyodu', type: 'number', default: 10, min: 3, max: 50 },
          { name: 'allow_short', label: 'Açığa Satış', type: 'boolean', default: false },
        ],
      },
    ];
  }

  async listRuns(userId: string) {
    const rows = await this.prisma.backtestRun.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      strategyId: row.strategyId,
      status: 'completed' as const,
      metrics: {
        runId: row.id,
        totalReturn: row.totalReturn,
        sharpe: row.sharpe,
        maxDrawdown: row.maxDrawdown,
        winRate: row.winRate,
        expectancy: row.expectancy,
        profitFactor: row.profitFactor,
        numTrades: 0,
      },
      failureReason: null,
      durationMs: null,
      createdAt: row.createdAt,
      completedAt: row.createdAt,
    }));
  }

  private strategySpec(
    strategyId: string,
    params: Record<string, unknown> = {},
  ) {
    if (strategyId === 'rsi_reversal') {
      return {
        name: 'rsi_reversal',
        rsi_period: Number(params.rsi_period ?? 14),
        rsi_buy_below: Number(params.rsi_buy_below ?? 30),
        rsi_sell_above: Number(params.rsi_sell_above ?? 70),
      };
    }
    if (strategyId === 'macd_cross') {
      return {
        name: 'macd_cross',
        fast: Number(params.fast ?? 12),
        slow: Number(params.slow ?? 26),
        signal_period: Number(params.signal_period ?? 9),
        allow_short: Boolean(params.allow_short ?? false),
      };
    }
    if (strategyId === 'bollinger_revert') {
      return {
        name: 'bollinger_revert',
        period: Number(params.period ?? 20),
        num_std: Number(params.num_std ?? 2),
      };
    }
    if (strategyId === 'donchian_breakout') {
      return {
        name: 'donchian_breakout',
        breakout_period: Number(params.breakout_period ?? 20),
        exit_period: Number(params.exit_period ?? 10),
        allow_short: Boolean(params.allow_short ?? false),
      };
    }
    if (strategyId === 'sma_cross') {
      return {
        name: 'sma_cross',
        fast: Number(params.fast ?? 10),
        slow: Number(params.slow ?? 30),
        allow_short: Boolean(params.allow_short ?? false),
      };
    }
    throw new BadRequestException(`Unknown backtest strategy: ${strategyId}`);
  }

  private runBuiltIn(
    bars: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>,
    strategy: Record<string, unknown>,
    initialCash: number,
  ) {
    const closes = bars.map((b) => b.close);
    const signals = this.generateSignals(closes, strategy);
    let cash = initialCash;
    let position = 0;
    let entryPrice = 0;
    const trades: number[] = [];
    const equityCurve: Array<{ ts: string; equity: number }> = [];
    let peak = initialCash;
    let maxDd = 0;

    for (let i = 0; i < closes.length; i++) {
      const price = closes[i];
      const equity = cash + position * price;
      equityCurve.push({ ts: bars[i].timestamp.toISOString(), equity });
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDd) maxDd = dd;

      const sig = signals[i];
      if (sig === 1 && position === 0) {
        const qty = Math.floor(cash / price);
        if (qty > 0) { position = qty; entryPrice = price; cash -= qty * price; }
      } else if (sig === -1 && position > 0) {
        cash += position * price;
        trades.push((price - entryPrice) / entryPrice);
        position = 0;
      }
    }
    if (position > 0) {
      const last = closes[closes.length - 1];
      cash += position * last;
      trades.push((last - entryPrice) / entryPrice);
    }

    const finalEquity = cash;
    const totalReturn = ((finalEquity - initialCash) / initialCash) * 100;
    const wins = trades.filter((t) => t > 0);
    const losses = trades.filter((t) => t <= 0);
    const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;
    const expectancy = trades.length ? trades.reduce((a, b) => a + b, 0) / trades.length : 0;

    const returns = equityCurve.map((e, i) => i === 0 ? 0 : (e.equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    return {
      metrics: { totalReturn, sharpe, maxDrawdown: maxDd * 100, winRate, expectancy, profitFactor },
      equityCurve,
      numTrades: trades.length,
    };
  }

  private generateSignals(closes: number[], strategy: Record<string, unknown>): number[] {
    const n = closes.length;
    const signals = new Array(n).fill(0);
    const name = strategy.name as string;

    if (name === 'sma_cross') {
      const fast = Number(strategy.fast ?? 10);
      const slow = Number(strategy.slow ?? 30);
      for (let i = slow; i < n; i++) {
        const smaFast = closes.slice(i - fast, i).reduce((a, b) => a + b, 0) / fast;
        const smaSlow = closes.slice(i - slow, i).reduce((a, b) => a + b, 0) / slow;
        const prevFast = closes.slice(i - fast - 1, i - 1).reduce((a, b) => a + b, 0) / fast;
        const prevSlow = closes.slice(i - slow - 1, i - 1).reduce((a, b) => a + b, 0) / slow;
        if (prevFast <= prevSlow && smaFast > smaSlow) signals[i] = 1;
        else if (prevFast >= prevSlow && smaFast < smaSlow) signals[i] = -1;
      }
    } else if (name === 'rsi_reversal') {
      const period = Number(strategy.rsi_period ?? 14);
      const buyBelow = Number(strategy.rsi_buy_below ?? 30);
      const sellAbove = Number(strategy.rsi_sell_above ?? 70);
      const rsi = this.calcRSI(closes, period);
      for (let i = 1; i < n; i++) {
        if (rsi[i - 1] < buyBelow && rsi[i] >= buyBelow) signals[i] = 1;
        else if (rsi[i - 1] > sellAbove && rsi[i] <= sellAbove) signals[i] = -1;
      }
    } else if (name === 'bollinger_revert') {
      const period = Number(strategy.period ?? 20);
      const numStd = Number(strategy.num_std ?? 2);
      for (let i = period; i < n; i++) {
        const slice = closes.slice(i - period, i);
        const sma = slice.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(slice.reduce((a, v) => a + (v - sma) ** 2, 0) / period);
        const lower = sma - numStd * std;
        const upper = sma + numStd * std;
        if (closes[i] <= lower) signals[i] = 1;
        else if (closes[i] >= upper) signals[i] = -1;
      }
    } else if (name === 'macd_cross') {
      const fast = Number(strategy.fast ?? 12);
      const slow = Number(strategy.slow ?? 26);
      const sigPeriod = Number(strategy.signal_period ?? 9);
      const emaFast = this.calcEMA(closes, fast);
      const emaSlow = this.calcEMA(closes, slow);
      const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
      const signalLine = this.calcEMA(macdLine, sigPeriod);
      for (let i = 1; i < n; i++) {
        if (macdLine[i - 1] <= signalLine[i - 1] && macdLine[i] > signalLine[i]) signals[i] = 1;
        else if (macdLine[i - 1] >= signalLine[i - 1] && macdLine[i] < signalLine[i]) signals[i] = -1;
      }
    } else if (name === 'donchian_breakout') {
      const bp = Number(strategy.breakout_period ?? 20);
      const ep = Number(strategy.exit_period ?? 10);
      for (let i = bp; i < n; i++) {
        const high = Math.max(...closes.slice(i - bp, i));
        const low = Math.min(...closes.slice(i - ep, i));
        if (closes[i] >= high) signals[i] = 1;
        else if (closes[i] <= low) signals[i] = -1;
      }
    }
    return signals;
  }

  private calcRSI(closes: number[], period: number): number[] {
    const rsi = new Array(closes.length).fill(50);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period && i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) avgGain += d; else avgLoss -= d;
    }
    avgGain /= period; avgLoss /= period;
    for (let i = period; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
  }

  private calcEMA(data: number[], period: number): number[] {
    const ema = new Array(data.length).fill(0);
    const k = 2 / (period + 1);
    ema[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      ema[i] = data[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
  }
}
