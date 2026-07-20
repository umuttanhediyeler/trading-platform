import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_MS = 60_000;

/**
 * Reads the Entitlement table (planTier, key, value) with a short in-memory
 * cache. Values are stored as strings ("true" | "false" | "50" | "unlimited")
 * and parsed here.
 */
@Injectable()
export class EntitlementsService {
  private cache: Map<string, string> | null = null;
  private cacheLoadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async getValue(planTier: string, key: string): Promise<string | undefined> {
    const map = await this.loadAll();
    return map.get(`${planTier}:${key}`);
  }

  async isEnabled(planTier: string, key: string): Promise<boolean> {
    return (await this.getValue(planTier, key)) === 'true';
  }

  async getLimit(planTier: string, key: string): Promise<number> {
    const value = await this.getValue(planTier, key);
    if (value === undefined) return 0;
    if (value === 'unlimited') return Number.POSITIVE_INFINITY;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  invalidateCache() {
    this.cache = null;
  }

  private async loadAll(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.cache && now - this.cacheLoadedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const rows = await this.prisma.entitlement.findMany();
    this.cache = new Map(rows.map((r) => [`${r.planTier}:${r.key}`, r.value]));
    this.cacheLoadedAt = now;
    return this.cache;
  }
}
