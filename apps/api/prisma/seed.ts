import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Entitlement matrix per plan tier (mirrors the pricing table in the master prompt).
 * Values are strings and parsed in the service layer.
 */
const ENTITLEMENTS: Array<{ planTier: string; key: string; value: string }> = [
  // Free
  { planTier: 'free', key: 'ai_signals_enabled', value: 'false' },
  { planTier: 'free', key: 'auto_trade_enabled', value: 'false' },
  { planTier: 'free', key: 'one_click_enabled', value: 'false' },
  { planTier: 'free', key: 'broker_enabled', value: 'false' },
  { planTier: 'free', key: 'backtest_enabled', value: 'false' },
  { planTier: 'free', key: 'backtest_monthly_limit', value: '0' },
  { planTier: 'free', key: 'max_scan_filters', value: '5' },
  { planTier: 'free', key: 'max_watchlists', value: '3' },
  { planTier: 'free', key: 'realtime_data', value: 'false' },

  // Basic
  { planTier: 'basic', key: 'ai_signals_enabled', value: 'false' },
  { planTier: 'basic', key: 'auto_trade_enabled', value: 'false' },
  { planTier: 'basic', key: 'one_click_enabled', value: 'true' },
  { planTier: 'basic', key: 'broker_enabled', value: 'true' },
  { planTier: 'basic', key: 'backtest_enabled', value: 'true' },
  { planTier: 'basic', key: 'backtest_monthly_limit', value: '20' },
  { planTier: 'basic', key: 'max_scan_filters', value: 'unlimited' },
  { planTier: 'basic', key: 'max_watchlists', value: '20' },
  { planTier: 'basic', key: 'realtime_data', value: 'true' },

  // Premium
  { planTier: 'premium', key: 'ai_signals_enabled', value: 'true' },
  { planTier: 'premium', key: 'auto_trade_enabled', value: 'true' },
  { planTier: 'premium', key: 'one_click_enabled', value: 'true' },
  { planTier: 'premium', key: 'broker_enabled', value: 'true' },
  { planTier: 'premium', key: 'backtest_enabled', value: 'true' },
  { planTier: 'premium', key: 'backtest_monthly_limit', value: 'unlimited' },
  { planTier: 'premium', key: 'max_scan_filters', value: 'unlimited' },
  { planTier: 'premium', key: 'max_watchlists', value: '50' },
  { planTier: 'premium', key: 'realtime_data', value: 'true' },
];

async function main() {
  for (const e of ENTITLEMENTS) {
    await prisma.entitlement.upsert({
      where: { planTier_key: { planTier: e.planTier, key: e.key } },
      update: { value: e.value },
      create: e,
    });
  }
  console.log(`Seeded ${ENTITLEMENTS.length} entitlements.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
