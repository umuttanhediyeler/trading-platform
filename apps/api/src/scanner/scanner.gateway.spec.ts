import { ScannerGateway } from './scanner.gateway';

describe('ScannerGateway', () => {
  it('emits scan results only to the authenticated user room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new ScannerGateway({} as never, {} as never);
    gateway.server = { to } as never;
    const rows = [
      {
        symbol: 'AAPL',
        price: 100,
        changePercent: 1,
        volume: 1_000,
        volumeRatio: 2,
        rsi14: 55,
        gapPercent: 0.5,
        priceVsVwap: 1.2,
        values: { volume_ratio: 2 },
        matchedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    gateway.emitScanResult('user-1', 'scan-1', rows);

    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith('scan:result', {
      scanId: 'scan-1',
      rows,
    });
  });
});
