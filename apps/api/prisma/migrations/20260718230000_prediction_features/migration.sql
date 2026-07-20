ALTER TABLE "Prediction"
ADD COLUMN "features" JSONB,
ADD COLUMN "featureTimestamp" TIMESTAMP(3),
ADD COLUMN "dataCutoff" TIMESTAMP(3);
