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

const PAPER_URL = 'https://paper-api.alpaca.markets';
const LIVE_URL = 'https://api.alpaca.markets';

/** Alpaca equity min tick: $0.01 at/above $1, else $0.0001. */
export function formatAlpacaPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) {
    throw new BadRequestException(`Invalid order price: ${price}`);
  }
  const increment = price >= 1 ? 0.01 : 0.0001;
  const rounded = Math.round(price / increment) * increment;
  const decimals = price >= 1 ? 2 : 4;
  return rounded.toFixed(decimals);
}

@Injectable()
export class AlpacaAdapter implements BrokerAdapter {
  readonly name = 'alpaca' as const;
  readonly capabilities = {
    marketOrders: true,
    limitOrders: true,
    bracketOrders: true,
    fractionalQuantity: true,
    positions: 'full',
    paper: true,
    live: true,
  } as const;

  async placeOrder(
    creds: BrokerCredentials,
    order: BrokerOrderRequest,
  ): Promise<BrokerOrder> {
    // Brackets/OCO must be GTC: day TIF expires TP/SL at the close and leaves
    // naked positions (the main reason stops never fired overnight).
    const advanced =
      order.orderClass === 'bracket' || order.orderClass === 'oco';
    const body: Record<string, unknown> = {
      symbol: order.symbol,
      qty: String(order.quantity),
      side: order.side,
      type: order.type,
      time_in_force: advanced ? 'gtc' : 'day',
      limit_price: order.limitPrice
        ? formatAlpacaPrice(order.limitPrice)
        : undefined,
      client_order_id: order.clientOrderId,
    };
    if (order.orderClass === 'bracket' || order.orderClass === 'oco') {
      if (!order.takeProfitPrice || !order.stopLossPrice) {
        throw new Error(
          `${order.orderClass} orders require takeProfitPrice and stopLossPrice`,
        );
      }
      body.order_class = order.orderClass;
      body.take_profit = {
        limit_price: formatAlpacaPrice(order.takeProfitPrice),
      };
      body.stop_loss = { stop_price: formatAlpacaPrice(order.stopLossPrice) };
      // OCO to protect an existing long is always a sell; type=limit with
      // nested TP/SL legs (Alpaca OCO contract).
      if (order.orderClass === 'oco') {
        body.side = 'sell';
        body.type = 'limit';
        body.limit_price = formatAlpacaPrice(order.takeProfitPrice);
      }
    }
    const data = await this.request(creds, 'POST', '/v2/orders', body);
    return this.mapOrder(data);
  }

  async getOrderByClientOrderId(
    creds: BrokerCredentials,
    clientOrderId: string,
    _symbol: string,
  ): Promise<BrokerOrder> {
    const query = new URLSearchParams({
      client_order_id: clientOrderId,
    }).toString();
    const data = await this.request(
      creds,
      'GET',
      `/v2/orders:by_client_order_id?${query}`,
    );
    return this.mapOrder(data);
  }

  private mapOrder(data: any): BrokerOrder {
    return {
      id: data.id,
      clientOrderId: data.client_order_id,
      symbol: data.symbol,
      side: data.side,
      quantity: Number(data.qty),
      status: data.status,
      filledQty: data.filled_qty != null ? Number(data.filled_qty) : undefined,
      filledAvgPrice:
        data.filled_avg_price != null ? Number(data.filled_avg_price) : null,
    };
  }

  async cancelOrder(
    creds: BrokerCredentials,
    orderId: string,
    _symbol: string,
  ): Promise<void> {
    await this.request(creds, 'DELETE', `/v2/orders/${orderId}`);
  }

  async getPositions(creds: BrokerCredentials): Promise<BrokerPosition[]> {
    const data = await this.request(creds, 'GET', '/v2/positions');
    return (data as any[]).map((p) => ({
      symbol: p.symbol,
      quantity: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      marketValue: Number(p.market_value),
      unrealizedPnl: Number(p.unrealized_pl),
    }));
  }

  async getAccountBalance(
    creds: BrokerCredentials,
  ): Promise<{ cash: number; equity: number }> {
    const data = await this.request(creds, 'GET', '/v2/account');
    return { cash: Number(data.cash), equity: Number(data.equity) };
  }

  private async request(
    creds: BrokerCredentials,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const baseUrl = creds.mode === 'live' ? LIVE_URL : PAPER_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'APCA-API-KEY-ID': creds.apiKey,
          'APCA-API-SECRET-KEY': creds.apiSecret,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || /aborted/i.test(error.message));
      throw new ServiceUnavailableException(
        aborted
          ? `Alpaca ${method} ${path} timed out after 15s`
          : `Alpaca ${method} ${path} network error: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = `Alpaca ${method} ${path} failed: ${res.status} ${text}`;
      // Validation rejections (bad price/qty) should not leave permanent failed rows.
      if (res.status === 400 || res.status === 422) {
        throw new BadRequestException(message);
      }
      throw new ServiceUnavailableException(message);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }
}
