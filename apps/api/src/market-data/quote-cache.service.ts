import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Quote } from './providers/market-data-provider.interface';

const QUOTE_TTL_SECONDS = 2;

/**
 * Redis cache for last quotes. Key format: `${symbol}:last_quote`, TTL 2s.
 * Also keeps a stale copy under `${symbol}:stale_quote` (no TTL) so the UI
 * can show last-known data with a "stale" flag when the provider is down.
 */
@Injectable()
export class QuoteCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(QuoteCacheService.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      { lazyConnect: true, maxRetriesPerRequest: 1 },
    );
    this.redis.on('error', (err) =>
      this.logger.warn(`Redis error: ${err.message}`),
    );
  }

  async setQuote(quote: Quote): Promise<void> {
    const payload = JSON.stringify(quote);
    await this.redis
      .multi()
      .set(`${quote.symbol}:last_quote`, payload, 'EX', QUOTE_TTL_SECONDS)
      .set(`${quote.symbol}:stale_quote`, payload)
      .exec();
  }

  async getQuote(
    symbol: string,
  ): Promise<{ quote: Quote; stale: boolean } | null> {
    const fresh = await this.redis.get(`${symbol}:last_quote`);
    if (fresh) {
      return { quote: JSON.parse(fresh), stale: false };
    }
    const stale = await this.redis.get(`${symbol}:stale_quote`);
    if (stale) {
      return { quote: JSON.parse(stale), stale: true };
    }
    return null;
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
