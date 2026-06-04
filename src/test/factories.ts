import {
  AlertSeverity,
  HoldingStatus,
  PredictionDirection,
  PredictionHorizon,
  Recommendation,
  RiskLevel,
  Sentiment,
  TrendDirection,
  Prisma,
  User,
  Portfolio,
  Stock,
  Holding,
  PriceSnapshot,
  TechnicalSnapshot,
  FundamentalSnapshot,
  NewsArticle,
  AIReport,
  Prediction,
} from "@prisma/client";

import {
  TEST_EMAIL_MARKER,
  TEST_TEXT_MARKER,
  TEST_TICKER_PREFIXES,
  testPrisma,
} from "./test-db";

let sequence = 0;
const runToken = Date.now().toString(36).toUpperCase();

function nextToken(label: string): string {
  sequence += 1;
  return `${label}-${runToken}-${String(sequence).padStart(4, "0")}`;
}

function uniqueTicker(prefix: string = TEST_TICKER_PREFIXES[0]): string {
  const token = nextToken("T").replace(/[^A-Z0-9]/g, "").slice(-5);
  return `${prefix}${token}`.slice(0, 12);
}

function nextDate(offsetMinutes?: number): Date {
  if (offsetMinutes == null) {
    sequence += 1;
    offsetMinutes = sequence;
  }

  return new Date(Date.UTC(2026, 0, 1, 0, offsetMinutes, 0, 0));
}

export async function createTestUser(): Promise<User> {
  const token = nextToken("user").toLowerCase();

  return testPrisma.user.create({
    data: {
      email: `${TEST_EMAIL_MARKER}${token}@example.com`,
      name: `${TEST_TEXT_MARKER} User ${token}`,
    },
  });
}

export async function createTestPortfolio(userId?: string): Promise<Portfolio> {
  const user = userId ? await testPrisma.user.findUnique({ where: { id: userId } }) : null;
  const resolvedUser = user ?? (await createTestUser());
  const token = nextToken("portfolio");

  return testPrisma.portfolio.create({
    data: {
      userId: resolvedUser.id,
      name: `${TEST_TEXT_MARKER} Portfolio ${token}`,
      description: "Automated test portfolio",
      baseCurrency: "USD",
    },
  });
}

export async function createTestStock(ticker?: string): Promise<Stock> {
  const resolvedTicker = (ticker ?? uniqueTicker()).toUpperCase();

  return testPrisma.stock.upsert({
    where: { ticker: resolvedTicker },
    create: {
      ticker: resolvedTicker,
      companyName: `${TEST_TEXT_MARKER} ${resolvedTicker} Corp`,
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    },
    update: {
      companyName: `${TEST_TEXT_MARKER} ${resolvedTicker} Corp`,
    },
  });
}

export async function createTestHolding(
  portfolioId?: string,
  stockId?: string,
): Promise<Holding> {
  const portfolio = portfolioId
    ? await testPrisma.portfolio.findUnique({ where: { id: portfolioId } })
    : null;
  const stock = stockId ? await testPrisma.stock.findUnique({ where: { id: stockId } }) : null;

  const resolvedPortfolio = portfolio ?? (await createTestPortfolio());
  const resolvedStock = stock ?? (await createTestStock());

  return testPrisma.holding.upsert({
    where: {
      portfolioId_stockId: {
        portfolioId: resolvedPortfolio.id,
        stockId: resolvedStock.id,
      },
    },
    create: {
      portfolioId: resolvedPortfolio.id,
      stockId: resolvedStock.id,
      status: HoldingStatus.WATCHLIST,
      shares: 10,
      averageCost: 100,
      thesis: `${TEST_TEXT_MARKER} holding thesis`,
    },
    update: {
      thesis: `${TEST_TEXT_MARKER} holding thesis`,
    },
  });
}

export async function createTestPriceSnapshot(
  stockId: string,
  overrides?: Partial<Prisma.PriceSnapshotUncheckedCreateInput>,
): Promise<PriceSnapshot> {
  const capturedAt = overrides?.capturedAt ?? nextDate();

  return testPrisma.priceSnapshot.create({
    data: {
      stockId,
      source: overrides?.source ?? null,
      price: overrides?.price ?? 100,
      open: overrides?.open ?? 99,
      high: overrides?.high ?? 101,
      low: overrides?.low ?? 98,
      close: overrides?.close ?? 100,
      previousClose: overrides?.previousClose ?? 98,
      volume: overrides?.volume ?? BigInt(1_000_000),
      marketCap: overrides?.marketCap ?? BigInt(50_000_000_000),
      changePercent: overrides?.changePercent ?? null,
      capturedAt,
    },
  });
}

