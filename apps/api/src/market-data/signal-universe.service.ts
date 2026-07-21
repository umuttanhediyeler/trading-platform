import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_SIGNAL_UNIVERSE_SIZE,
  UNIVERSE,
  mergeUniverseWithWatchlists,
} from './universe';

type SymbolScore = { symbol: string; score: number };

/**
 * Builds the intraday ML signal universe dynamically:
 * 1) All watchlist symbols (user lists take priority)
 * 2) Full curated large-cap universe
 * 3) Recent best-performing signal symbols (30d hit rate × avg return)
 */
@Injectable()
export class SignalUniverseService {
  constructor(private readonly prisma: PrismaService) {}

  async build(): Promise<string[]> {
    const watchlistRows = await this.prisma.watchlist.findMany({
      select: { symbols: true },
    });
    const watchlistSymbols = watchlistRows.flatMap((row) =>
      row.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean),
    );

    const performanceScores = await this.loadPerformanceScores();
    const scoreBySymbol = new Map(
      performanceScores.map((row) => [row.symbol, row.score]),
    );

    const rankedBase = [...UNIVERSE].sort((a, b) => {
      const sa = scoreBySymbol.get(a) ?? 0;
      const sb = scoreBySymbol.get(b) ?? 0;
      return sb - sa;
    });

    const merged = mergeUniverseWithWatchlists(
      rankedBase,
      watchlistSymbols,
      MAX_SIGNAL_UNIVERSE_SIZE,
    );

    // Re-sort tail (non-watchlist slice) by profitability score.
    const watchSet = new Set(watchlistSymbols);
    const head = merged.filter((s) => watchSet.has(s));
    const tail = merged
      .filter((s) => !watchSet.has(s))
      .sort((a, b) => (scoreBySymbol.get(b) ?? 0) - (scoreBySymbol.get(a) ?? 0));

    return [...head, ...tail].slice(0, MAX_SIGNAL_UNIVERSE_SIZE);
  }

  private async loadPerformanceScores(): Promise<SymbolScore[]> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.signal.findMany({
      where: {
        status: { in: ['hit_target', 'hit_stop'] },
        resolvedAt: { gte: since },
      },
      select: {
        symbol: true,
        status: true,
        realizedReturn: true,
      },
      take: 2000,
    });

    const bySymbol = new Map<
      string,
      { wins: number; total: number; returnSum: number }
    >();
    for (const row of rows) {
      const bucket = bySymbol.get(row.symbol) ?? {
        wins: 0,
        total: 0,
        returnSum: 0,
      };
      bucket.total += 1;
      if (row.status === 'hit_target') bucket.wins += 1;
      if (row.realizedReturn != null) bucket.returnSum += row.realizedReturn;
      bySymbol.set(row.symbol, bucket);
    }

    return [...bySymbol.entries()].map(([symbol, stats]) => {
      const winRate = stats.total > 0 ? stats.wins / stats.total : 0;
      const avgReturn =
        stats.total > 0 ? stats.returnSum / stats.total : 0;
      return {
        symbol,
        score: winRate * 2 + Math.max(0, avgReturn) * 10,
      };
    });
  }
}
