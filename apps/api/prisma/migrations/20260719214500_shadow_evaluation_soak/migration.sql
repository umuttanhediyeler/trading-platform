-- Phase 10 shadow soak: challenger models produce hidden evaluations that are
-- resolved without user exposure and gate promotion on live performance.

ALTER TABLE "Prediction" ADD COLUMN "shadow" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ModelRegistry" ADD COLUMN "shadowStartedAt" TIMESTAMP(3);

-- Existing shadow candidates start their soak clock at training time so the
-- backfill does not instantly qualify or disqualify anything retroactively.
UPDATE "ModelRegistry"
SET "shadowStartedAt" = "trainedAt"
WHERE "status" = 'shadow' AND "isActive" = false;

CREATE TABLE "ShadowEvaluation" (
    "id" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "entryPrice" DECIMAL(65,30) NOT NULL,
    "stopPrice" DECIMAL(65,30) NOT NULL,
    "targetPrice" DECIMAL(65,30) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedPrice" DECIMAL(65,30),
    "realizedReturn" DOUBLE PRECISION,
    "predictionId" TEXT,
    CONSTRAINT "ShadowEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShadowEvaluation_predictionId_key" ON "ShadowEvaluation"("predictionId");
CREATE INDEX "ShadowEvaluation_status_generatedAt_idx" ON "ShadowEvaluation"("status", "generatedAt");
CREATE INDEX "ShadowEvaluation_modelVersion_status_generatedAt_idx"
    ON "ShadowEvaluation"("modelVersion", "status", "generatedAt");
CREATE INDEX "Prediction_shadow_createdAt_idx" ON "Prediction"("shadow", "createdAt");

ALTER TABLE "ShadowEvaluation" ADD CONSTRAINT "ShadowEvaluation_modelVersion_fkey"
    FOREIGN KEY ("modelVersion") REFERENCES "ModelRegistry"("version")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShadowEvaluation" ADD CONSTRAINT "ShadowEvaluation_predictionId_fkey"
    FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
