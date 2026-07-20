import { describe, expect, it } from 'vitest';
import { RateLimiter, chunk, mapWithConcurrency } from './batching';

describe('chunk', () => {
  it('splits into consecutive chunks of at most `size`', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('rejects non-positive sizes', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the concurrency bound', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return i * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('returns per-item ok/error results in input order', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (i) => {
      if (i === 2) throw new Error('boom');
      return i * 10;
    });
    expect(results).toEqual([
      { item: 1, ok: true, value: 10 },
      { item: 2, ok: false, error: new Error('boom') },
      { item: 3, ok: true, value: 30 },
    ]);
  });

  it('rejects invalid concurrency', async () => {
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(
      RangeError,
    );
  });
});

describe('RateLimiter', () => {
  it('allows a burst up to maxRequests without waiting', async () => {
    const limiter = new RateLimiter({ maxRequests: 5, perMs: 60_000 });
    const start = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('delays acquisitions beyond the window budget', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, perMs: 120 });
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire(); // must wait for the first slot to expire
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  it('rejects invalid configuration', () => {
    expect(() => new RateLimiter({ maxRequests: 0, perMs: 1000 })).toThrow(
      RangeError,
    );
    expect(() => new RateLimiter({ maxRequests: 1, perMs: 0 })).toThrow(
      RangeError,
    );
  });
});
