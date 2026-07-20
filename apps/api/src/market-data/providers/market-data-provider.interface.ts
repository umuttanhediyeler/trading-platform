export interface Quote {
  symbol: string;
  price: number;
  volume: number;
  ts: number; // epoch ms
}

export interface Bar {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Session + 52-week style stats for dashboard / detail panels. */
export interface StockStats {
  symbol: string;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  week52High: number | null;
  week52Low: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  peRatio: number | null;
  priceToBook: number | null;
  asOf: string;
}

export type Timeframe = '1min' | '5min' | '15min' | '1h' | '1d';

/**
 * Provider abstraction — swapping to another (e.g. licensed real-time) data
 * vendor should only require a new implementation of this interface.
 */
export interface MarketDataProvider {
  readonly name: string;
  getQuote(symbol: string): Promise<Quote>;
  getHistoricalBars(
    symbol: string,
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Bar[]>;
  /**
   * Optional multi-symbol capability: fetch bars for many symbols in as few
   * HTTP requests as the vendor allows. Symbols the vendor returns no data
   * for are simply absent from the map. Providers without a native batch
   * endpoint leave this undefined; callers must then fall back to bounded
   * per-symbol `getHistoricalBars` calls.
   */
  getHistoricalBarsBatch?(
    symbols: readonly string[],
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Map<string, Bar[]>>;
  /** Optional vendor snapshot (daily + previous close). */
  getSnapshot?(symbol: string): Promise<{
    daily: Bar | null;
    previousDaily: Bar | null;
  }>;
  subscribeRealtime(
    symbols: string[],
    onQuote: (quote: Quote) => void,
  ): Promise<() => void>;
}

export const MARKET_DATA_PROVIDER = 'MARKET_DATA_PROVIDER';
