import { createHash, createHmac } from 'crypto';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BrokerAdapter,
  BrokerCredentials,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerPosition,
} from './broker-adapter.interface';

const TESTNET_URL = 'https://testnet.binance.vision';
const LIVE_URL = 'https://api.binance.com';
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const STABLE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI']);

interface BinanceFilter {
  filterType: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minNotional?: string;
}

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  isSpotTradingAllowed?: boolean;
  orderTypes: string[];
  filters: BinanceFilter[];
}

@Injectable()
export class BinanceAdapter implements BrokerAdapter {
  readonly name = 'binance' as const;
  readonly capabilities = {
    marketOrders: true,
    limitOrders: true,
    bracketOrders: false,
    fractionalQuantity: true,
    positions: 'balances_only',
    paper: true,
    live: true,
  } as const;

  async placeOrder(
    creds: BrokerCredentials,
    order: BrokerOrderRequest,
  ): Promise<BrokerOrder> {
    const symbol = this.normalizeSymbol(order.symbol);
    if (order.orderClass === 'bracket' || order.orderClass === 'oco') {
      throw new BadRequestException(
        'Binance Spot does not support atomic bracket orders; submit a simple order and manage exits separately',
      );
    }
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive finite number');
    }
    if (
      order.type === 'limit' &&
      (!Number.isFinite(order.limitPrice) || Number(order.limitPrice) <= 0)
    ) {
      throw new BadRequestException('A positive limitPrice is required for limit orders');
    }

