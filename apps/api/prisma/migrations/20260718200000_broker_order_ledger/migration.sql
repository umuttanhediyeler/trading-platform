-- CreateTable
CREATE TABLE "BrokerOrderLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "brokerOrderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "orderType" TEXT NOT NULL,
    "limitPrice" DECIMAL(65,30),
    "source" TEXT NOT NULL,
    "signalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "brokerStatus" TEXT,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "failureReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerOrderLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrokerOrderLedger_userId_clientOrderId_key"
ON "BrokerOrderLedger"("userId", "clientOrderId");

-- CreateIndex
CREATE INDEX "BrokerOrderLedger_userId_createdAt_idx"
ON "BrokerOrderLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BrokerOrderLedger_status_updatedAt_idx"
ON "BrokerOrderLedger"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "BrokerOrderLedger"
ADD CONSTRAINT "BrokerOrderLedger_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "RiskSettings"
ADD COLUMN "killSwitchReason" TEXT,
ADD COLUMN "killSwitchAt" TIMESTAMP(3);
