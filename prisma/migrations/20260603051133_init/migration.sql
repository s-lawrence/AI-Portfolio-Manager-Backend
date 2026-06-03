-- CreateEnum
CREATE TYPE "HoldingStatus" AS ENUM ('OWNED', 'WATCHLIST');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('BUY', 'HOLD', 'SELL', 'WATCH');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('BULLISH', 'NEUTRAL', 'BEARISH', 'MIXED');

-- CreateEnum
CREATE TYPE "TrendDirection" AS ENUM ('STRONG_UPTREND', 'UPTREND', 'SIDEWAYS', 'DOWNTREND', 'STRONG_DOWNTREND');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WATCH', 'IMPORTANT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PredictionHorizon" AS ENUM ('ONE_DAY', 'ONE_WEEK', 'ONE_MONTH');

-- CreateEnum
CREATE TYPE "PredictionDirection" AS ENUM ('UP', 'DOWN', 'FLAT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riskTolerance" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "preferredHoldingPeriod" TEXT,
    "maxPositionPercent" DOUBLE PRECISION,
    "maxSectorPercent" DOUBLE PRECISION,
    "prefersDividends" BOOLEAN NOT NULL DEFAULT false,
    "prefersGrowth" BOOLEAN NOT NULL DEFAULT true,
    "prefersValue" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "status" "HoldingStatus" NOT NULL DEFAULT 'WATCHLIST',
    "shares" DOUBLE PRECISION,
    "averageCost" DOUBLE PRECISION,
    "targetAllocation" DOUBLE PRECISION,
    "thesis" TEXT,
    "exitCriteria" TEXT,
    "userNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT,
    "exchange" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "currency" TEXT,
    "assetType" TEXT DEFAULT 'EQUITY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "previousClose" DOUBLE PRECISION,
    "volume" BIGINT,
    "marketCap" BIGINT,
    "changePercent" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalSnapshot" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "sma5" DOUBLE PRECISION,
    "sma20" DOUBLE PRECISION,
    "sma50" DOUBLE PRECISION,
    "sma200" DOUBLE PRECISION,
    "rsi14" DOUBLE PRECISION,
    "macd" DOUBLE PRECISION,
    "macdSignal" DOUBLE PRECISION,
    "macdHistogram" DOUBLE PRECISION,
    "volume30DayAverage" DOUBLE PRECISION,
    "volumeRelativeToAverage" DOUBLE PRECISION,
    "fiftyTwoWeekHigh" DOUBLE PRECISION,
    "fiftyTwoWeekLow" DOUBLE PRECISION,
    "distanceFrom52WeekHigh" DOUBLE PRECISION,
    "distanceFrom52WeekLow" DOUBLE PRECISION,
    "trendDirection" "TrendDirection",
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundamentalSnapshot" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "marketCap" BIGINT,
    "peRatio" DOUBLE PRECISION,
    "forwardPeRatio" DOUBLE PRECISION,
    "pegRatio" DOUBLE PRECISION,
    "priceToSales" DOUBLE PRECISION,
    "priceToBook" DOUBLE PRECISION,
    "evToEbitda" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "revenueGrowth" DOUBLE PRECISION,
    "grossMargin" DOUBLE PRECISION,
    "operatingMargin" DOUBLE PRECISION,
    "netMargin" DOUBLE PRECISION,
    "debtToEquity" DOUBLE PRECISION,
    "currentRatio" DOUBLE PRECISION,
    "freeCashFlow" BIGINT,
    "dividendYield" DOUBLE PRECISION,
    "analystConsensus" TEXT,
    "source" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundamentalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "source" TEXT,
    "author" TEXT,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "rawExcerpt" TEXT,
    "sentiment" "Sentiment",
    "sentimentScore" DOUBLE PRECISION,
    "materialityScore" DOUBLE PRECISION,
    "relevanceExplanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningsEvent" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "fiscalQuarter" TEXT,
    "fiscalYear" INTEGER,
    "earningsDate" TIMESTAMP(3),
    "earningsTime" TEXT,
    "isDateConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "estimatedEps" DOUBLE PRECISION,
    "reportedEps" DOUBLE PRECISION,
    "epsSurprise" DOUBLE PRECISION,
    "estimatedRevenue" BIGINT,
    "reportedRevenue" BIGINT,
    "revenueSurprise" DOUBLE PRECISION,
    "guidanceSummary" TEXT,
    "earningsCallUrl" TEXT,
    "transcriptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarningsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "region" TEXT,
    "description" TEXT,
    "source" TEXT,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3),
    "severityScore" DOUBLE PRECISION,
    "affectedSectors" TEXT[],
    "affectedTickers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIReport" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "holdingId" TEXT,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "sentiment" "Sentiment" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "dailyChangePercent" DOUBLE PRECISION,
    "shortTermOutlook" TEXT,
    "mediumTermOutlook" TEXT,
    "longTermOutlook" TEXT,
    "keyTakeaway" TEXT NOT NULL,
    "bullishFactors" TEXT[],
    "bearishFactors" TEXT[],
    "technicalSummary" TEXT,
    "fundamentalSummary" TEXT,
    "newsSummary" TEXT,
    "earningsSummary" TEXT,
    "macroGeopoliticalSummary" TEXT,
    "whatChanged" TEXT,
    "whatWouldChangeRecommendation" TEXT,
    "sourceReferences" JSONB,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "rawModelOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSummary" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "summaryDate" TIMESTAMP(3) NOT NULL,
    "overallSentiment" "Sentiment" NOT NULL,
    "overallRiskScore" DOUBLE PRECISION NOT NULL,
    "overallRiskLevel" "RiskLevel" NOT NULL,
    "bullishHoldingsCount" INTEGER NOT NULL DEFAULT 0,
    "bearishHoldingsCount" INTEGER NOT NULL DEFAULT 0,
    "neutralHoldingsCount" INTEGER NOT NULL DEFAULT 0,
    "topPositiveDevelopments" TEXT[],
    "topNegativeDevelopments" TEXT[],
    "highestRiskTicker" TEXT,
    "highestConvictionTicker" TEXT,
    "upcomingEarnings" JSONB,
    "concentrationRisks" TEXT[],
    "suggestedWatchItems" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "holdingId" TEXT,
    "aiReportId" TEXT,
    "predictionDate" TIMESTAMP(3) NOT NULL,
    "horizon" "PredictionHorizon" NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "direction" "PredictionDirection" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "startingPrice" DOUBLE PRECISION NOT NULL,
    "targetLow" DOUBLE PRECISION,
    "targetHigh" DOUBLE PRECISION,
    "bullishRationale" TEXT,
    "bearishRationale" TEXT,
    "dataUsed" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionOutcome" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "outcomeDate" TIMESTAMP(3) NOT NULL,
    "endingPrice" DOUBLE PRECISION NOT NULL,
    "absoluteReturn" DOUBLE PRECISION NOT NULL,
    "percentageReturn" DOUBLE PRECISION NOT NULL,
    "wasDirectionallyCorrect" BOOLEAN NOT NULL,
    "errorScore" DOUBLE PRECISION,
    "calibrationScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "category" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataIngestionLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "provider" TEXT,
    "ticker" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataIngestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "UserPreference_userId_idx" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");

