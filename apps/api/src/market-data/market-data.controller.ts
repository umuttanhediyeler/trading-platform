import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
  StockStats,
  Timeframe,
} from './providers/market-data-provider.interface';
import { MarketAssetsService } from './market-assets.service';
import { QuoteCacheService } from './quote-cache.service';
import { SCAN_UNIVERSE } from './scan-universe';
import { UNIVERSE_INFO } from './universe';

const VALID_TIMEFRAMES: Timeframe[] = ['1min', '5min', '15min', '1h', '1d'];

/**
 * Read-only market data for the frontend (charts, tickers). Data comes from
 * the configured provider (Alpaca IEX by default) with the Redis quote cache
 * serving stale-but-flagged prices during provider outages.
 */
@Controller('market-data')
@UseGuards(JwtAuthGuard)
export class MarketDataController {
  constructor(
    @Inject(MARKET_DATA_PROVIDER)
    private readonly provider: MarketDataProvider,
    private readonly quoteCache: QuoteCacheService,
    private readonly prisma: PrismaService,
    private readonly marketAssets: MarketAssetsService,
  ) {}

  /**
   * Symbol picker catalog. Returns the curated scan universe (~500) by default
   * so watchlist UI stays fast. Optional `q` searches the full Alpaca asset
   * cache for tickers outside that set without shipping 10k+ rows every load.
   */
  @Get('symbols')
  async symbols(@Req() req: Request, @Query('q') q?: string) {
    const user = req.user as AuthenticatedUser;
    const watchlists = await this.prisma.watchlist.findMany({
      where: { userId: user.id },
      select: { symbols: true },
    });
    const watchlistSymbols = new Set(
      watchlists.flatMap(({ symbols }) =>
        symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
      ),
    );
    const universeBySymbol = new Map(
      UNIVERSE_INFO.map((info) => [info.symbol, info]),
    );
    const needle = q?.trim().toLowerCase() ?? '';

    // Warm Alpaca names in the background; never block the picker on a 10k dump.
    void this.marketAssets.getAssets().catch(() => undefined);

    let nameBySymbol = new Map<string, string>();
    let extraSymbols: string[] = [];
    if (needle) {
      const searched = await this.marketAssets.searchAssets(needle, 80);
      nameBySymbol = new Map(searched.map((a) => [a.symbol, a.name]));
      extraSymbols = searched.map((a) => a.symbol);
    } else {
      nameBySymbol = await this.marketAssets.getCachedNameMap();
    }

    const merged = new Set<string>([
      ...(needle ? extraSymbols : SCAN_UNIVERSE),
      ...watchlistSymbols,
      ...UNIVERSE_INFO.map((info) => info.symbol),
    ]);

    return [...merged]
      .sort((a, b) => a.localeCompare(b))
      .map((symbol) => {
        const universeInfo = universeBySymbol.get(symbol);
        return {
          symbol,
          name: nameBySymbol.get(symbol) ?? universeInfo?.name ?? symbol,
          ...(universeInfo?.sector ? { sector: universeInfo.sector } : {}),
          inWatchlist: watchlistSymbols.has(symbol),
          inUniverse: Boolean(universeInfo),
        };
      });
  }

  @Get('bars/:symbol')
  async bars(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe?: string,
    @Query('days') days?: string,
  ) {
    const tf: Timeframe = VALID_TIMEFRAMES.includes(timeframe as Timeframe)
      ? (timeframe as Timeframe)
      : '1d';
    const lookbackDays = Math.min(Math.max(Number(days) || 180, 1), 730);
    const to = new Date();
    // Free IEX feed disallows querying the most recent 15 minutes.
    to.setMinutes(to.getMinutes() - 16);
    const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const bars = await this.provider.getHistoricalBars(
      symbol.toUpperCase(),
      tf,
      from,
      to,
    );
    if (bars.length === 0) {
      throw new NotFoundException(`No bars for ${symbol}`);
    }
    return {
      symbol: symbol.toUpperCase(),
      timeframe: tf,
      provider: this.provider.name,
      bars: bars.map((b) => ({
        time: Math.floor(b.timestamp.getTime() / 1000),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
    };
  }

  @Get('quote/:symbol')
  async quote(@Param('symbol') symbol: string) {
    const upper = symbol.toUpperCase();
    const cached = await this.quoteCache.getQuote(upper).catch(() => null);
    if (cached) {
      return { ...cached.quote, stale: cached.stale, source: 'cache' };
    }
    const quote = await this.provider.getQuote(upper);
    return { ...quote, stale: false, source: this.provider.name };
  }

  /**
   * Session + 52-week style stats for the selected symbol on the dashboard.
   * Built from Alpaca snapshot (when available) and 1y daily bars. Fundamental
   * ratios (P/E, market cap, P/B) are null until a fundamentals feed is wired.
   */
  @Get('stats/:symbol')
  async stats(@Param('symbol') symbol: string): Promise<StockStats> {
    const upper = symbol.toUpperCase();
    const to = new Date();
    to.setMinutes(to.getMinutes() - 16);
    const from = new Date(to.getTime() - 370 * 24 * 60 * 60 * 1000);

    let open: number | null = null;
    let high: number | null = null;
    let low: number | null = null;
    let previousClose: number | null = null;

    if (this.provider.getSnapshot) {
      try {
        const snap = await this.provider.getSnapshot(upper);
        if (snap.daily) {
          open = snap.daily.open;
          high = snap.daily.high;
          low = snap.daily.low;
        }
        if (snap.previousDaily) {
          previousClose = snap.previousDaily.close;
        }
      } catch {
        // fall through to bars-only path
      }
    }

    const bars = await this.provider.getHistoricalBars(upper, '1d', from, to);
    if (bars.length === 0 && open == null) {
      throw new NotFoundException(`No stats for ${symbol}`);
    }

    const latest = bars.at(-1) ?? null;
    const previous = bars.length >= 2 ? bars[bars.length - 2] : null;
    if (open == null && latest) open = latest.open;
    if (high == null && latest) high = latest.high;
    if (low == null && latest) low = latest.low;
    if (previousClose == null && previous) previousClose = previous.close;

    const week52High =
      bars.length > 0 ? Math.max(...bars.map((b) => b.high)) : high;
    const week52Low =
      bars.length > 0 ? Math.min(...bars.map((b) => b.low)) : low;
    const avgVolume =
      bars.length > 0
        ? bars.reduce((sum, b) => sum + b.volume, 0) / bars.length
        : null;

    return {
      symbol: upper,
      open,
      high,
      low,
      previousClose,
      week52High,
      week52Low,
      avgVolume,
      marketCap: null,
      peRatio: null,
      priceToBook: null,
      asOf: (latest?.timestamp ?? to).toISOString(),
    };
  }
}
