-- CreateTable
CREATE TABLE "AnalystSnapshot" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "source" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "priceTargetAverage" DOUBLE PRECISION,
    "priceTargetHigh" DOUBLE PRECISION,
    "priceTargetLow" DOUBLE PRECISION,
    "priceTargetConsensus" DOUBLE PRECISION,
    "analystCount" INTEGER,
    "ratingConsensus" TEXT,
    "strongBuyCount" INTEGER,
    "buyCount" INTEGER,
    "holdCount" INTEGER,
    "sellCount" INTEGER,
    "strongSellCount" INTEGER,
    "upsidePercent" DOUBLE PRECISION,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalystSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalystActionEvent" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "source" TEXT,
    "actionType" TEXT NOT NULL,
    "firm" TEXT,
    "analystName" TEXT,
    "previousRating" TEXT,
    "newRating" TEXT,
    "previousPriceTarget" DOUBLE PRECISION,
    "newPriceTarget" DOUBLE PRECISION,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "headline" TEXT,
    "url" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalystActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDiscoverySnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT,
    "category" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "stockId" TEXT,
    "companyName" TEXT,
    "price" DOUBLE PRECISION,
    "changePercent" DOUBLE PRECISION,
    "volume" BIGINT,
    "marketCap" BIGINT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketDiscoverySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalystSnapshot_stockId_capturedAt_key" ON "AnalystSnapshot"("stockId", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalystSnapshot_stockId_idx" ON "AnalystSnapshot"("stockId");

-- CreateIndex
CREATE INDEX "AnalystSnapshot_capturedAt_idx" ON "AnalystSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalystActionEvent_stockId_eventDate_firm_actionType_key" ON "AnalystActionEvent"("stockId", "eventDate", "firm", "actionType");

-- CreateIndex
CREATE INDEX "AnalystActionEvent_stockId_idx" ON "AnalystActionEvent"("stockId");

-- CreateIndex
CREATE INDEX "AnalystActionEvent_eventDate_idx" ON "AnalystActionEvent"("eventDate");

-- CreateIndex
CREATE INDEX "AnalystActionEvent_actionType_idx" ON "AnalystActionEvent"("actionType");

-- CreateIndex
CREATE INDEX "MarketDiscoverySnapshot_category_idx" ON "MarketDiscoverySnapshot"("category");

-- CreateIndex
CREATE INDEX "MarketDiscoverySnapshot_ticker_idx" ON "MarketDiscoverySnapshot"("ticker");

-- CreateIndex
CREATE INDEX "MarketDiscoverySnapshot_capturedAt_idx" ON "MarketDiscoverySnapshot"("capturedAt");

-- AddForeignKey
ALTER TABLE "AnalystSnapshot" ADD CONSTRAINT "AnalystSnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalystActionEvent" ADD CONSTRAINT "AnalystActionEvent_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDiscoverySnapshot" ADD CONSTRAINT "MarketDiscoverySnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
