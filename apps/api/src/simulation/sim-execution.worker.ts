import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { bullmqConnection } from '../common/bullmq-redis';
import {
  MARKET_DATA_PROVIDER,
  MarketDataProvider,
} from '../market-data/providers/market-data-provider.interface';
import { QuoteCacheService } from '../market-data/quote-cache.service';
import { PrismaService } from '../prisma/prisma.service';

export const SIM_EXECUTION_QUEUE = 'sim-execution';

/**
 * Periodically checks open simulated orders against latest prices and
 * closes them when stop or target is hit — the "virtual execution" that
 * auto-simulates every AI signal with real prices but no real money.
 *
 * Price source: Redis quote cache first, then provider REST getQuote so
 * symbols outside the Alpaca WS cap (IEX ~30) still resolve.
 */
@Injectable()
export class SimExecutionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimExecutionWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly quoteCache: QuoteCacheService,
    @Inject(MARKET_DATA_PROVIDER)
    private readonly marketData: MarketDataProvider,
  ) {}

  async onModuleInit() {
    if (this.config.get('DISABLE_WORKERS') === 'true') {
      return;
    }
    const connection = this.connectionOptions();
    this.queue = new Queue(SIM_EXECUTION_QUEUE, { connection });
    this.worker = new Worker(
      SIM_EXECUTION_QUEUE,
      async () => this.tick(),
      { connection },
    );
    this.worker.on('failed', (_job, err) =>
      this.logger.warn(`Sim execution tick failed: ${err.message}`),
    );

    await this.queue
      .add(
        'sim-tick',
        {},
        { repeat: { pattern: '* * * * *' }, removeOnComplete: 50, removeOnFail: 50 },
      )
      .catch((err) =>
        this.logger.warn(`Could not schedule sim ticks: ${err.message}`),
      );
  }

  /** One pass over all open simulated orders. */
  async tick() {
    const openOrders = await this.prisma.simulatedOrder.findMany({
      where: { status: 'open' },
    });

    // Cap REST fallbacks per tick so we don't starve the auth connection pool.
    let restFetches = 0;
    const MAX_REST_FETCHES = 25;

    for (const order of openOrders) {
      const cached = await this.quoteCache.getQuote(order.symbol).catch(() => null);
      let price: number | null =
        cached?.quote?.price && Number.isFinite(cached.quote.price)
          ? cached.quote.price
          : null;
      if (price == null) {
        if (restFetches >= MAX_REST_FETCHES) continue;
        restFetches += 1;
        price = await this.resolvePrice(order.symbol);
      }
      if (price == null) continue;

      const stop = Number(order.stopPrice);
      const target = Number(order.targetPrice);
      const isBuy = order.side === 'buy';

      const hitTarget = isBuy ? price >= target : price <= target;
      const hitStop = isBuy ? price <= stop : price >= stop;
      if (!hitTarget && !hitStop) continue;

      const exitPrice = hitTarget ? target : stop;
      const entry = Number(order.entryPrice);
      const direction = isBuy ? 1 : -1;
      const pnl = (exitPrice - entry) * direction * order.quantity;
      const proceeds = entry * order.quantity + pnl;

      await this.prisma.$transaction([
        this.prisma.simulatedOrder.update({
          where: { id: order.id },
          data: { status: 'closed', exitPrice, closedAt: new Date(), pnl },
        }),
        this.prisma.simulatedAccount.update({
          where: { id: order.accountId },
          data: { balance: { increment: proceeds } },
        }),
      ]);
      this.logger.log(
        `Sim order ${order.id} (${order.symbol}) closed at ${exitPrice}, pnl=${pnl.toFixed(2)}`,
      );
    }
  }

  /** Cache hit, else REST quote (and warm the cache for the UI). */
  private async resolvePrice(symbol: string): Promise<number | null> {
    const cached = await this.quoteCache.getQuote(symbol).catch(() => null);
    if (cached?.quote?.price && Number.isFinite(cached.quote.price)) {
      return cached.quote.price;
    }
    try {
      const quote = await this.marketData.getQuote(symbol.toUpperCase());
      if (!quote?.price || !Number.isFinite(quote.price)) return null;
      await this.quoteCache.setQuote(quote).catch(() => undefined);
      return quote.price;
    } catch (err) {
      this.logger.warn(
        `Sim quote miss ${symbol}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private connectionOptions() {
    return bullmqConnection(
      this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
