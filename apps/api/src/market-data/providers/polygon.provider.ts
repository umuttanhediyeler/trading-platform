import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Bar,
  MarketDataProvider,
  Quote,
  Timeframe,
} from './market-data-provider.interface';

const TIMEFRAME_MAP: Record<Timeframe, { multiplier: number; timespan: string }> = {
  '1min': { multiplier: 1, timespan: 'minute' },
  '5min': { multiplier: 5, timespan: 'minute' },
  '15min': { multiplier: 15, timespan: 'minute' },
  '1h': { multiplier: 1, timespan: 'hour' },
  '1d': { multiplier: 1, timespan: 'day' },
};

@Injectable()
export class PolygonProvider implements MarketDataProvider {
  readonly name = 'polygon';
  private readonly logger = new Logger(PolygonProvider.name);
  private readonly baseUrl = 'https://api.polygon.io';

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('POLYGON_API_KEY', '');
  }

  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.fetchJson(
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`,
    );
    const result = data?.results?.[0];
    if (!result) {
      throw new ServiceUnavailableException(`No quote for ${symbol}`);
    }
    return {
      symbol,
      price: result.c,
      volume: result.v,
      ts: result.t ?? Date.now(),
    };
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Bar[]> {
    const { multiplier, timespan } = TIMEFRAME_MAP[timeframe];
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const data = await this.fetchJson(
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${multiplier}/${timespan}/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50000`,
    );
    return (data?.results ?? []).map((r: any) => ({
      symbol,
      timestamp: new Date(r.t),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));
  }

  /**
   * Free-tier Polygon has no websocket; poll instead. Returns an unsubscribe
   * function that stops the polling loop.
   */
  async subscribeRealtime(
    symbols: string[],
    onQuote: (quote: Quote) => void,
  ): Promise<() => void> {
    const interval = setInterval(async () => {
      for (const symbol of symbols) {
        try {
          onQuote(await this.getQuote(symbol));
        } catch (err) {
          this.logger.warn(`Poll failed for ${symbol}: ${(err as Error).message}`);
        }
      }
    }, 15_000);
    return () => clearInterval(interval);
  }

  private async fetchJson(path: string): Promise<any> {
    const separator = path.includes('?') ? '&' : '?';
    const res = await fetch(`${this.baseUrl}${path}${separator}apiKey=${this.apiKey}`);
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Polygon request failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.json();
  }
}
