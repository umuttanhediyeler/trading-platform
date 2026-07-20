CREATE TABLE "BacktestQuotaLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "strategyId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacktestQuotaLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BacktestQuotaLedger_userId_periodStart_idx"
ON "BacktestQuotaLedger"("userId", "periodStart");

CREATE INDEX "BacktestQuotaLedger_status_createdAt_idx"
ON "BacktestQuotaLedger"("status", "createdAt");

ALTER TABLE "BacktestQuotaLedger"
ADD CONSTRAINT "BacktestQuotaLedger_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Entitlement" ("id", "planTier", "key", "value")
VALUES
    ('entitlement-backtest-limit-free', 'free', 'backtest_monthly_limit', '0'),
    ('entitlement-backtest-limit-basic', 'basic', 'backtest_monthly_limit', '20'),
    ('entitlement-backtest-limit-premium', 'premium', 'backtest_monthly_limit', 'unlimited')
ON CONFLICT ("planTier", "key") DO NOTHING;
