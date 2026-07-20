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
  Timeframe,
} from './providers/market-data-provider.interface';
import { MarketAssetsService } from './market-assets.service';
import { QuoteCacheService } from './quote-cache.service';
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

  @Get('symbols')
  async symbols(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    const watchlists = await this.prisma.watchlist.findMany({
      where: { userId: user.id },
      select: { symbols: true },
    });
    const watchlistSymbols = new Set(
      watchlists.flatMap(({ symbols }) => symbols.map((symbol) => symbol.trim().toUpperCase())),
    );
    const universeBySymbol = new Map(UNIVERSE_INFO.map((info) => [info.symbol, info]));
    const assets = await this.marketAssets.getAssets();
    const assetSymbols = new Set(assets.map(({ symbol }) => symbol));

    return [
      ...assets.map((asset) => {
        const universeInfo = universeBySymbol.get(asset.symbol);
        return {
          ...asset,
          ...(universeInfo?.sector ? { sector: universeInfo.sector } : {}),
          inWatchlist: watchlistSymbols.has(asset.symbol),
          inUniverse: Boolean(universeInfo),
        };
      }),
      ...[...watchlistSymbols]
        .filter((symbol) => symbol && !assetSymbols.has(symbol))
        .map((symbol) => {
          const universeInfo = universeBySymbol.get(symbol);
          return {
            symbol,
            name: universeInfo?.name ?? symbol,
            ...(universeInfo?.sector ? { sector: universeInfo.sector } : {}),
            inWatchlist: true,
            inUniverse: Boolean(universeInfo),
          };
        }),
    ];
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
}
