import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Always Free VMs report 1 CPU → Prisma's default pool is
 * `num_cpus * 2 + 1 = 3`, which starves under workers + API traffic.
 * Behind Supabase PgBouncer we keep a moderate client pool and fail
 * fast so HTTP (login/nav) is not stuck behind worker queries.
 */
function datasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    // Force known-good pool settings (override stale env values).
    url.searchParams.set(
      'connection_limit',
      process.env.PRISMA_CONNECTION_LIMIT ?? '20',
    );
    url.searchParams.set(
      'pool_timeout',
      process.env.PRISMA_POOL_TIMEOUT ?? '10',
    );
    return url.toString();
  } catch {
    return raw;
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = datasourceUrl();
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
