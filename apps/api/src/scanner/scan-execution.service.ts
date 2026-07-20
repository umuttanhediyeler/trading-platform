import { Injectable, Logger } from '@nestjs/common';
import type { ScanRow } from '@trading-platform/shared-types';
import { lastCloseChangePercent } from '@trading-platform/data';
import { DailyBarsService } from '../market-data/daily-bars.service';
import { SCAN_UNIVERSE } from '../market-data/scan-universe';
import { FilterGroup, computeFields, evaluateDSL } from './filters/filter.types';

export interface ScanExecutionResult {
  rows: ScanRow[];
  /** Symbols for which usable bar data was available. */
  scannedSymbols: number;
  /** Size of the requested universe. */
  totalSymbols: number;
}

/**
 * Executes a saved scan's filter DSL against the full scan universe.
 *
 * Bars are loaded in bulk (DB-first, provider fallback) via
 * {@link DailyBarsService}; the evaluation itself is pure, synchronous math,
 * so scaling the universe from ~100 to 500+ symbols costs one SQL query plus
 * a handful of rate-limited provider requests — not N concurrent HTTP calls.
 */
@Injectable()
export class ScanExecutionService {
  private readonly logger = new Logger(ScanExecutionService.name);

  constructor(private readonly dailyBars: DailyBarsService) {}

  async execute(
    dsl: FilterGroup,
    symbols: readonly string[] = SCAN_UNIVERSE,
  ): Promise<ScanExecutionResult> {
    const started = Date.now();
    const barsBySymbol = await this.dailyBars.getLatestDailyBars(symbols);

    const rows: ScanRow[] = [];
    let scannedSymbols = 0;
    const matchedAt = new Date().toISOString();

    for (const symbol of symbols) {
      const bars = barsBySymbol.get(symbol);
      if (!bars || bars.length === 0) continue;
      scannedSymbols += 1;

      const values = computeFields(bars);
      if (!evaluateDSL(dsl, values)) continue;

      const last = bars[bars.length - 1];
      rows.push({
        symbol,
        price: last.close,
        changePercent: lastCloseChangePercent(bars),
        volume: last.volume,
        volumeRatio: Number(values.volume_ratio ?? 0),
        rsi14: Number(values.rsi_14 ?? 50),
        gapPercent: Number(values.gap_percent ?? 0),
        priceVsVwap: Number(values.price_vs_vwap ?? 0),
        values,
        matchedAt,
      });
    }

    // Deterministic ordering: strongest volume spike first, symbol tie-break.
    rows.sort(
      (a, b) => b.volumeRatio - a.volumeRatio || a.symbol.localeCompare(b.symbol),
    );

    this.logger.log(
      `Scan evaluated ${scannedSymbols}/${symbols.length} symbols, ${rows.length} matches in ${Date.now() - started}ms`,
    );
    return { rows, scannedSymbols, totalSymbols: symbols.length };
  }
}
