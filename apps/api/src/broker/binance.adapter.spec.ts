import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { BinanceAdapter } from './binance.adapter';
import { BrokerCredentials } from './broker-adapter.interface';

describe('BinanceAdapter', () => {
  const credentials: BrokerCredentials = {
    broker: 'binance',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    mode: 'paper',
  };
  const exchangeInfo = {
    symbols: [
      {
        symbol: 'BTCUSDT',
        status: 'TRADING',
        isSpotTradingAllowed: true,
        orderTypes: ['MARKET', 'LIMIT'],
        filters: [
          {
            filterType: 'LOT_SIZE',
            minQty: '0.00100000',
            maxQty: '100.00000000',
            stepSize: '0.00100000',
          },
          {
            filterType: 'MARKET_LOT_SIZE',
            minQty: '0.00100000',
            maxQty: '100.00000000',
            stepSize: '0.00100000',
          },
          {
            filterType: 'PRICE_FILTER',
            minPrice: '0.01000000',
            maxPrice: '1000000.00000000',
            tickSize: '0.01000000',
          },
        ],
      },
    ],
  };

  let adapter: BinanceAdapter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    adapter = new BinanceAdapter();
    fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(exchangeInfo),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            symbol: 'BTCUSDT',
            orderId: 42,
            clientOrderId: 'client-1',
            side: 'BUY',
            origQty: '0.010',
            executedQty: '0.010',
            cummulativeQuoteQty: '600',
            status: 'FILLED',
          }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs and submits a paper Spot order to Binance testnet', async () => {
    await expect(
      adapter.placeOrder(credentials, {
        symbol: 'btc-usdt',
        side: 'buy',
        quantity: 0.01,
        type: 'limit',
        limitPrice: 60_000,
        clientOrderId: 'client-1',
      }),
    ).resolves.toMatchObject({
      id: '42',
      clientOrderId: 'client-1',
      symbol: 'BTCUSDT',
      filledAvgPrice: 60_000,
    });

    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://testnet.binance.vision');
    expect(options.headers).toEqual({ 'X-MBX-APIKEY': 'test-key' });
    const signature = parsed.searchParams.get('signature');
    parsed.searchParams.delete('signature');
    expect(signature).toBe(
      createHmac('sha256', 'test-secret')
        .update(parsed.searchParams.toString())
        .digest('hex'),
    );
    expect(url).not.toContain('test-secret');
  });

  it('rejects unsupported bracket semantics before making a request', async () => {
    await expect(
      adapter.placeOrder(credentials, {
        symbol: 'BTCUSDT',
        side: 'buy',
        quantity: 0.01,
        type: 'market',
        clientOrderId: 'client-2',
        orderClass: 'bracket',
        takeProfitPrice: 70_000,
        stopLossPrice: 50_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects quantities that do not match the exchange lot size', async () => {
    await expect(
      adapter.placeOrder(credentials, {
        symbol: 'BTCUSDT',
        side: 'buy',
        quantity: 0.0015,
        type: 'market',
        clientOrderId: 'client-3',
      }),
    ).rejects.toThrow(/multiple/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
