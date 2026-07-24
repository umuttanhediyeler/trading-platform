import { PrismaService } from '../prisma/prisma.service';

/** Matches the Models UI: last N decisive outcomes only (expired excluded). */
export const LIVE_HIT_RATE_SAMPLE = 100;

/** Pause new buys below this floor; resume at/above it. */
export const ENTRY_PAUSE_HIT_RATE = 0.45;

/** Do not pause on a tiny sample — wait for enough decisive outcomes. */
export const ENTRY_PAUSE_MIN_SAMPLES = 20;

export type LiveHitRateSnapshot = {
  hits: number;
  stops: number;
  sampleSize: number;
  hitRate: number | null;
  /** True when sample is large enough and hit rate is strictly below the floor. */
  entriesPaused: boolean;
};

/**
 * Rolling live hit rate used for entry pause / resume.
 * Same definition as the dashboard: hit_target / (hit_target + hit_stop).
 */
export async function computeLiveHitRate(
  prisma: PrismaService,
  sampleSize = LIVE_HIT_RATE_SAMPLE,
  pauseFloor = ENTRY_PAUSE_HIT_RATE,
  minSamples = ENTRY_PAUSE_MIN_SAMPLES,
): Promise<LiveHitRateSnapshot> {
  const rows = await prisma.signal.findMany({
    where: { status: { in: ['hit_target', 'hit_stop'] } },
    orderBy: { resolvedAt: 'desc' },
    take: Math.max(1, sampleSize),
    select: { status: true },
  });
  const hits = rows.filter((r) => r.status === 'hit_target').length;
  const stops = rows.filter((r) => r.status === 'hit_stop').length;
  const decisive = hits + stops;
  const hitRate = decisive > 0 ? hits / decisive : null;
  const entriesPaused =
    hitRate != null && decisive >= minSamples && hitRate < pauseFloor;
  return {
    hits,
    stops,
    sampleSize: decisive,
    hitRate,
    entriesPaused,
  };
}