export async function createTestTechnicalSnapshot(
  stockId: string,
  overrides?: Partial<Prisma.TechnicalSnapshotUncheckedCreateInput>,
): Promise<TechnicalSnapshot> {
  return testPrisma.technicalSnapshot.create({
    data: {
      stockId,
      sma5: overrides?.sma5 ?? 101,
      sma20: overrides?.sma20 ?? 100,
      sma50: overrides?.sma50 ?? 99,
      sma200: overrides?.sma200 ?? 95,
      rsi14: overrides?.rsi14 ?? 58,
      macd: overrides?.macd ?? 1.2,
      macdSignal: overrides?.macdSignal ?? 1,
      macdHistogram: overrides?.macdHistogram ?? 0.2,
      volume30DayAverage: overrides?.volume30DayAverage ?? 900_000,
      volumeRelativeToAverage: overrides?.volumeRelativeToAverage ?? 1.1,
      fiftyTwoWeekHigh: overrides?.fiftyTwoWeekHigh ?? 120,
      fiftyTwoWeekLow: overrides?.fiftyTwoWeekLow ?? 70,
      distanceFrom52WeekHigh: overrides?.distanceFrom52WeekHigh ?? -10,
      distanceFrom52WeekLow: overrides?.distanceFrom52WeekLow ?? 30,
      trendDirection: overrides?.trendDirection ?? TrendDirection.UPTREND,
      capturedAt: overrides?.capturedAt ?? nextDate(),
    },
  });
}

export async function createTestFundamentalSnapshot(
  stockId: string,
  overrides?: Partial<Prisma.FundamentalSnapshotUncheckedCreateInput>,
): Promise<FundamentalSnapshot> {
  return testPrisma.fundamentalSnapshot.create({
    data: {
      stockId,
      marketCap: overrides?.marketCap ?? BigInt(45_000_000_000),
      peRatio: overrides?.peRatio ?? 24,
      forwardPeRatio: overrides?.forwardPeRatio ?? 22,
      pegRatio: overrides?.pegRatio ?? 1.5,
      priceToSales: overrides?.priceToSales ?? 5,
      priceToBook: overrides?.priceToBook ?? 6,
      evToEbitda: overrides?.evToEbitda ?? 14,
      eps: overrides?.eps ?? 4.5,
      revenueGrowth: overrides?.revenueGrowth ?? 0.15,
      grossMargin: overrides?.grossMargin ?? 0.55,
      operatingMargin: overrides?.operatingMargin ?? 0.28,
      netMargin: overrides?.netMargin ?? 0.22,
      debtToEquity: overrides?.debtToEquity ?? 0.6,
      currentRatio: overrides?.currentRatio ?? 1.7,
      freeCashFlow: overrides?.freeCashFlow ?? BigInt(8_000_000_000),
      dividendYield: overrides?.dividendYield ?? 0.01,
      analystConsensus: overrides?.analystConsensus ?? "BUY",
      source: overrides?.source ?? "test-factory",
      capturedAt: overrides?.capturedAt ?? nextDate(),
    },
  });
}

export async function createTestNewsArticle(
  stockId: string,
  overrides?: Partial<Prisma.NewsArticleUncheckedCreateInput>,
): Promise<NewsArticle> {
  const token = nextToken("news").toLowerCase();

  return testPrisma.newsArticle.create({
    data: {
      stockId,
      headline: overrides?.headline ?? `${TEST_TEXT_MARKER} Headline ${token}`,
      source: overrides?.source ?? "test-news",
      author: overrides?.author ?? "test-author",
      url: overrides?.url ?? `https://example.com/${token}`,
      publishedAt: overrides?.publishedAt ?? nextDate(),
      summary: overrides?.summary ?? "Test summary",
      rawExcerpt: overrides?.rawExcerpt ?? "Test excerpt",
      sentiment: overrides?.sentiment ?? Sentiment.NEUTRAL,
      sentimentScore: overrides?.sentimentScore ?? 0,
      materialityScore: overrides?.materialityScore ?? 0.5,
      relevanceExplanation: overrides?.relevanceExplanation ?? "Test relevance",
    },
  });
}

