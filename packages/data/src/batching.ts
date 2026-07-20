/**
 * Provider-safe bulk fetch primitives: chunking, bounded-concurrency mapping
 * and a sliding-window rate limiter. Framework-free so both the API and any
 * script/worker can reuse them.
 */

/** Splits `items` into consecutive chunks of at most `size` elements. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export type SettledResult<T, R> =
  | { item: T; ok: true; value: R }
  | { item: T; ok: false; error: unknown };

/**
 * Maps `items` through an async `fn` with at most `concurrency` calls in
 * flight at once. Never rejects: each item resolves to an ok/error record,
 * in input order, so one failing symbol cannot sink a whole batch.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<SettledResult<T, R>>> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError(
      `concurrency must be a positive integer, got ${concurrency}`,
    );
  }
  const results: Array<SettledResult<T, R>> = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index]!;
      try {
        results[index] = { item, ok: true, value: await fn(item, index) };
      } catch (error) {
        results[index] = { item, ok: false, error };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export interface RateLimiterOptions {
  /** Maximum number of acquisitions inside any sliding window. */
  maxRequests: number;
  /** Window length in milliseconds. */
  perMs: number;
}

/**
 * Sliding-window rate limiter. `acquire()` resolves immediately while under
 * budget and otherwise waits until the oldest request leaves the window.
 * Callers `await limiter.acquire()` before each provider request.
 */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly perMs: number;
  private timestamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests <= 0) {
      throw new RangeError(
        `maxRequests must be a positive integer, got ${options.maxRequests}`,
      );
    }
    if (!Number.isFinite(options.perMs) || options.perMs <= 0) {
      throw new RangeError(`perMs must be positive, got ${options.perMs}`);
    }
    this.maxRequests = options.maxRequests;
    this.perMs = options.perMs;
  }

  /** Resolves when the caller may issue one request. FIFO-fair. */
  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.waitForSlot());
    // Serialize acquisitions so waiters are granted slots in call order.
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.perMs);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0]!;
      const waitMs = Math.max(1, oldest + this.perMs - now);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