    const info = await this.getSymbolInfo(creds, symbol);
    this.validateOrder(info, order);
    const clientOrderId = this.clientOrderId(order.clientOrderId);
    const params: Record<string, string> = {
      symbol,
      side: order.side.toUpperCase(),
      type: order.type.toUpperCase(),
      quantity: this.decimal(order.quantity),
      newClientOrderId: clientOrderId,
      newOrderRespType: 'FULL',
    };
    if (order.type === 'limit') {
      params.timeInForce = 'GTC';
      params.price = this.decimal(order.limitPrice!);
    }
    const data = await this.signedRequest(creds, 'POST', '/api/v3/order', params);
    return this.mapOrder(data, order.clientOrderId);
  }

  async getOrderByClientOrderId(
    creds: BrokerCredentials,
    clientOrderId: string,
    symbol: string,
  ): Promise<BrokerOrder> {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    const data = await this.signedRequest(creds, 'GET', '/api/v3/order', {
      symbol: normalizedSymbol,
      origClientOrderId: this.clientOrderId(clientOrderId),
    });
    return this.mapOrder(data, clientOrderId);
  }

  async cancelOrder(
    creds: BrokerCredentials,
    orderId: string,
    symbol: string,
  ): Promise<void> {
    await this.signedRequest(creds, 'DELETE', '/api/v3/order', {
      symbol: this.normalizeSymbol(symbol),
      orderId,
    });
  }

  async getPositions(creds: BrokerCredentials): Promise<BrokerPosition[]> {
    const account = await this.signedRequest(creds, 'GET', '/api/v3/account');
    const prices = await this.usdtPrices(creds);
    return (account.balances as Array<{ asset: string; free: string; locked: string }>)
      .map((balance) => {
        const quantity = Number(balance.free) + Number(balance.locked);
        const unitPrice = this.usdtPrice(balance.asset, prices);
        return {
          symbol: balance.asset,
          quantity,
          avgEntryPrice: 0,
          marketValue: unitPrice === null ? 0 : quantity * unitPrice,
          unrealizedPnl: 0,
        };
      })
      .filter((position) => position.quantity > 0);
  }

  async getAccountBalance(
    creds: BrokerCredentials,
  ): Promise<{ cash: number; equity: number }> {
    const account = await this.signedRequest(creds, 'GET', '/api/v3/account');
    const prices = await this.usdtPrices(creds);
    let cash = 0;
    let equity = 0;
    for (const balance of account.balances as Array<{
      asset: string;
      free: string;
      locked: string;
    }>) {
      const free = Number(balance.free);
      const total = free + Number(balance.locked);
      if (!Number.isFinite(total) || total <= 0) continue;
      const price = this.usdtPrice(balance.asset, prices);
      if (price === null) continue;
      equity += total * price;
      if (STABLE_ASSETS.has(balance.asset)) cash += free * price;
    }
    return { cash, equity };
  }

  private async getSymbolInfo(
    creds: BrokerCredentials,
    symbol: string,
  ): Promise<BinanceSymbolInfo> {
    const query = new URLSearchParams({ symbol });
    const data = await this.publicRequest(
      creds,
      `/api/v3/exchangeInfo?${query.toString()}`,
    );
    const info = (data.symbols as BinanceSymbolInfo[] | undefined)?.[0];
    if (!info) throw new BadRequestException(`Unknown Binance Spot symbol: ${symbol}`);
    return info;
  }

  private validateOrder(info: BinanceSymbolInfo, order: BrokerOrderRequest): void {
    if (info.status !== 'TRADING' || info.isSpotTradingAllowed === false) {
      throw new BadRequestException(`${info.symbol} is not enabled for spot trading`);
    }
    if (!info.orderTypes.includes(order.type.toUpperCase())) {
      throw new BadRequestException(
        `${order.type} orders are not supported for ${info.symbol}`,
      );
    }
    const marketLotFilter = info.filters.find(
      (filter) => filter.filterType === 'MARKET_LOT_SIZE',
    );
    const lotFilter =
      order.type === 'market' &&
      Number(marketLotFilter?.stepSize ?? 0) > 0
        ? marketLotFilter
        : info.filters.find((filter) => filter.filterType === 'LOT_SIZE');
    if (lotFilter) {
      this.assertFilterValue(
        'quantity',
        order.quantity,
        lotFilter.minQty,
        lotFilter.maxQty,
        lotFilter.stepSize,
      );
    }
    if (order.type === 'limit') {
      const priceFilter = info.filters.find(
        (filter) => filter.filterType === 'PRICE_FILTER',
      );
      if (priceFilter) {
        this.assertFilterValue(
          'limitPrice',
          order.limitPrice!,
          priceFilter.minPrice,
          priceFilter.maxPrice,
          priceFilter.tickSize,
        );
      }
      const notionalFilter = info.filters.find((filter) =>
        ['MIN_NOTIONAL', 'NOTIONAL'].includes(filter.filterType),
      );
      const minNotional = Number(notionalFilter?.minNotional ?? 0);
      if (
        minNotional > 0 &&
        order.quantity * order.limitPrice! + Number.EPSILON < minNotional
      ) {
        throw new BadRequestException(
          `Order notional must be at least ${notionalFilter!.minNotional}`,
        );
      }
    }
  }

  private assertFilterValue(
    field: string,
    value: number,
    minRaw?: string,
    maxRaw?: string,
    incrementRaw?: string,
  ): void {
    const min = Number(minRaw ?? 0);
    const max = Number(maxRaw ?? 0);
    if (min > 0 && value < min) {
      throw new BadRequestException(`${field} must be at least ${minRaw}`);
    }
    if (max > 0 && value > max) {
      throw new BadRequestException(`${field} must not exceed ${maxRaw}`);
    }
    const increment = Number(incrementRaw ?? 0);
    if (increment > 0) {
      const scaled = value / increment;
      if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
        throw new BadRequestException(
          `${field} must be a multiple of ${incrementRaw}`,
        );
      }
    }
  }

  private mapOrder(data: any, clientOrderId: string): BrokerOrder {
    const filledQty = Number(data.executedQty ?? 0);
    const quoteQty = Number(data.cummulativeQuoteQty ?? 0);
    return {
      id: String(data.orderId),
      clientOrderId,
      symbol: data.symbol,
      side: String(data.side).toLowerCase(),
      quantity: Number(data.origQty),
      status: String(data.status).toLowerCase(),
      filledQty,
      filledAvgPrice: filledQty > 0 ? quoteQty / filledQty : null,
    };
  }

  private async usdtPrices(creds: BrokerCredentials): Promise<Map<string, number>> {
    const data = (await this.publicRequest(
      creds,
      '/api/v3/ticker/price',
    )) as Array<{ symbol: string; price: string }>;
    return new Map(data.map((ticker) => [ticker.symbol, Number(ticker.price)]));
  }

  private usdtPrice(asset: string, prices: Map<string, number>): number | null {
    if (STABLE_ASSETS.has(asset)) return 1;
    const direct = prices.get(`${asset}USDT`);
    if (Number.isFinite(direct) && direct! > 0) return direct!;
    return null;
  }

  private async signedRequest(
    creds: BrokerCredentials,
    method: string,
    path: string,
    params: Record<string, string> = {},
  ): Promise<any> {
    const query = new URLSearchParams({
      ...params,
      recvWindow: '5000',
      timestamp: String(Date.now()),
    });
    query.set(
      'signature',
      createHmac('sha256', creds.apiSecret).update(query.toString()).digest('hex'),
    );
    const res = await fetch(`${this.baseUrl(creds)}${path}?${query.toString()}`, {
      method,
      headers: { 'X-MBX-APIKEY': creds.apiKey },
    });
    return this.parseResponse(res, method, path);
  }

  private async publicRequest(
    creds: BrokerCredentials,
    path: string,
  ): Promise<any> {
    const res = await fetch(`${this.baseUrl(creds)}${path}`, { method: 'GET' });
    return this.parseResponse(res, 'GET', path.split('?')[0]);
  }

  private async parseResponse(
    res: Response,
    method: string,
    path: string,
  ): Promise<any> {
    const text = await res.text();
    let data: any = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
    if (!res.ok) {
      const message =
        data && typeof data.msg === 'string' ? `: ${data.msg}` : '';
      throw new ServiceUnavailableException(
        `Binance ${method} ${path} failed (${res.status})${message}`,
      );
    }
    return data;
  }

  private normalizeSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase().replace(/[-/]/g, '');
    if (!SYMBOL_PATTERN.test(normalized)) {
      throw new BadRequestException(
        'Binance symbols must contain 2-20 uppercase letters or digits',
      );
    }
    return normalized;
  }

  private clientOrderId(value: string): string {
    if (/^[.A-Za-z0-9_:/-]{1,36}$/.test(value)) return value;
    return `tp-${createHash('sha256').update(value).digest('hex').slice(0, 33)}`;
  }

  private decimal(value: number): string {
    return value.toLocaleString('en-US', {
      useGrouping: false,
      maximumSignificantDigits: 15,
    });
  }

  private baseUrl(creds: BrokerCredentials): string {
    return creds.mode === 'live' ? LIVE_URL : TESTNET_URL;
  }
}
