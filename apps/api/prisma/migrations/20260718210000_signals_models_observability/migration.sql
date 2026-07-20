-- Persist every inference and its eventual outcome.
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "modelVersion" TEXT,
    "predictedLabel" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "probabilities" JSONB NOT NULL,
    "regime" TEXT NOT NULL,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualLabel" TEXT,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleSize" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "expired" INTEGER NOT NULL,
    "hitRate" DOUBLE PRECISION,
    "averageReturn" DOUBLE PRECISION,
    CONSTRAINT "ModelPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Signal"
    ADD COLUMN "resolvedPrice" DECIMAL(65,30),
    ADD COLUMN "realizedReturn" DOUBLE PRECISION,
    ADD COLUMN "modelVersion" TEXT,
    ADD COLUMN "predictionId" TEXT;

ALTER TABLE "ModelRegistry"
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'shadow',
    ADD COLUMN "artifactPath" TEXT,
    ADD COLUMN "artifactSha256" TEXT,
    ADD COLUMN "trainingSamples" INTEGER,
    ADD COLUMN "promotedAt" TIMESTAMP(3),
    ADD COLUMN "promotionReason" TEXT;

UPDATE "ModelRegistry"
SET "status" = CASE WHEN "isActive" THEN 'active' ELSE 'shadow' END;

-- Older builds did not enforce version uniqueness. Keep the active/newest row
-- before adding the invariant required by prediction foreign keys.
WITH ranked AS (
    SELECT "id",
           ROW_NUMBER() OVER (
               PARTITION BY "version"
               ORDER BY "isActive" DESC, "trainedAt" DESC, "id" DESC
           ) AS duplicate_rank
    FROM "ModelRegistry"
)
DELETE FROM "ModelRegistry"
WHERE "id" IN (SELECT "id" FROM ranked WHERE duplicate_rank > 1);

CREATE UNIQUE INDEX "ModelRegistry_version_key" ON "ModelRegistry"("version");
CREATE UNIQUE INDEX "Signal_predictionId_key" ON "Signal"("predictionId");
CREATE INDEX "Signal_status_generatedAt_idx" ON "Signal"("status", "generatedAt");
CREATE INDEX "Signal_modelVersion_status_idx" ON "Signal"("modelVersion", "status");
CREATE UNIQUE INDEX "DailyStrategySelection_date_rank_key" ON "DailyStrategySelection"("date", "rank");
CREATE INDEX "DailyStrategySelection_date_regime_idx" ON "DailyStrategySelection"("date", "regime");
CREATE INDEX "ModelRegistry_regime_isActive_idx" ON "ModelRegistry"("regime", "isActive");
CREATE INDEX "Prediction_symbol_createdAt_idx" ON "Prediction"("symbol", "createdAt");
CREATE INDEX "Prediction_modelVersion_createdAt_idx" ON "Prediction"("modelVersion", "createdAt");
CREATE INDEX "ModelPerformanceSnapshot_modelVersion_calculatedAt_idx"
    ON "ModelPerformanceSnapshot"("modelVersion", "calculatedAt");

ALTER TABLE "Signal" ADD CONSTRAINT "Signal_predictionId_fkey"
    FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModelPerformanceSnapshot" ADD CONSTRAINT "ModelPerformanceSnapshot_modelVersion_fkey"
    FOREIGN KEY ("modelVersion") REFERENCES "ModelRegistry"("version")
    ON DELETE RESTRICT ON UPDATE CASCADE;
