export interface UniverseInfo {
  symbol: string;
  name: string;
  sector?: string;
}

/**
 * Liquid US equity universe (~100 large caps across sectors).
 *
 * Ordering matters: the list is roughly sorted by liquidity/market cap so
 * callers can take a top-N slice to bound latency-sensitive work.
 */
export const UNIVERSE_INFO: readonly UniverseInfo[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication Services' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', sector: 'Communication Services' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', sector: 'Communication Services' },
  { symbol: 'AMD', name: 'Advanced Micro Devices, Inc.', sector: 'Technology' },
  { symbol: 'ORCL', name: 'Oracle Corporation', sector: 'Technology' },
  { symbol: 'CRM', name: 'Salesforce, Inc.', sector: 'Technology' },
  { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology' },
  { symbol: 'INTC', name: 'Intel Corporation', sector: 'Technology' },
  { symbol: 'QCOM', name: 'QUALCOMM Incorporated', sector: 'Technology' },
  { symbol: 'TXN', name: 'Texas Instruments Incorporated', sector: 'Technology' },
  { symbol: 'MU', name: 'Micron Technology, Inc.', sector: 'Technology' },
  { symbol: 'AMAT', name: 'Applied Materials, Inc.', sector: 'Technology' },
  { symbol: 'PLTR', name: 'Palantir Technologies Inc.', sector: 'Technology' },
  { symbol: 'NOW', name: 'ServiceNow, Inc.', sector: 'Technology' },
  { symbol: 'IBM', name: 'International Business Machines Corporation', sector: 'Technology' },
  { symbol: 'CSCO', name: 'Cisco Systems, Inc.', sector: 'Technology' },
  { symbol: 'UBER', name: 'Uber Technologies, Inc.', sector: 'Industrials' },
  { symbol: 'SHOP', name: 'Shopify Inc.', sector: 'Technology' },
  { symbol: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology' },
  { symbol: 'PANW', name: 'Palo Alto Networks, Inc.', sector: 'Technology' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings, Inc.', sector: 'Technology' },
  { symbol: 'INTU', name: 'Intuit Inc.', sector: 'Technology' },
  { symbol: 'ANET', name: 'Arista Networks, Inc.', sector: 'Technology' },
  { symbol: 'LRCX', name: 'Lam Research Corporation', sector: 'Technology' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials' },
  { symbol: 'BAC', name: 'Bank of America Corporation', sector: 'Financials' },
  { symbol: 'WFC', name: 'Wells Fargo & Company', sector: 'Financials' },
  { symbol: 'GS', name: 'The Goldman Sachs Group, Inc.', sector: 'Financials' },
  { symbol: 'MS', name: 'Morgan Stanley', sector: 'Financials' },
  { symbol: 'C', name: 'Citigroup Inc.', sector: 'Financials' },
  { symbol: 'SCHW', name: 'The Charles Schwab Corporation', sector: 'Financials' },
  { symbol: 'BLK', name: 'BlackRock, Inc.', sector: 'Financials' },
  { symbol: 'AXP', name: 'American Express Company', sector: 'Financials' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financials' },
  { symbol: 'MA', name: 'Mastercard Incorporated', sector: 'Financials' },
  { symbol: 'PYPL', name: 'PayPal Holdings, Inc.', sector: 'Financials' },
  { symbol: 'COIN', name: 'Coinbase Global, Inc.', sector: 'Financials' },
  { symbol: 'BX', name: 'Blackstone Inc.', sector: 'Financials' },
  { symbol: 'KKR', name: 'KKR & Co. Inc.', sector: 'Financials' },
  { symbol: 'UNH', name: 'UnitedHealth Group Incorporated', sector: 'Healthcare' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { symbol: 'LLY', name: 'Eli Lilly and Company', sector: 'Healthcare' },
  { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare' },
  { symbol: 'MRK', name: 'Merck & Co., Inc.', sector: 'Healthcare' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare' },
  { symbol: 'TMO', name: 'Thermo Fisher Scientific Inc.', sector: 'Healthcare' },
  { symbol: 'ABT', name: 'Abbott Laboratories', sector: 'Healthcare' },
  { symbol: 'AMGN', name: 'Amgen Inc.', sector: 'Healthcare' },
  { symbol: 'ISRG', name: 'Intuitive Surgical, Inc.', sector: 'Healthcare' },
  { symbol: 'GILD', name: 'Gilead Sciences, Inc.', sector: 'Healthcare' },
  { symbol: 'CVS', name: 'CVS Health Corporation', sector: 'Healthcare' },
  { symbol: 'MDT', name: 'Medtronic plc', sector: 'Healthcare' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb Company', sector: 'Healthcare' },
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Staples' },
  { symbol: 'COST', name: 'Costco Wholesale Corporation', sector: 'Consumer Staples' },
  { symbol: 'HD', name: 'The Home Depot, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'LOW', name: "Lowe's Companies, Inc.", sector: 'Consumer Discretionary' },
  { symbol: 'NKE', name: 'NIKE, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'MCD', name: "McDonald's Corporation", sector: 'Consumer Discretionary' },
  { symbol: 'SBUX', name: 'Starbucks Corporation', sector: 'Consumer Discretionary' },
  { symbol: 'TGT', name: 'Target Corporation', sector: 'Consumer Staples' },
  { symbol: 'PG', name: 'The Procter & Gamble Company', sector: 'Consumer Staples' },
  { symbol: 'KO', name: 'The Coca-Cola Company', sector: 'Consumer Staples' },
  { symbol: 'PEP', name: 'PepsiCo, Inc.', sector: 'Consumer Staples' },
  { symbol: 'PM', name: 'Philip Morris International Inc.', sector: 'Consumer Staples' },
  { symbol: 'MDLZ', name: 'Mondelez International, Inc.', sector: 'Consumer Staples' },
  { symbol: 'DIS', name: 'The Walt Disney Company', sector: 'Communication Services' },
  { symbol: 'BKNG', name: 'Booking Holdings Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'ABNB', name: 'Airbnb, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'MAR', name: 'Marriott International, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'LULU', name: 'lululemon athletica inc.', sector: 'Consumer Discretionary' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrials' },
  { symbol: 'DE', name: 'Deere & Company', sector: 'Industrials' },
  { symbol: 'BA', name: 'The Boeing Company', sector: 'Industrials' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'Industrials' },
  { symbol: 'HON', name: 'Honeywell International Inc.', sector: 'Industrials' },
  { symbol: 'UPS', name: 'United Parcel Service, Inc.', sector: 'Industrials' },
  { symbol: 'FDX', name: 'FedEx Corporation', sector: 'Industrials' },
  { symbol: 'LMT', name: 'Lockheed Martin Corporation', sector: 'Industrials' },
  { symbol: 'RTX', name: 'RTX Corporation', sector: 'Industrials' },
  { symbol: 'UNP', name: 'Union Pacific Corporation', sector: 'Industrials' },
  { symbol: 'DAL', name: 'Delta Air Lines, Inc.', sector: 'Industrials' },
  { symbol: 'UAL', name: 'United Airlines Holdings, Inc.', sector: 'Industrials' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  { symbol: 'SLB', name: 'SLB', sector: 'Energy' },
  { symbol: 'OXY', name: 'Occidental Petroleum Corporation', sector: 'Energy' },
  { symbol: 'FCX', name: 'Freeport-McMoRan Inc.', sector: 'Materials' },
  { symbol: 'NEM', name: 'Newmont Corporation', sector: 'Materials' },
  { symbol: 'LIN', name: 'Linde plc', sector: 'Materials' },
  { symbol: 'NEE', name: 'NextEra Energy, Inc.', sector: 'Utilities' },
  { symbol: 'DUK', name: 'Duke Energy Corporation', sector: 'Utilities' },
  { symbol: 'AMT', name: 'American Tower Corporation', sector: 'Real Estate' },
  { symbol: 'PLD', name: 'Prologis, Inc.', sector: 'Real Estate' },
  { symbol: 'T', name: 'AT&T Inc.', sector: 'Communication Services' },
  { symbol: 'VZ', name: 'Verizon Communications Inc.', sector: 'Communication Services' },
  { symbol: 'TMUS', name: 'T-Mobile US, Inc.', sector: 'Communication Services' },
  { symbol: 'F', name: 'Ford Motor Company', sector: 'Consumer Discretionary' },
  { symbol: 'GM', name: 'General Motors Company', sector: 'Consumer Discretionary' },
  { symbol: 'RIVN', name: 'Rivian Automotive, Inc.', sector: 'Consumer Discretionary' },
  { symbol: 'MRVL', name: 'Marvell Technology, Inc.', sector: 'Technology' },
  { symbol: 'SMCI', name: 'Super Micro Computer, Inc.', sector: 'Technology' },
];

/** Symbol-only compatibility export used by scanners, workers, and models. */
export const UNIVERSE: readonly string[] = UNIVERSE_INFO.map(({ symbol }) => symbol);

/** Symbols the realtime quote stream subscribes to (before watchlists). */
export const REALTIME_UNIVERSE_SIZE = 30;

/** Hard cap on concurrent realtime subscriptions (provider/resource bound). */
export const MAX_REALTIME_SYMBOLS = 100;

/**
 * ML signal generation uses a dynamic top-N slice (see SignalUniverseService).
 * Hard cap bounds per-cycle latency (bar load + inference per symbol).
 */
export const MAX_SIGNAL_UNIVERSE_SIZE = 80;

/** @deprecated Use MAX_SIGNAL_UNIVERSE_SIZE — kept for tests/docs. */
export const SIGNAL_UNIVERSE_SIZE = MAX_SIGNAL_UNIVERSE_SIZE;

/**
 * Merge a base symbol list with user watchlist symbols: de-duplicates,
 * uppercases, preserves base ordering first, and enforces `cap`.
 */
export function mergeUniverseWithWatchlists(
  base: readonly string[],
  watchlistSymbols: readonly string[],
  cap: number = MAX_REALTIME_SYMBOLS,
): string[] {
  const merged = new Set<string>();
  for (const symbol of [...base, ...watchlistSymbols]) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) continue;
    merged.add(normalized);
    if (merged.size >= cap) break;
  }
  return [...merged];
}
