import { ConfigService } from '@nestjs/config';
import { BrokerAdapter, BrokerCredentials } from '../broker/broker-adapter.interface';
import { BrokerRegistry } from '../broker/broker-registry.service';
import { encryptSecret } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionGateway } from './execution.gateway';
import { RiskGuardService } from './risk-guard.service';

describe('RiskGuardService (broker-aware)', () => {
  const encryptionKey = 'a'.repeat(64);
  const credentials: BrokerCredentials = {
    broker: 'alpaca',
    apiKey: 'key',
    apiSecret: 'secret',
    mode: 'paper',
  };
  const baseSettings = {
    userId: 'user-1',
    maxDailyTrades: 5,
    maxDailyLossPercent: 2,
    maxRiskPerTrade: 1,
    killSwitchActive: false,
  };

  let prisma: {
    riskSettings: { upsert: jest.Mock };
    brokerOrderLedger: { findMany: jest.Mock; update: jest.Mock; create: jest.Mock };
    brokerLink: { findUnique: jest.Mock };
    user: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let gateway: { emitKillSwitchTriggered: jest.Mock };
  let config: { get: jest.Mock };
  let adapter: BrokerAdapter;
  let service: RiskGuardService;

  /** where.brokerStatus === 'filled' → today's fills; otherwise open orders. */
  let openLedgerOrders: any[];
  let filledLedgerOrders: any[];

  const configValues: Record<string, string> = {
    ENCRYPTION_KEY: encryptionKey,
  };

  beforeEach(() => {
    openLedgerOrders = [];
    filledLedgerOrders = [];
    prisma = {
      riskSettings: { upsert: jest.fn().mockResolvedValue(baseSettings) },
      brokerOrderLedger: {
        findMany: jest.fn().mockImplementation(async ({ where }) =>
          where.brokerStatus === 'filled' ? filledLedgerOrders : openLedgerOrders,
        ),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      brokerLink: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    gateway = { emitKillSwitchTriggered: jest.fn() };
    config = {
      get: jest.fn(
        (key: string, fallback?: string) => configValues[key] ?? fallback,
      ),
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
      placeOrder: jest.fn().mockResolvedValue({ id: 'flat-1', status: 'accepted' }),
      getOrderByClientOrderId: jest.fn(),
      cancelOrder: jest.fn().mockResolvedValue(undefined),
      getPositions: jest.fn().mockResolvedValue([]),
      getAccountBalance: jest
        .fn()
        .mockResolvedValue({ cash: 10_000, equity: 10_000 }),
    };
    service = new RiskGuardService(
      prisma as unknown as PrismaService,
      gateway as unknown as ExecutionGateway,
      config as unknown as ConfigService,
      {
        get: jest.fn().mockReturnValue(adapter),
        isSupported: jest.fn().mockReturnValue(true),
      } as unknown as BrokerRegistry,
    );
  });

  describe('assertBrokerOrderAllowed', () => {
    it('rejects an order whose stop-based risk exceeds maxRiskPerTrade% of equity', async () => {
      // 10 shares * $20 stop distance = $200 risk > 1% of $10,000 = $100.
      await expect(
        service.assertBrokerOrderAllowed('user-1', credentials, {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 10,
          type: 'market',
          clientOrderId: 'c-1',
          entryPriceHint: 100,
          stopLossPrice: 80,
        }),
      ).rejects.toThrow(/Per-trade risk/);
    });

    it('rejects an order that would push total exposure past the cap', async () => {
      // Cap: 50% of $10,000 = $5,000. Positions $3,000 + open order $1,500
      // + new order $1,000 = $5,500.
      (adapter.getPositions as jest.Mock).mockResolvedValue([
        { symbol: 'MSFT', quantity: 10, avgEntryPrice: 300, marketValue: 3000, unrealizedPnl: 0 },
      ]);
      openLedgerOrders = [
        {
          id: 'l-1',
          symbol: 'AAPL',
          clientOrderId: 'other-1',
          quantity: 10,
          limitPrice: 150,
          requestPayload: {},
        },
      ];

      await expect(
        service.assertBrokerOrderAllowed('user-1', credentials, {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 10,
          type: 'market',
          clientOrderId: 'c-2',
          entryPriceHint: 100,
        }),
      ).rejects.toThrow(/Total exposure/);
    });

    it('allows an order within per-trade risk and exposure limits', async () => {
      await expect(
        service.assertBrokerOrderAllowed('user-1', credentials, {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 5,
          type: 'market',
          clientOrderId: 'c-3',
          entryPriceHint: 100,
          stopLossPrice: 90,
        }),
      ).resolves.toBeUndefined();
    });

    it('trips the kill switch when daily broker fills breach the loss limit', async () => {
      // Buy 10 @ 100, sell 10 @ 70 → -$300 = 3% of equity ≥ 2% limit.
      filledLedgerOrders = [
        {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 10,
          responsePayload: { filledAvgPrice: 100, filledQty: 10 },
        },
        {
          symbol: 'AAPL',
          side: 'sell',
          quantity: 10,
          responsePayload: { filledAvgPrice: 70, filledQty: 10 },
        },
      ];

      await expect(
        service.assertBrokerOrderAllowed('user-1', credentials, {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          type: 'market',
          clientOrderId: 'c-4',
          entryPriceHint: 100,
        }),
      ).rejects.toThrow(/Daily broker loss limit/);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(gateway.emitKillSwitchTriggered).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('Daily broker loss limit'),
      );
    });

    it('degrades to a no-op when the broker account is unreachable', async () => {
      (adapter.getAccountBalance as jest.Mock).mockRejectedValue(
        new Error('credentials invalid'),
      );

      await expect(
        service.assertBrokerOrderAllowed('user-1', credentials, {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1_000_000,
          type: 'market',
          clientOrderId: 'c-5',
          entryPriceHint: 100,
          stopLossPrice: 1,
        }),
      ).resolves.toBeUndefined();
      expect(prisma.riskSettings.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op when no broker adapter is wired', async () => {
      const bare = new RiskGuardService(
        prisma as unknown as PrismaService,
        gateway as unknown as ExecutionGateway,
        config as unknown as ConfigService,
      );
      await expect(
        bare.assertBrokerOrderAllowed('user-1', credentials, {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 10,
          type: 'market',
          clientOrderId: 'c-6',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('triggerKillSwitch', () => {
    beforeEach(() => {
      prisma.brokerLink.findUnique.mockResolvedValue({
        userId: 'user-1',
        broker: 'alpaca',
        mode: 'paper',
        apiKeyEnc: encryptSecret('key', encryptionKey),
        apiSecretEnc: encryptSecret('secret', encryptionKey),
      });
    });

    it('cancels open ledger orders at the broker and marks them canceled', async () => {
      openLedgerOrders = [
        {
          id: 'l-1',
          symbol: 'AAPL',
          clientOrderId: 'c-1',
          brokerOrderId: 'b-1',
          quantity: 1,
          requestPayload: {},
        },
        {
          id: 'l-2',
          symbol: 'AAPL',
          clientOrderId: 'c-2',
          brokerOrderId: null,
          quantity: 1,
          requestPayload: {},
        },
      ];
      (adapter.getOrderByClientOrderId as jest.Mock).mockResolvedValue({
        id: 'b-2',
        status: 'new',
      });

      await service.triggerKillSwitch('user-1', 'manual stop');

      expect(adapter.cancelOrder).toHaveBeenCalledTimes(2);
      expect(adapter.cancelOrder).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'key', apiSecret: 'secret' }),
        'b-1',
        'AAPL',
      );
      expect(adapter.cancelOrder).toHaveBeenCalledWith(
        expect.anything(),
        'b-2',
        'AAPL',
      );
      expect(prisma.brokerOrderLedger.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l-1' },
          data: expect.objectContaining({
            status: 'canceled',
            brokerStatus: 'canceled',
          }),
        }),
      );
      expect(prisma.brokerOrderLedger.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l-2' },
          data: expect.objectContaining({ status: 'canceled', brokerOrderId: 'b-2' }),
        }),
      );
      // Flatten stays off by default.
      expect(adapter.placeOrder).not.toHaveBeenCalled();
    });

    it('still flips the DB kill switch when broker cancellation fails', async () => {
      openLedgerOrders = [
        {
          id: 'l-1',
          symbol: 'AAPL',
          clientOrderId: 'c-1',
          brokerOrderId: 'b-1',
          quantity: 1,
          requestPayload: {},
        },
      ];
      (adapter.cancelOrder as jest.Mock).mockRejectedValue(new Error('down'));

      await expect(
        service.triggerKillSwitch('user-1', 'manual stop'),
      ).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(gateway.emitKillSwitchTriggered).toHaveBeenCalled();
    });

    it('flattens open positions only when KILL_SWITCH_FLATTEN=true', async () => {
      configValues.KILL_SWITCH_FLATTEN = 'true';
      (adapter.getPositions as jest.Mock).mockResolvedValue([
        { symbol: 'AAPL', quantity: 7, avgEntryPrice: 100, marketValue: 700, unrealizedPnl: 0 },
      ]);

      await service.triggerKillSwitch('user-1', 'manual stop');

      expect(adapter.placeOrder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          symbol: 'AAPL',
          side: 'sell',
          quantity: 7,
          type: 'market',
        }),
      );
      delete configValues.KILL_SWITCH_FLATTEN;
    });
  });
});
