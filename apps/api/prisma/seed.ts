import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PREMIUM_EMAIL = 'premium.deneme@apexscan.dev';
const DEMO_PREMIUM_PASSWORD = 'Premium123!';

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

async function seedDemoPremiumUser() {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_PREMIUM_EMAIL },
    select: { id: true },
  });
  if (existing) {
    // Never reset balances, orders, or risk history on re-seed.
    const passwordHash = await bcrypt.hash(DEMO_PREMIUM_PASSWORD, 10);
    await prisma.user.update({
      where: { email: DEMO_PREMIUM_EMAIL },
      data: {
        passwordHash,
        provider: 'credentials',
        subscription: {
          upsert: {
            create: { planTier: 'premium', status: 'active' },
            update: { planTier: 'premium', status: 'active' },
          },
        },
        simAccount: {
          upsert: {
            create: { balance: 100_000 },
            update: {},
          },
        },
        riskSettings: {
          upsert: {
            create: {
              maxRiskPerTrade: 2.5,
              maxDailyTrades: 12,
              maxDailyLossPercent: 3,
            },
            update: {},
          },
        },
      },
    });
    console.log(`Refreshed demo premium login for: ${DEMO_PREMIUM_EMAIL}`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PREMIUM_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email: DEMO_PREMIUM_EMAIL,
      passwordHash,
      provider: 'credentials',
      executionMode: 'full_auto',
      subscription: { create: { planTier: 'premium', status: 'active' } },
      simAccount: { create: { balance: 100_000 } },
      riskSettings: {
        create: {
          maxRiskPerTrade: 2.5,
          maxDailyTrades: 12,
          maxDailyLossPercent: 3,
        },
      },
    },
  });
  console.log(`Seeded demo premium user: ${DEMO_PREMIUM_EMAIL}`);
}

async function main() {
  for (const e of ENTITLEMENTS) {
    await prisma.entitlement.upsert({
      where: { planTier_key: { planTier: e.planTier, key: e.key } },
      update: { value: e.value },
      create: e,
    });
  }
  console.log(`Seeded ${ENTITLEMENTS.length} entitlements.`);

  await seedDemoPremiumUser();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
