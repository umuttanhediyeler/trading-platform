import { ForbiddenException } from '@nestjs/common';
import { RiskGuardService } from '../src/execution/risk-guard.service';

describe('RiskGuardService', () => {
  const gateway = { emitKillSwitchTriggered: jest.fn() };

  function buildService(overrides: {
    settings?: Partial<{
      killSwitchActive: boolean;
      maxDailyTrades: number;
      maxDailyLossPercent: number;
    }>;
    todayOrders?: Array<{ pnl: number | null }>;
    brokerOrderCount?: number;
    balance?: number;
  }) {
    const settings = {
      userId: 'u1',
      killSwitchActive: false,
      maxDailyTrades: 5,
      maxDailyLossPercent: 2.0,
      maxRiskPerTrade: 1.0,
      ...overrides.settings,
    };
    const prisma = {
      riskSettings: {
        upsert: jest.fn(async () => settings),
      },
      simulatedAccount: {
        findUnique: jest.fn(async () => ({
          id: 'acct-1',
          userId: 'u1',
          balance: overrides.balance ?? 100_000,
        })),
      },
      simulatedOrder: {
        findMany: jest.fn(async () => overrides.todayOrders ?? []),
      },
      brokerOrderLedger: {
        count: jest.fn(async () => overrides.brokerOrderCount ?? 0),
      },
      user: { update: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as any)),
    };
    const config = { get: jest.fn(() => undefined) };
    return {
      service: new RiskGuardService(prisma as any, gateway as any, config as any),
      prisma,
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('allows trading under normal conditions', async () => {
    const { service } = buildService({});
    await expect(service.assertCanTrade('u1')).resolves.toBeUndefined();
  });

  it('blocks trading while the kill switch is active', async () => {
    const { service } = buildService({
      settings: { killSwitchActive: true },
    });
    await expect(service.assertCanTrade('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks trading when the daily trade limit is reached', async () => {
    const { service } = buildService({
      settings: { maxDailyTrades: 2 },
      todayOrders: [{ pnl: null }, { pnl: null }],
    });
    await expect(service.assertCanTrade('u1')).rejects.toThrow(
      /Daily trade limit/,
    );
  });

  it('counts the current pending broker reservation without losing the final slot', async () => {
    const { service } = buildService({
      settings: { maxDailyTrades: 2 },
      brokerOrderCount: 2,
    });
    await expect(
      service.assertCanTrade('u1', { includesPendingReservation: true }),
    ).resolves.toBeUndefined();
  });

  it('blocks concurrent broker reservations beyond the daily limit', async () => {
    const { service } = buildService({
      settings: { maxDailyTrades: 2 },
      brokerOrderCount: 3,
    });
    await expect(
      service.assertCanTrade('u1', { includesPendingReservation: true }),
    ).rejects.toThrow(/Daily trade limit/);
  });

  it('trips the kill switch when the daily loss limit is breached', async () => {
    // 2% of 100k = 2000; realized loss of 2500 breaches the limit.
    const { service, prisma } = buildService({
      todayOrders: [{ pnl: -2500 }],
      balance: 100_000,
    });
    await expect(service.assertCanTrade('u1')).rejects.toThrow(
      /kill switch activated/,
    );
    // Kill switch persisted and user dropped back to manual mode.
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(gateway.emitKillSwitchTriggered).toHaveBeenCalledWith(
      'u1',
      expect.stringContaining('Daily loss limit'),
    );
  });

  it('does not trip the kill switch on small losses', async () => {
    const { service } = buildService({
      todayOrders: [{ pnl: -500 }],
      balance: 100_000,
    });
    await expect(service.assertCanTrade('u1')).resolves.toBeUndefined();
    expect(gateway.emitKillSwitchTriggered).not.toHaveBeenCalled();
  });
});
