import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { chunk } from '@trading-platform/data';
import {
  Bar,
  MarketDataProvider,
  Quote,
  Timeframe,
} from './market-data-provider.interface';

const TIMEFRAME_MAP: Record<Timeframe, string> = {
  '1min': '1Min',
  '5min': '5Min',
  '15min': '15Min',
  '1h': '1Hour',
  '1d': '1Day',
};

/**
 * Alpaca Market Data API v2 + streaming quotes over WebSocket.
 * Free tier uses the IEX feed (ALPACA_DATA_FEED=iex).
 */
@Injectable()
export class AlpacaDataProvider implements MarketDataProvider {
  /** Symbols per multi-symbol bars request (keeps URLs and payloads sane). */
  static readonly BATCH_SYMBOLS_PER_REQUEST = 100;

  readonly name = 'alpaca';
  private readonly logger = new Logger(AlpacaDataProvider.name);
  private readonly baseUrl = 'https://data.alpaca.markets';

  constructor(private readonly config: ConfigService) {}

  private get headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.config.get<string>('ALPACA_API_KEY', ''),
      'APCA-API-SECRET-KEY': this.config.get<string>('ALPACA_SECRET_KEY', ''),
    };
  }

  private get feed(): string {
    return this.config.get<string>('ALPACA_DATA_FEED', 'iex');
  }

  async getQuote(symbol: string): Promise<Quote> {
    const data = await this.fetchJson(
      `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=${this.feed}`,
    );
    const trade = data?.trade;
    if (!trade) {
      throw new ServiceUnavailableException(`No quote for ${symbol}`);
    }
    return {
      symbol,
      price: trade.p,
      volume: trade.s ?? 0,
      ts: trade.t ? Date.parse(trade.t) : Date.now(),
    };
  }

  async getSnapshot(symbol: string): Promise<{
    daily: Bar | null;
    previousDaily: Bar | null;
  }> {
    const data = await this.fetchJson(
      `/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=${this.feed}`,
    );
    const mapBar = (raw: any): Bar | null => {
      if (!raw || raw.o == null) return null;
      return {
        symbol,
        timestamp: raw.t ? new Date(raw.t) : new Date(),
        open: Number(raw.o),
        high: Number(raw.h),
        low: Number(raw.l),
        close: Number(raw.c),
        volume: Number(raw.v ?? 0),
      };
    };
    return {
      daily: mapBar(data?.dailyBar),
      previousDaily: mapBar(data?.prevDailyBar),
    };
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Bar[]> {
    const bars: Bar[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeframe: TIMEFRAME_MAP[timeframe],
        start: from.toISOString(),
        end: to.toISOString(),
        feed: this.feed,
        adjustment: 'split',
        limit: '10000',
      });
      if (pageToken) params.set('page_token', pageToken);
      const data = await this.fetchJson(
        `/v2/stocks/${encodeURIComponent(symbol)}/bars?${params.toString()}`,
      );
      for (const b of data?.bars ?? []) {
        bars.push({
          symbol,
          timestamp: new Date(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        });
      }
      pageToken = data?.next_page_token ?? undefined;
    } while (pageToken);
    return bars;
  }

  /**
   * Multi-symbol historical bars via Alpaca's batch endpoint
   * (`GET /v2/stocks/bars?symbols=...`): one HTTP request covers up to
   * {@link AlpacaDataProvider.BATCH_SYMBOLS_PER_REQUEST} symbols instead of
   * one request per symbol. Symbols without data are absent from the result.
   */
  async getHistoricalBarsBatch(
    symbols: readonly string[],
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Map<string, Bar[]>> {
    const result = new Map<string, Bar[]>();
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()))];
    for (const group of chunk(unique, AlpacaDataProvider.BATCH_SYMBOLS_PER_REQUEST)) {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          symbols: group.join(','),
          timeframe: TIMEFRAME_MAP[timeframe],
          start: from.toISOString(),
          end: to.toISOString(),
          feed: this.feed,
          adjustment: 'split',
          limit: '10000',
        });
        if (pageToken) params.set('page_token', pageToken);
        const data = await this.fetchJson(`/v2/stocks/bars?${params.toString()}`);
        for (const [symbol, rawBars] of Object.entries(data?.bars ?? {})) {
          const bars = result.get(symbol) ?? [];
          for (const b of (rawBars as any[]) ?? []) {
            bars.push({
              symbol,
              timestamp: new Date(b.t),
              open: b.o,
              high: b.h,
              low: b.l,
              close: b.c,
              volume: b.v,
            });
          }
          result.set(symbol, bars);
        }
        pageToken = data?.next_page_token ?? undefined;
      } while (pageToken);
    }
    return result;
  }

  /**
   * Prefer Alpaca trade websocket; fall back to REST polling if the socket
   * cannot be established (common on restricted networks).
   */
  async subscribeRealtime(
    symbols: string[],
    onQuote: (quote: Quote) => void,
  ): Promise<() => void> {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    if (unique.length === 0) return () => undefined;

    const wsUrl = `wss://stream.data.alpaca.markets/v2/${this.feed}`;
    let closed = false;
    let socket: WebSocket | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (pollTimer || closed) return;
      this.logger.warn('Alpaca WS unavailable — falling back to 15s REST polling');
      pollTimer = setInterval(async () => {
        for (const symbol of unique) {
          try {
            onQuote(await this.getQuote(symbol));
          } catch (err) {
            this.logger.warn(`Poll failed for ${symbol}: ${(err as Error).message}`);
          }
        }
      }, 15_000);
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 30_000);
    };

    const connect = () => {
      if (closed) return;
      try {
        const current = new WebSocket(wsUrl);
        socket = current;
        const authTimeout = setTimeout(() => {
          if (
            current.readyState === WebSocket.CONNECTING ||
            current.readyState === WebSocket.OPEN
          ) {
            current.close();
          }
        }, 10_000);

        current.addEventListener('open', () => {
          current.send(
            JSON.stringify({
              action: 'auth',
              key: this.config.get<string>('ALPACA_API_KEY', ''),
              secret: this.config.get<string>('ALPACA_SECRET_KEY', ''),
            }),
          );
        });

        current.addEventListener('message', (event) => {
          let messages: any[];
          try {
            messages = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (!Array.isArray(messages)) messages = [messages];

          for (const msg of messages) {
            if (msg.T === 'success' && msg.msg === 'authenticated') {
              clearTimeout(authTimeout);
              if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
              current.send(
                JSON.stringify({
                  action: 'subscribe',
                  trades: unique,
                  quotes: unique,
                }),
              );
              this.logger.log(`Alpaca WS authenticated (${this.feed})`);
              continue;
            }
            if (msg.T === 't' && msg.S) {
              onQuote({
                symbol: msg.S,
                price: msg.p,
                volume: msg.s ?? 0,
                ts: msg.t ? Date.parse(msg.t) : Date.now(),
              });
            } else if (msg.T === 'q' && msg.S) {
              const bid = Number(msg.bp ?? 0);
              const ask = Number(msg.ap ?? 0);
              const mid = bid && ask ? (bid + ask) / 2 : ask || bid;
              if (!mid) continue;
              onQuote({
                symbol: msg.S,
                price: mid,
                volume: Number(msg.bs ?? 0) + Number(msg.as ?? 0),
                ts: msg.t ? Date.parse(msg.t) : Date.now(),
              });
            } else if (msg.T === 'error') {
              this.logger.warn(
                `Alpaca WS error ${msg.code ?? ''}: ${msg.msg ?? JSON.stringify(msg)}`,
              );
            }
          }
        });

        current.addEventListener('error', () => {
          clearTimeout(authTimeout);
          if (!closed) startPolling();
        });
        current.addEventListener('close', (event) => {
          clearTimeout(authTimeout);
          if (closed) return;
          this.logger.warn(
            `Alpaca WS closed (${event.code}${event.reason ? `: ${event.reason}` : ''}); retrying`,
          );
          startPolling();
          scheduleReconnect();
        });
      } catch (error) {
        this.logger.warn(`Alpaca WS connect failed: ${(error as Error).message}`);
        startPolling();
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        // ignore
      }
    };
  }

  private async fetchJson(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Alpaca data request failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.json();
  }
}
