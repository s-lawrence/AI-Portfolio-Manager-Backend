-- CreateTable
CREATE TABLE "FxRateSnapshot" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRateSnapshot_baseCurrency_quoteCurrency_idx" ON "FxRateSnapshot"("baseCurrency", "quoteCurrency");

-- CreateIndex
CREATE INDEX "FxRateSnapshot_capturedAt_idx" ON "FxRateSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FxRateSnapshot_baseCurrency_quoteCurrency_capturedAt_key" ON "FxRateSnapshot"("baseCurrency", "quoteCurrency", "capturedAt");
