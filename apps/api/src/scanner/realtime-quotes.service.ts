import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BarAggregatorService } from '../market-data/bar-aggregator.service';
import {
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
} from '../market-data/providers/market-data-provider.interface';
import { QuoteCacheService } from '../market-data/quote-cache.service';
import {
  REALTIME_UNIVERSE_SIZE,
  UNIVERSE,
  mergeUniverseWithWatchlists,
} from '../market-data/universe';
import { PrismaService } from '../prisma/prisma.service';
import { ScannerGateway } from './scanner.gateway';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps a live provider subscription for the union of the universe top-N and
 * every symbol on a user watchlist (capped at MAX_REALTIME_SYMBOLS). The set
 * is recomputed every 5 minutes; when it changes the subscription is recreated
 * (the provider exposes teardown/re-subscribe rather than incremental updates).
 *
 * Each quote is written to the Redis cache, fanned out over Socket.IO, and fed
 * to the 1-minute bar aggregator.
 */
@Injectable()
export class RealtimeQuotesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeQuotesService.name);
  private unsubscribe?: () => void;
  private refreshTimer?: NodeJS.Timeout;
  private subscribedKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly quoteCache: QuoteCacheService,
    private readonly gateway: ScannerGateway,
    private readonly prisma: PrismaService,
    private readonly barAggregator: BarAggregatorService,
    @Inject(MARKET_DATA_PROVIDER)
    private readonly provider: MarketDataProvider,
  ) {}

  async onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') return;
    await this.refreshSubscription();
    this.refreshTimer = setInterval(() => {
      this.refreshSubscription().catch((err: Error) =>
        this.logger.warn(`Subscription refresh failed: ${err.message}`),
      );
    }, REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
  }

  /** Recompute the desired symbol set and resubscribe if it changed. */
  async refreshSubscription() {
    const symbols = await this.desiredSymbols();
    const key = [...symbols].sort().join(',');
    if (key === this.subscribedKey && this.unsubscribe) return;

    try {
      const next = await this.provider.subscribeRealtime(symbols, (quote) => {
        void this.quoteCache.setQuote(quote).catch(() => undefined);
        this.gateway.emitQuoteUpdate(quote);
        void this.barAggregator.onQuote(quote).catch(() => undefined);
      });
      this.unsubscribe?.();
      this.unsubscribe = next;
      this.subscribedKey = key;
      this.logger.log(
        `Realtime quotes subscribed for ${symbols.length} symbols via ${this.provider.name}`,
      );
    } catch (err) {
      this.logger.warn(
        `Realtime subscription failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Prefer open simulated positions (need prices to auto-close), then
   * watchlists, then liquid universe — hard-capped at REALTIME_UNIVERSE_SIZE
   * (30). Alpaca IEX rejects larger WS subscriptions (405 symbol limit).
   */
  private async desiredSymbols(): Promise<string[]> {
    const priority: string[] = [];
    try {
      const openSim = await this.prisma.simulatedOrder.findMany({
        where: { status: 'open' },
        select: { symbol: true },
      });
      priority.push(...openSim.map((row) => row.symbol));
    } catch (err) {
      this.logger.warn(
        `Could not load open sim symbols: ${(err as Error).message}`,
      );
    }

    let watchlistSymbols: string[] = [];
    try {
      const watchlists = await this.prisma.watchlist.findMany({
        select: { symbols: true },
      });
      watchlistSymbols = watchlists.flatMap((w) => w.symbols);
    } catch (err) {
      // DB unavailability must not take down the base universe stream.
      this.logger.warn(
        `Could not load watchlist symbols: ${(err as Error).message}`,
      );
    }

    return mergeUniverseWithWatchlists(
      priority,
      [...watchlistSymbols, ...UNIVERSE.slice(0, REALTIME_UNIVERSE_SIZE)],
      REALTIME_UNIVERSE_SIZE,
    );
  }

  async onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.unsubscribe?.();
  }
}
