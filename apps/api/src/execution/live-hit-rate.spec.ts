import { computeLiveHitRate } from './live-hit-rate';

describe('computeLiveHitRate', () => {
  it('pauses entries when hit rate is below 45% with enough samples', async () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ status: 'hit_target' })),
      ...Array.from({ length: 30 }, () => ({ status: 'hit_stop' })),
    ];
    const prisma = {
      signal: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const snap = await computeLiveHitRate(prisma as never);
    expect(snap.hitRate).toBeCloseTo(0.25, 5);
    expect(snap.entriesPaused).toBe(true);
  });

  it('does not pause when hit rate is at or above 45%', async () => {
    const rows = [
      ...Array.from({ length: 45 }, () => ({ status: 'hit_target' })),
      ...Array.from({ length: 55 }, () => ({ status: 'hit_stop' })),
    ];
    const prisma = {
      signal: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const snap = await computeLiveHitRate(prisma as never);
    expect(snap.hitRate).toBeCloseTo(0.45, 5);
    expect(snap.entriesPaused).toBe(false);
  });

  it('does not pause when sample is too small', async () => {
    const rows = [
      { status: 'hit_target' },
      { status: 'hit_stop' },
      { status: 'hit_stop' },
    ];
    const prisma = {
      signal: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const snap = await computeLiveHitRate(prisma as never);
    expect(snap.entriesPaused).toBe(false);
  });
});
