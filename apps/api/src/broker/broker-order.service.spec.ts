import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { RiskGuardService } from '../execution/risk-guard.service';
import { PrismaService } from '../prisma/prisma.service';
import { BrokerAdapter, BrokerCredentials } from './broker-adapter.interface';
import { BrokerOrderService } from './broker-order.service';
import { BrokerRegistry } from './broker-registry.service';

describe('BrokerOrderService', () => {
  const credentials: BrokerCredentials = {
    broker: 'alpaca',
    apiKey: 'key',
    apiSecret: 'secret',
    mode: 'paper',
  };
  const request = {
    symbol: 'aapl',
    side: 'buy' as const,
    quantity: 2,
    type: 'market' as const,
    clientOrderId: 'order-123',
  };
  const response = {
    id: 'broker-1',
    clientOrderId: 'order-123',
    symbol: 'AAPL',
    side: 'buy',
    quantity: 2,
    status: 'accepted',
  };

  let prisma: {
    brokerOrderLedger: {
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let config: { get: jest.Mock };
  let riskGuard: {
    assertCanTrade: jest.Mock;
    assertBrokerOrderAllowed: jest.Mock;
  };
  let adapter: BrokerAdapter;
  let service: BrokerOrderService;

  beforeEach(() => {
    prisma = {
      brokerOrderLedger: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn(),
      },
    };
    config = { get: jest.fn((_key: string, fallback?: string) => fallback) };
    riskGuard = {
      assertCanTrade: jest.fn().mockResolvedValue(undefined),
      assertBrokerOrderAllowed: jest.fn().mockResolvedValue(undefined),
    };
    adapter = {
      name: 'alpaca',
      capabilities: {
        marketOrders: true,
        limitOrders: true,
        bracketOrders: true,
        fractionalQuantity: true,
        positions: 'full',
        paper: true,
        live: true,
      },
      placeOrder: jest.fn().mockResolvedValue(response),
      getOrderByClientOrderId: jest.fn().mockResolvedValue(response),
      cancelOrder: jest.fn(),
      getPositions: jest.fn(),
      getAccountBalance: jest.fn(),
    };
    service = new BrokerOrderService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      riskGuard as unknown as RiskGuardService,
      { get: jest.fn().mockReturnValue(adapter) } as unknown as BrokerRegistry,
    );
  });

  it('reserves the idempotency key before risk checks and broker submission', async () => {
    const events: string[] = [];
    prisma.brokerOrderLedger.create.mockImplementation(async () => {
      events.push('reserve');
    });
    riskGuard.assertCanTrade.mockImplementation(async () => {
      events.push('risk');
    });
    riskGuard.assertBrokerOrderAllowed.mockImplementation(async () => {
      events.push('broker-risk');
    });
    (adapter.placeOrder as jest.Mock).mockImplementation(async () => {
      events.push('broker');
      return response;
    });

    await expect(
      service.submit('user-1', credentials, request, { source: 'one_click' }),
    ).resolves.toEqual(response);
    expect(events).toEqual(['reserve', 'risk', 'broker-risk', 'broker']);
    expect(prisma.brokerOrderLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brokerOrderId: 'broker-1',
          status: 'submitted',
        }),
      }),
    );
  });

  it('returns the prior response without another risk check or broker call', async () => {
    prisma.brokerOrderLedger.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    prisma.brokerOrderLedger.findUniqueOrThrow.mockResolvedValue({
      status: 'submitted',
      responsePayload: response,
    });

    await expect(
      service.submit('user-1', credentials, request, { source: 'one_click' }),
    ).resolves.toEqual(response);
    expect(riskGuard.assertCanTrade).not.toHaveBeenCalled();
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });

  it('rejects a duplicate key whose original submission is unresolved', async () => {
    prisma.brokerOrderLedger.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    prisma.brokerOrderLedger.findUniqueOrThrow.mockResolvedValue({
      status: 'pending',
      responsePayload: null,
    });

    await expect(
      service.submit('user-1', credentials, request, { source: 'one_click' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps full-auto paper-only unless both live gates are enabled', async () => {
    const live = { ...credentials, mode: 'live' as const };
    config.get.mockImplementation((key: string, fallback?: string) =>
      key === 'ALLOW_LIVE_BROKER' ? 'true' : fallback,
    );

    await expect(
      service.submit('user-1', live, request, {
        source: 'full_auto',
        allowAutomatedLive: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.brokerOrderLedger.create).not.toHaveBeenCalled();
  });

  it('records failures and never retries a consumed client order id', async () => {
    (adapter.placeOrder as jest.Mock).mockRejectedValue(new Error('timeout'));

    await expect(
      service.submit('user-1', credentials, request, { source: 'one_click' }),
    ).rejects.toThrow('timeout');
    expect(prisma.brokerOrderLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          failureReason: 'timeout',
        }),
      }),
    );
  });
});
