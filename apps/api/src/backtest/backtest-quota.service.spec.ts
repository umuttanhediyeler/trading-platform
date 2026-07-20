import { HttpStatus } from '@nestjs/common';
import { BacktestQuotaService } from './backtest-quota.service';

describe('BacktestQuotaService', () => {
  const ledger = {
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const tx = {
    $executeRaw: jest.fn(),
    backtestQuotaLedger: ledger,
  };
  const prisma = {
    backtestQuotaLedger: ledger,
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const entitlements = { getLimit: jest.fn() };
  let service: BacktestQuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BacktestQuotaService(prisma as never, entitlements as never);
  });

  it('atomically reserves and audits a Basic run', async () => {
    entitlements.getLimit.mockResolvedValue(20);
    ledger.count.mockResolvedValue(3);
    ledger.create.mockResolvedValue({ id: 'quota-1' });

    await expect(
      service.reserve('user-1', 'basic', {
        strategyId: 'sma_cross',
        symbol: 'aapl',
      }),
    ).resolves.toBe('quota-1');

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(ledger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        strategyId: 'sma_cross',
        symbol: 'AAPL',
        periodStart: expect.any(Date),
      }),
    });
  });

  it('rejects a Basic run when the configured limit is reached', async () => {
    entitlements.getLimit.mockResolvedValue(2);
    ledger.count.mockResolvedValue(2);

    const request = service.reserve('user-1', 'basic', {
        strategyId: 'sma_cross',
        symbol: 'AAPL',
      });
    await expect(request).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(ledger.create).not.toHaveBeenCalled();
  });

  it('keeps Premium unlimited without creating quota reservations', async () => {
    entitlements.getLimit.mockResolvedValue(Number.POSITIVE_INFINITY);

    await expect(
      service.reserve('user-1', 'premium', {
        strategyId: 'sma_cross',
        symbol: 'AAPL',
      }),
    ).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retains failed attempts in the audit ledger', async () => {
    ledger.update.mockResolvedValue({});
    await service.fail('quota-1', new Error('engine unavailable'));
    expect(ledger.update).toHaveBeenCalledWith({
      where: { id: 'quota-1' },
      data: { status: 'failed', failureReason: 'engine unavailable' },
    });
  });
});
