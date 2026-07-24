export type BrokerName = 'alpaca' | 'binance';

export interface BrokerCredentials {
  broker: BrokerName;
  apiKey: string;
  apiSecret: string;
  /** paper uses the provider sandbox/testnet; live uses real funds. */
  mode: 'paper' | 'live';
}

export interface BrokerOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type: 'market' | 'limit';
  limitPrice?: number;
  /** Idempotency key — the same signal must never open two orders. */
  clientOrderId: string;
  /** bracket = entry+TP/SL; oco = protect an existing long with TP/SL. */
  orderClass?: 'simple' | 'bracket' | 'oco';
  /** Required when orderClass is bracket or oco. */
  takeProfitPrice?: number;
  /** Required when orderClass is bracket or oco. */
  stopLossPrice?: number;
  /**
   * Estimated fill price for market orders (e.g. the signal entry price).
   * Used only for local risk/exposure accounting, never sent to the broker.
   */
  entryPriceHint?: number;
}

export interface BrokerOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  quantity: number;
  status: string;
  filledQty?: number;
  filledAvgPrice?: number | null;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

/**
 * Broker abstraction. First implementation is Alpaca (paper trading built
 * in); adding another broker means implementing this interface only.
 */
export interface BrokerAdapter {
  readonly name: BrokerName;
  readonly capabilities: BrokerCapabilities;
  placeOrder(creds: BrokerCredentials, order: BrokerOrderRequest): Promise<BrokerOrder>;
  getOrderByClientOrderId(
    creds: BrokerCredentials,
    clientOrderId: string,
    symbol: string,
  ): Promise<BrokerOrder>;
  cancelOrder(creds: BrokerCredentials, orderId: string, symbol: string): Promise<void>;
  getPositions(creds: BrokerCredentials): Promise<BrokerPosition[]>;
  getAccountBalance(creds: BrokerCredentials): Promise<{ cash: number; equity: number }>;
}

export interface BrokerCapabilities {
  marketOrders: boolean;
  limitOrders: boolean;
  bracketOrders: boolean;
  fractionalQuantity: boolean;
  positions: 'full' | 'balances_only';
  paper: boolean;
  live: boolean;
}

export const BROKER_ADAPTERS = 'BROKER_ADAPTERS';
