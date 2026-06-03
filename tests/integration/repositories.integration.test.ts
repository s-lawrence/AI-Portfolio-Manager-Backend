import {
  AlertSeverity,
  PredictionDirection,
  PredictionHorizon,
  Recommendation,
  RiskLevel,
  Sentiment,
  TrendDirection,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createAIReport,
  getLatestAIReportByStockId,
  listAIReportsByStockId,
} from "../../src/repositories/ai-reports.repository";
import {
  createAlert,
  listUnreadAlertsByUserId,
  markAlertAsRead,
  markAllAlertsAsRead,
} from "../../src/repositories/alerts.repository";
import {
  createDataIngestionLog,
  getFailedLogs,
  listDataIngestionLogs,
  updateDataIngestionLog,
} from "../../src/repositories/data-ingestion-logs.repository";
import {
  createEarningsEvent,
  getNextEarningsEvent,
} from "../../src/repositories/earnings-events.repository";
import { createFundamentalSnapshot } from "../../src/repositories/fundamental-snapshots.repository";
import {
  createHolding,
  getHoldingWithStock,
} from "../../src/repositories/holdings.repository";
import {
  listNewsByStockId,
  upsertNewsArticleByUrl,
} from "../../src/repositories/news-articles.repository";
import {
  createPortfolio,
  getPortfolioWithHoldings,
} from "../../src/repositories/portfolios.repository";
import {
  createPortfolioSummary,
  getLatestPortfolioSummary,
} from "../../src/repositories/portfolio-summaries.repository";
import {
  createPredictionOutcome,
  getPredictionOutcomeByPredictionId,
} from "../../src/repositories/prediction-outcomes.repository";
import {
  createPrediction,
  listOpenPredictions,
  listPredictionsDueForOutcome,
} from "../../src/repositories/predictions.repository";
import {
  createPriceSnapshot,
  getLatestPriceSnapshot,
  listPriceSnapshotsByStockId,
} from "../../src/repositories/price-snapshots.repository";
import { upsertStockByTicker } from "../../src/repositories/stocks.repository";
import {
  createTechnicalSnapshot,
  getLatestTechnicalSnapshot,
} from "../../src/repositories/technical-snapshots.repository";
import {
  createUser,
  getUserByEmail,
} from "../../src/repositories/users.repository";

let sequence = 0;

function token(label: string): string {
  sequence += 1;
  return `${label}-${String(sequence).padStart(4, "0")}`;
}

