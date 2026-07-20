import { AlpacaAdapter, formatAlpacaPrice } from './alpaca.adapter';
import { BrokerCredentials } from './broker-adapter.interface';

describe('AlpacaAdapter', () => {
  const credentials: BrokerCredentials = {
    broker: 'alpaca',
    apiKey: 'key',
    apiSecret: 'secret',
    mode: 'paper',
  };

  let adapter: AlpacaAdapter;
  let fetchMock: jest.Mock;

  const orderResponse = {
    id: 'broker-1',
    client_order_id: 'signal-1:user-1',
    symbol: 'AAPL',
    side: 'buy',
    qty: '5',
    status: 'accepted',
    filled_qty: '0',
    filled_avg_price: null,
  };

  beforeEach(() => {
    adapter = new AlpacaAdapter();
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => orderResponse,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('rounds bracket prices to Alpaca tick size', async () => {
    await adapter.placeOrder(credentials, {
      symbol: 'MSFT',
      side: 'buy',
      quantity: 1,
      type: 'market',
      clientOrderId: 'round-test',
      orderClass: 'bracket',
      takeProfitPrice: 334.5753,
      stopLossPrice: 318.1234,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.take_profit).toEqual({ limit_price: '334.58' });
    expect(body.stop_loss).toEqual({ stop_price: '318.12' });
  });

  it('submits a bracket order with take-profit and stop-loss legs', async () => {
    const order = await adapter.placeOrder(credentials, {
      symbol: 'AAPL',
      side: 'buy',
      quantity: 5,
      type: 'market',
      clientOrderId: 'signal-1:user-1',
      orderClass: 'bracket',
      takeProfitPrice: 110,
      stopLossPrice: 95,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/orders',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      symbol: 'AAPL',
      qty: '5',
      side: 'buy',
      type: 'market',
      client_order_id: 'signal-1:user-1',
      order_class: 'bracket',
      take_profit: { limit_price: '110' },
      stop_loss: { stop_price: '95' },
    });
    expect(order).toMatchObject({
      id: 'broker-1',
      clientOrderId: 'signal-1:user-1',
      quantity: 5,
    });
  });

  it('rejects a bracket order missing take-profit or stop-loss', async () => {
    await expect(
      adapter.placeOrder(credentials, {
        symbol: 'AAPL',
        side: 'buy',
        quantity: 5,
        type: 'market',
        clientOrderId: 'signal-1:user-1',
        orderClass: 'bracket',
        takeProfitPrice: 110,
      }),
    ).rejects.toThrow('Bracket orders require');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits bracket fields for plain orders', async () => {
    await adapter.placeOrder(credentials, {
      symbol: 'AAPL',
      side: 'buy',
      quantity: 5,
      type: 'market',
      clientOrderId: 'signal-1:user-1',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.order_class).toBeUndefined();
    expect(body.take_profit).toBeUndefined();
    expect(body.stop_loss).toBeUndefined();
  });
});

describe('formatAlpacaPrice', () => {
  it('rounds to penny for prices at or above $1', () => {
    expect(formatAlpacaPrice(334.5753)).toBe('334.58');
    expect(formatAlpacaPrice(110)).toBe('110.00');
  });

  it('rounds to 4 decimals for sub-dollar prices', () => {
    expect(formatAlpacaPrice(0.12345)).toBe('0.1235');
  });
});
