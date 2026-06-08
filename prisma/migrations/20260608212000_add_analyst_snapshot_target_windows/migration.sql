-- Add richer analyst target window fields sourced from FMP stable price-target endpoints.
ALTER TABLE "AnalystSnapshot"
ADD COLUMN "targetMedian" DOUBLE PRECISION,
ADD COLUMN "lastMonthPriceTargetAvg" DOUBLE PRECISION,
ADD COLUMN "lastMonthPriceTargetCount" INTEGER,
ADD COLUMN "lastQuarterPriceTargetAvg" DOUBLE PRECISION,
ADD COLUMN "lastQuarterPriceTargetCount" INTEGER,
ADD COLUMN "lastYearPriceTargetAvg" DOUBLE PRECISION,
ADD COLUMN "lastYearPriceTargetCount" INTEGER,
ADD COLUMN "allTimePriceTargetAvg" DOUBLE PRECISION,
ADD COLUMN "allTimePriceTargetCount" INTEGER;
