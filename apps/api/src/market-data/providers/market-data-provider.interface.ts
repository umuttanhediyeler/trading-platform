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
  subscribeRealtime(
    symbols: string[],
    onQuote: (quote: Quote) => void,
  ): Promise<() => void>;
}

export const MARKET_DATA_PROVIDER = 'MARKET_DATA_PROVIDER';
