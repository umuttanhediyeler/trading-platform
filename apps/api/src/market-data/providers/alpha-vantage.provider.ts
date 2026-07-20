import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Bar,
  MarketDataProvider,
  Quote,
  Timeframe,
} from './market-data-provider.interface';

@Injectable()
export class AlphaVantageProvider implements MarketDataProvider {
  readonly name = 'alpha-vantage';
  private readonly logger = new Logger(AlphaVantageProvider.name);
  private readonly baseUrl = 'https://www.alphavantage.co/query';

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('ALPHA_VANTAGE_API_KEY', 'demo');
  }

  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.fetchJson({
      function: 'GLOBAL_QUOTE',
      symbol,
    });
    const q = data?.['Global Quote'];
    if (!q || !q['05. price']) {
      throw new ServiceUnavailableException(`No quote for ${symbol}`);
    }
    return {
      symbol,
      price: Number(q['05. price']),
      volume: Number(q['06. volume'] ?? 0),
      ts: Date.now(),
    };
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Bar[]> {
    const isDaily = timeframe === '1d';
    const data = await this.fetchJson(
      isDaily
        ? { function: 'TIME_SERIES_DAILY', symbol, outputsize: 'full' }
        : {
            function: 'TIME_SERIES_INTRADAY',
            symbol,
            interval: timeframe === '1h' ? '60min' : timeframe,
            outputsize: 'full',
          },
    );
    const seriesKey = Object.keys(data ?? {}).find((k) =>
      k.startsWith('Time Series'),
    );
    if (!seriesKey) {
      throw new ServiceUnavailableException(`No bars for ${symbol}`);
    }
    const bars: Bar[] = Object.entries<any>(data[seriesKey])
      .map(([ts, v]) => ({
        symbol,
        timestamp: new Date(ts),
        open: Number(v['1. open']),
        high: Number(v['2. high']),
        low: Number(v['3. low']),
        close: Number(v['4. close']),
        volume: Number(v['5. volume']),
      }))
      .filter((b) => b.timestamp >= from && b.timestamp <= to)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return bars;
  }

  /** Alpha Vantage has no streaming API on the free tier; poll slowly. */
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
    }, 60_000);
    return () => clearInterval(interval);
  }

  private async fetchJson(params: Record<string, string>): Promise<any> {
    const query = new URLSearchParams({ ...params, apikey: this.apiKey });
    const res = await fetch(`${this.baseUrl}?${query}`);
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Alpha Vantage request failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.json();
  }
}