describe("repositories integration flow", () => {
  it("creates and reads linked records across repositories", async () => {
    const slug = token("repo-flow");
    const email = `test+auto-${slug}@example.com`;
    const ticker = `TSTREP${String(sequence).padStart(2, "0")}`;

    const user = await createUser({
      email,
      name: `[TEST] Repo Flow ${slug}`,
    });

    const loadedUser = await getUserByEmail(email);
    expect(loadedUser?.id).toBe(user.id);

    const portfolio = await createPortfolio({
      userId: user.id,
      name: `[TEST] Repo Portfolio ${slug}`,
      baseCurrency: "USD",
      description: "Repository integration test",
    });

    const stock = await upsertStockByTicker({
      ticker,
      companyName: `[TEST] ${ticker} Holdings`,
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    });

    const holding = await createHolding({
      portfolioId: portfolio.id,
      stockId: stock.id,
      status: "OWNED",
      shares: 15,
      averageCost: 100,
      thesis: "[TEST] Core position",
    });

    const holdingWithStock = await getHoldingWithStock(holding.id);
    expect(holdingWithStock?.stock.ticker).toBe(ticker);

    await createPriceSnapshot({
      stockId: stock.id,
      price: 100,
      previousClose: 98,
      capturedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    await createPriceSnapshot({
      stockId: stock.id,
      price: 105,
      previousClose: 100,
      capturedAt: new Date("2026-08-02T00:00:00.000Z"),
    });

    const latestPrice = await getLatestPriceSnapshot(stock.id);
    const prices = await listPriceSnapshotsByStockId(stock.id, 10);
    expect(latestPrice?.price).toBe(105);
    expect(prices).toHaveLength(2);

    await createTechnicalSnapshot({
      stockId: stock.id,
      trendDirection: TrendDirection.UPTREND,
      sma50: 101,
      sma200: 95,
      capturedAt: new Date("2026-08-02T01:00:00.000Z"),
    });

    const latestTechnical = await getLatestTechnicalSnapshot(stock.id);
    expect(latestTechnical?.trendDirection).toBe(TrendDirection.UPTREND);

    await createFundamentalSnapshot({
      stockId: stock.id,
      capturedAt: new Date("2026-08-02T02:00:00.000Z"),
      marketCap: BigInt(90_000_000_000),
      peRatio: 24,
      revenueGrowth: 0.14,
      debtToEquity: 0.8,
    });

    const article = await upsertNewsArticleByUrl({
      stockId: stock.id,
      headline: "[TEST] Repo integration headline",
      url: `https://example.com/${slug}/news`,
      publishedAt: new Date("2026-08-02T03:00:00.000Z"),
      sentiment: Sentiment.BULLISH,
    });

    const news = await listNewsByStockId(stock.id, 10);
    expect(news[0]?.id).toBe(article.id);

    await createEarningsEvent({
      stockId: stock.id,
      earningsDate: new Date("2026-09-01T00:00:00.000Z"),
      fiscalQuarter: "Q3",
      fiscalYear: 2026,
      isDateConfirmed: true,
    });

    const nextEarnings = await getNextEarningsEvent(stock.id);
    expect(nextEarnings?.fiscalQuarter).toBe("Q3");

    const report = await createAIReport({
      stockId: stock.id,
      holdingId: holding.id,
      reportDate: new Date("2026-08-02T04:00:00.000Z"),
      recommendation: Recommendation.BUY,
      sentiment: Sentiment.BULLISH,
      confidenceScore: 0.74,
      riskScore: 35,
      riskLevel: RiskLevel.MEDIUM,
      currentPrice: 105,
      dailyChangePercent: 5,
      keyTakeaway: "[TEST] Deterministic mock integration report",
      bullishFactors: ["Momentum"],
      bearishFactors: ["Volatility"],
      sourceReferences: {
        source: "repo-integration",
      },
    });

    const latestReport = await getLatestAIReportByStockId(stock.id);
    const reports = await listAIReportsByStockId(stock.id, 10);
    expect(latestReport?.id).toBe(report.id);
    expect(reports).toHaveLength(1);

    const prediction = await createPrediction({
      stockId: stock.id,
      holdingId: holding.id,
      aiReportId: report.id,
      predictionDate: new Date("2026-08-02T04:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      recommendation: Recommendation.BUY,
      direction: PredictionDirection.UP,
      confidenceScore: 0.74,
      startingPrice: 105,
      targetLow: 100,
      targetHigh: 110,
      dataUsed: {
        source: "repo-integration",
      },
    });

    const openPredictions = await listOpenPredictions();
    const duePredictions = await listPredictionsDueForOutcome(
      new Date("2026-08-05T00:00:00.000Z"),
    );

    expect(openPredictions.map((item) => item.id)).toContain(prediction.id);
    expect(duePredictions.map((item) => item.id)).toContain(prediction.id);

    const outcome = await createPredictionOutcome({
      predictionId: prediction.id,
      outcomeDate: new Date("2026-08-05T00:00:00.000Z"),
      endingPrice: 109,
      absoluteReturn: 4,
      percentageReturn: 3.8095238095,
      wasDirectionallyCorrect: true,
      errorScore: 0,
      calibrationScore: 0.9,
    });

    const loadedOutcome = await getPredictionOutcomeByPredictionId(prediction.id);
    expect(loadedOutcome?.id).toBe(outcome.id);

    const createdSummary = await createPortfolioSummary({
      portfolioId: portfolio.id,
      summaryDate: new Date("2026-08-03T00:00:00.000Z"),
      overallSentiment: Sentiment.BULLISH,
      overallRiskScore: 35,
      overallRiskLevel: RiskLevel.MEDIUM,
      bullishHoldingsCount: 1,
      bearishHoldingsCount: 0,
      neutralHoldingsCount: 0,
      topPositiveDevelopments: ["Momentum"],
      topNegativeDevelopments: ["Macro risk"],
      highestRiskTicker: ticker,
      highestConvictionTicker: ticker,
      upcomingEarnings: [],
      concentrationRisks: [],
      suggestedWatchItems: [],
    });

    const latestSummary = await getLatestPortfolioSummary(portfolio.id);
    expect(latestSummary?.id).toBe(createdSummary.id);

    const unreadAlert = await createAlert({
      userId: user.id,
      stockId: stock.id,
      title: `[TEST] Alert ${slug}`,
      message: "Alert message",
      severity: AlertSeverity.INFO,
      category: "TEST",
      sourceType: "INTEGRATION",
    });

    const unreadAlerts = await listUnreadAlertsByUserId(user.id);
    expect(unreadAlerts.map((item) => item.id)).toContain(unreadAlert.id);

    await markAlertAsRead(unreadAlert.id);

    await createAlert({
      userId: user.id,
      stockId: stock.id,
      title: `[TEST] Unread Alert ${slug}`,
      message: "Another message",
      severity: AlertSeverity.WATCH,
      category: "TEST",
      sourceType: "INTEGRATION",
    });

    const markAllResult = await markAllAlertsAsRead(user.id);
    expect(markAllResult.count).toBeGreaterThanOrEqual(1);

    const runningLog = await createDataIngestionLog({
      jobName: "[TEST] repo-flow",
      provider: "test-provider",
      ticker,
      status: "RUNNING",
      startedAt: new Date("2026-08-02T00:00:00.000Z"),
    });

    await updateDataIngestionLog(runningLog.id, {
      status: "SUCCESS",
      finishedAt: new Date("2026-08-02T00:05:00.000Z"),
      recordsCreated: 5,
      recordsUpdated: 1,
      errorMessage: null,
    });

    await createDataIngestionLog({
      jobName: "[TEST] repo-flow",
      provider: "test-provider",
      ticker,
      status: "FAILED",
      startedAt: new Date("2026-08-03T00:00:00.000Z"),
      finishedAt: new Date("2026-08-03T00:01:00.000Z"),
      errorMessage: "intentional test failure",
    });

    const logs = await listDataIngestionLogs({ jobName: "[TEST] repo-flow" });
    const failedLogs = await getFailedLogs(10);

    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(
      failedLogs.some((log) => log.jobName === "[TEST] repo-flow"),
    ).toBe(true);

    const portfolioWithHoldings = await getPortfolioWithHoldings(portfolio.id);
    expect(portfolioWithHoldings?.holdings).toHaveLength(1);
  });
});