export async function createTestAIReport(
  stockId: string,
  overrides?: Partial<Prisma.AIReportUncheckedCreateInput>,
): Promise<AIReport> {
  const token = nextToken("report");

  return testPrisma.aIReport.create({
    data: {
      stockId,
      holdingId: overrides?.holdingId ?? null,
      reportDate: overrides?.reportDate ?? nextDate(),
      recommendation: overrides?.recommendation ?? Recommendation.HOLD,
      sentiment: overrides?.sentiment ?? Sentiment.NEUTRAL,
      confidenceScore: overrides?.confidenceScore ?? 0.65,
      riskScore: overrides?.riskScore ?? 45,
      riskLevel: overrides?.riskLevel ?? RiskLevel.MEDIUM,
      currentPrice: overrides?.currentPrice ?? 100,
      dailyChangePercent: overrides?.dailyChangePercent ?? 0,
      shortTermOutlook: overrides?.shortTermOutlook ?? "Stable",
      mediumTermOutlook: overrides?.mediumTermOutlook ?? "Balanced",
      longTermOutlook: overrides?.longTermOutlook ?? "Constructive",
      keyTakeaway:
        overrides?.keyTakeaway ?? `${TEST_TEXT_MARKER} Deterministic mock report ${token}`,
      bullishFactors: overrides?.bullishFactors ?? ["Test bullish factor"],
      bearishFactors: overrides?.bearishFactors ?? ["Test bearish factor"],
      technicalSummary: overrides?.technicalSummary ?? "Technical summary",
      fundamentalSummary: overrides?.fundamentalSummary ?? "Fundamental summary",
      newsSummary: overrides?.newsSummary ?? "News summary",
      earningsSummary: overrides?.earningsSummary ?? "Earnings summary",
      macroGeopoliticalSummary:
        overrides?.macroGeopoliticalSummary ?? "Macro summary",
      whatChanged: overrides?.whatChanged ?? "Test what changed",
      whatWouldChangeRecommendation:
        overrides?.whatWouldChangeRecommendation ?? "Test what would change",
      sourceReferences:
        overrides?.sourceReferences ?? ({ source: "test-factory" } as Prisma.InputJsonValue),
      modelName: overrides?.modelName ?? "test-mock-model",
      promptVersion: overrides?.promptVersion ?? "test-v1",
      rawModelOutput:
        overrides?.rawModelOutput ?? ({ source: "test" } as Prisma.InputJsonValue),
    },
  });
}

export async function createTestPrediction(
  stockId: string,
  overrides?: Partial<Prisma.PredictionUncheckedCreateInput>,
): Promise<Prediction> {
  return testPrisma.prediction.create({
    data: {
      stockId,
      holdingId: overrides?.holdingId ?? null,
      aiReportId: overrides?.aiReportId ?? null,
      predictionDate: overrides?.predictionDate ?? nextDate(),
      horizon: overrides?.horizon ?? PredictionHorizon.ONE_DAY,
      recommendation: overrides?.recommendation ?? Recommendation.HOLD,
      direction: overrides?.direction ?? PredictionDirection.FLAT,
      confidenceScore: overrides?.confidenceScore ?? 0.6,
      startingPrice: overrides?.startingPrice ?? 100,
      targetLow: overrides?.targetLow ?? 98,
      targetHigh: overrides?.targetHigh ?? 102,
      bullishRationale: overrides?.bullishRationale ?? "Test bullish rationale",
      bearishRationale: overrides?.bearishRationale ?? "Test bearish rationale",
      dataUsed:
        overrides?.dataUsed ?? ({ source: "test-factory" } as Prisma.InputJsonValue),
    },
  });
}

export async function createTestAlert(userId: string, stockId?: string) {
  return testPrisma.alert.create({
    data: {
      userId,
      stockId: stockId ?? null,
      title: `${TEST_TEXT_MARKER} Alert ${nextToken("alert")}`,
      message: "Test alert message",
      severity: AlertSeverity.INFO,
      category: "TEST",
      sourceType: "TEST",
    },
  });
}