-- CreateIndex
CREATE INDEX "Holding_portfolioId_idx" ON "Holding"("portfolioId");

-- CreateIndex
CREATE INDEX "Holding_stockId_idx" ON "Holding"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_portfolioId_stockId_key" ON "Holding"("portfolioId", "stockId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_ticker_key" ON "Stock"("ticker");

-- CreateIndex
CREATE INDEX "Stock_ticker_idx" ON "Stock"("ticker");

-- CreateIndex
CREATE INDEX "Stock_sector_idx" ON "Stock"("sector");

-- CreateIndex
CREATE INDEX "PriceSnapshot_stockId_idx" ON "PriceSnapshot"("stockId");

-- CreateIndex
CREATE INDEX "PriceSnapshot_capturedAt_idx" ON "PriceSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_stockId_capturedAt_key" ON "PriceSnapshot"("stockId", "capturedAt");

-- CreateIndex
CREATE INDEX "TechnicalSnapshot_stockId_idx" ON "TechnicalSnapshot"("stockId");

-- CreateIndex
CREATE INDEX "TechnicalSnapshot_capturedAt_idx" ON "TechnicalSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalSnapshot_stockId_capturedAt_key" ON "TechnicalSnapshot"("stockId", "capturedAt");

-- CreateIndex
CREATE INDEX "FundamentalSnapshot_stockId_idx" ON "FundamentalSnapshot"("stockId");

