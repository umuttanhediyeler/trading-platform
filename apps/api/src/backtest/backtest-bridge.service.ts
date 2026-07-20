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
    const res = await fetch(`${this.baseUrl}/backtest/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        bars: bars.map((bar) => ({
          timestamp: bar.timestamp.toISOString(),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        })),
        strategy,
        initial_cash: Number(request.params?.initialCash ?? 100_000),
        commission_pct: Number(request.params?.commissionPct ?? 0.001),
        slippage_pct: Number(request.params?.slippagePct ?? 0.0005),
      }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Backtest service failed: ${res.status}`,
      );
    }
    const raw = await res.json();
    const metrics = raw.metrics ?? {};
    const equityCurve: Array<{ ts: string; equity: number }> = (
      raw.equity_curve ?? []
    ).map((equity: number, index: number) => ({
      ts: raw.timestamps?.[index] ?? String(index),
      equity,
    }));
    const stored = {
      totalReturn: Number(metrics.total_return ?? 0) * 100,
      sharpe: Number(metrics.sharpe_ratio ?? 0),
      maxDrawdown: -Number(metrics.max_drawdown ?? 0) * 100,
      winRate: Number(metrics.win_rate ?? 0) * 100,
      expectancy: Number(metrics.expectancy ?? 0),
      profitFactor: Number(metrics.profit_factor ?? 0),
    };
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
      numTrades: Number(metrics.num_trades ?? 0),
      equityCurve,
    };
  }

  async listStrategies(): Promise<StrategyCatalogItem[]> {
    const res = await fetch(`${this.baseUrl}/strategies`);
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Backtest service failed: ${res.status}`,
      );
    }
    return (await res.json()) as StrategyCatalogItem[];
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
}