-- CreateIndex
CREATE INDEX "FundamentalSnapshot_capturedAt_idx" ON "FundamentalSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundamentalSnapshot_stockId_capturedAt_key" ON "FundamentalSnapshot"("stockId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_url_key" ON "NewsArticle"("url");

-- CreateIndex
CREATE INDEX "NewsArticle_stockId_idx" ON "NewsArticle"("stockId");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");

-- CreateIndex
CREATE INDEX "EarningsEvent_stockId_idx" ON "EarningsEvent"("stockId");

-- CreateIndex
CREATE INDEX "MacroEvent_publishedAt_idx" ON "MacroEvent"("publishedAt");

-- CreateIndex
CREATE INDEX "AIReport_stockId_idx" ON "AIReport"("stockId");

-- CreateIndex
CREATE INDEX "AIReport_holdingId_idx" ON "AIReport"("holdingId");

-- CreateIndex
CREATE INDEX "AIReport_reportDate_idx" ON "AIReport"("reportDate");

-- CreateIndex
CREATE INDEX "AIReport_recommendation_idx" ON "AIReport"("recommendation");

-- CreateIndex
CREATE INDEX "AIReport_sentiment_idx" ON "AIReport"("sentiment");

-- CreateIndex
CREATE INDEX "PortfolioSummary_portfolioId_idx" ON "PortfolioSummary"("portfolioId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSummary_portfolioId_summaryDate_key" ON "PortfolioSummary"("portfolioId", "summaryDate");

-- CreateIndex
CREATE INDEX "Prediction_stockId_idx" ON "Prediction"("stockId");

-- CreateIndex
CREATE INDEX "Prediction_holdingId_idx" ON "Prediction"("holdingId");

-- CreateIndex
CREATE INDEX "Prediction_aiReportId_idx" ON "Prediction"("aiReportId");

-- CreateIndex
CREATE INDEX "Prediction_horizon_idx" ON "Prediction"("horizon");

-- CreateIndex
CREATE INDEX "Prediction_predictionDate_idx" ON "Prediction"("predictionDate");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionOutcome_predictionId_key" ON "PredictionOutcome"("predictionId");

-- CreateIndex
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");

-- CreateIndex
CREATE INDEX "Alert_stockId_idx" ON "Alert"("stockId");

-- CreateIndex
CREATE INDEX "Alert_severity_idx" ON "Alert"("severity");

-- CreateIndex
CREATE INDEX "Alert_isRead_idx" ON "Alert"("isRead");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "DataIngestionLog_jobName_idx" ON "DataIngestionLog"("jobName");

-- CreateIndex
CREATE INDEX "DataIngestionLog_ticker_idx" ON "DataIngestionLog"("ticker");

-- CreateIndex
CREATE INDEX "DataIngestionLog_status_idx" ON "DataIngestionLog"("status");

-- CreateIndex
CREATE INDEX "DataIngestionLog_startedAt_idx" ON "DataIngestionLog"("startedAt");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalSnapshot" ADD CONSTRAINT "TechnicalSnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundamentalSnapshot" ADD CONSTRAINT "FundamentalSnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningsEvent" ADD CONSTRAINT "EarningsEvent_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIReport" ADD CONSTRAINT "AIReport_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIReport" ADD CONSTRAINT "AIReport_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSummary" ADD CONSTRAINT "PortfolioSummary_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_aiReportId_fkey" FOREIGN KEY ("aiReportId") REFERENCES "AIReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionOutcome" ADD CONSTRAINT "PredictionOutcome_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "Prediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
