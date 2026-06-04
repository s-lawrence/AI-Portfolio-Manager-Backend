import {
  PredictionHorizon,
  Recommendation,
  Sentiment,
  TrendDirection,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createTickerReportFromInput,
  generateMockTickerReport,
} from "../../src/services/ai-reports.service";
import { recordEarningsEvent } from "../../src/services/earnings.service";
import { listAIReportsByStockId } from "../../src/repositories/ai-reports.repository";
import { listPredictionsByStockId } from "../../src/repositories/predictions.repository";
import { getStockProfile } from "../../src/services/stocks.service";
import { recordFundamentalSnapshot } from "../../src/services/fundamentals.service";
import { recordPriceSnapshot } from "../../src/services/market-data.service";
import { recordNewsArticles } from "../../src/services/news.service";
import { recordTechnicalSnapshot } from "../../src/services/technical-analysis.service";

let tickerSequence = 0;

function nextTicker(): string {
  tickerSequence += 1;
  return `TSTAI${tickerSequence}`;
}

async function seedBullishData(ticker: string): Promise<void> {
  await recordPriceSnapshot(ticker, {
    price: 120,
    previousClose: 100,
    changePercent: 20,
    capturedAt: new Date("2026-05-01T00:00:00.000Z"),
  });

  await recordTechnicalSnapshot(ticker, {
    trendDirection: TrendDirection.STRONG_UPTREND,
    sma50: 108,
    sma200: 95,
    capturedAt: new Date("2026-05-01T00:01:00.000Z"),
  });

  await recordFundamentalSnapshot(ticker, {
    capturedAt: new Date("2026-05-01T00:02:00.000Z"),
    marketCap: BigInt(100_000_000_000),
    revenueGrowth: 0.2,
    peRatio: 24,
    debtToEquity: 0.8,
  });

  await recordNewsArticles(ticker, [
    {
      headline: "[TEST] Bullish catalyst 1",
      url: `https://example.com/${ticker}/bullish-1`,
      publishedAt: new Date("2026-05-01T00:03:00.000Z"),
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.8,
      materialityScore: 0.7,
    },
    {
      headline: "[TEST] Bullish catalyst 2",
      url: `https://example.com/${ticker}/bullish-2`,
      publishedAt: new Date("2026-05-01T00:04:00.000Z"),
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.6,
      materialityScore: 0.6,
    },
  ]);
}

async function seedBullishDataWithoutFundamentals(ticker: string): Promise<void> {
  await recordPriceSnapshot(ticker, {
    price: 120,
    previousClose: 100,
    changePercent: 20,
    capturedAt: new Date("2026-05-01T00:00:00.000Z"),
  });

  await recordTechnicalSnapshot(ticker, {
    trendDirection: TrendDirection.STRONG_UPTREND,
    sma50: 108,
    sma200: 95,
    capturedAt: new Date("2026-05-01T00:01:00.000Z"),
  });

  await recordNewsArticles(ticker, [
    {
      headline: "[TEST] Bullish catalyst without fundamentals 1",
      url: `https://example.com/${ticker}/bullish-no-fund-1`,
      publishedAt: new Date("2026-05-01T00:03:00.000Z"),
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.8,
      materialityScore: 0.7,
    },
    {
      headline: "[TEST] Bullish catalyst without fundamentals 2",
      url: `https://example.com/${ticker}/bullish-no-fund-2`,
      publishedAt: new Date("2026-05-01T00:04:00.000Z"),
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.6,
      materialityScore: 0.6,
    },
  ]);
}

async function seedBearishData(ticker: string): Promise<void> {
  await recordPriceSnapshot(ticker, {
    price: 80,
    previousClose: 100,
    changePercent: -20,
    capturedAt: new Date("2026-05-02T00:00:00.000Z"),
  });

  await recordTechnicalSnapshot(ticker, {
    trendDirection: TrendDirection.STRONG_DOWNTREND,
    sma50: 95,
    sma200: 110,
    capturedAt: new Date("2026-05-02T00:01:00.000Z"),
  });

  await recordFundamentalSnapshot(ticker, {
    capturedAt: new Date("2026-05-02T00:02:00.000Z"),
    marketCap: BigInt(80_000_000_000),
    revenueGrowth: -0.12,
    peRatio: 60,
    debtToEquity: 2.8,
  });

  await recordNewsArticles(ticker, [
    {
      headline: "[TEST] Bearish catalyst 1",
      url: `https://example.com/${ticker}/bearish-1`,
      publishedAt: new Date("2026-05-02T00:03:00.000Z"),
      sentiment: Sentiment.BEARISH,
      sentimentScore: -0.8,
      materialityScore: 0.8,
    },
    {
      headline: "[TEST] Bearish catalyst 2",
      url: `https://example.com/${ticker}/bearish-2`,
      publishedAt: new Date("2026-05-02T00:04:00.000Z"),
      sentiment: Sentiment.BEARISH,
      sentimentScore: -0.7,
      materialityScore: 0.7,
    },
  ]);
}

describe("ai-reports.service", () => {
  it("creates an AI report and three predictions for day/week/month horizons", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.id).toBeDefined();
    expect(result.predictions).toHaveLength(3);

    const horizons = result.predictions.map((prediction) => prediction.horizon);
    expect(horizons).toEqual(
      expect.arrayContaining([
        PredictionHorizon.ONE_DAY,
        PredictionHorizon.ONE_WEEK,
        PredictionHorizon.ONE_MONTH,
      ]),
    );
  });

  it("treats sparse data as lower-conviction and watch-oriented", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      price: 100,
      capturedAt: new Date("2026-05-03T00:00:00.000Z"),
    });

    const result = await generateMockTickerReport(ticker);

    expect(result.report.recommendation).toBe(Recommendation.WATCH);
    expect(
      result.report.bearishFactors.some((factor) =>
        factor.toLowerCase().includes("limited data coverage"),
      ),
    ).toBe(true);
  });

  it("bullish local data biases recommendation/sentiment upward", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.recommendation).toBe(Recommendation.BUY);
    expect(result.report.sentiment).toBe(Sentiment.BULLISH);
  });

  it("bearish local data biases recommendation/sentiment downward", async () => {
    const ticker = nextTicker();
    await seedBearishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.recommendation).toBe(Recommendation.SELL);
    expect(result.report.sentiment).toBe(Sentiment.BEARISH);
  });

  it("stores deterministic/mock wording in report metadata", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.modelName?.toLowerCase()).toContain("deterministic");
    expect(result.report.keyTakeaway.toLowerCase()).toContain("deterministic mock");

    const sourceReferences = result.report.sourceReferences as
      | { deterministicMock?: boolean }
      | null;

    expect(sourceReferences?.deterministicMock).toBe(true);
  });

  it("writes a structured valuation/profitability/health fundamentals summary", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.fundamentalSummary.toLowerCase()).toContain("valuation:");
    expect(result.report.fundamentalSummary.toLowerCase()).toContain("profitability:");
    expect(result.report.fundamentalSummary.toLowerCase()).toContain("financial health:");
  });

  it("assigns lower confidence when fundamentals are missing", async () => {
    const tickerWithFundamentals = nextTicker();
    const tickerWithoutFundamentals = nextTicker();

    await seedBullishData(tickerWithFundamentals);
    await seedBullishDataWithoutFundamentals(tickerWithoutFundamentals);

    const withFundamentals = await generateMockTickerReport(tickerWithFundamentals);
    const withoutFundamentals = await generateMockTickerReport(
      tickerWithoutFundamentals,
    );

    expect(withFundamentals.report.confidenceScore).toBeGreaterThan(
      withoutFundamentals.report.confidenceScore,
    );
    expect(withoutFundamentals.report.fundamentalSummary.toLowerCase()).toContain(
      "missing",
    );
  });

  it("updates existing same-day report and reuses same-day prediction rows", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const first = await generateMockTickerReport(ticker);

    await recordPriceSnapshot(ticker, {
      price: 135,
      previousClose: 120,
      changePercent: 12.5,
      capturedAt: new Date("2026-05-01T10:00:00.000Z"),
    });

    const second = await generateMockTickerReport(ticker);

    expect(second.report.id).toBe(first.report.id);
    expect(second.report.currentPrice).toBe(135);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const reports = await listAIReportsByStockId(stock!.id, 20);
    expect(reports).toHaveLength(1);

    const predictions = await listPredictionsByStockId(stock!.id, 20);
    expect(predictions).toHaveLength(3);
    expect(new Set(predictions.map((prediction) => prediction.horizon)).size).toBe(3);

    for (const prediction of predictions) {
      expect(prediction.aiReportId).toBe(second.report.id);
    }
  });

  it("creates separate report rows when report dates are on different UTC days", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      price: 101,
      previousClose: 100,
      changePercent: 1,
      capturedAt: new Date("2026-06-01T08:00:00.000Z"),
    });

    const first = await generateMockTickerReport(ticker);

    await createTickerReportFromInput({
      ticker,
      reportDate: new Date("2026-06-02T09:00:00.000Z"),
      recommendation: first.report.recommendation,
      sentiment: first.report.sentiment,
      confidenceScore: first.report.confidenceScore,
      riskScore: first.report.riskScore,
      riskLevel: first.report.riskLevel,
      keyTakeaway: "Manual next-day report",
      createPredictions: false,
    });

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const reports = await listAIReportsByStockId(stock!.id, 20);
    expect(reports).toHaveLength(2);
  });

  it("includes upcoming earnings details in earningsSummary when earnings data exists", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    await recordEarningsEvent(ticker, {
      fiscalQuarter: "Q2",
      fiscalYear: 2026,
      earningsDate: new Date("2026-08-03T12:30:00.000Z"),
      earningsTime: "bmo",
      isDateConfirmed: true,
      estimatedEps: 1.42,
      estimatedRevenue: BigInt(88_500_000_000),
    });

    const result = await generateMockTickerReport(ticker);

    expect(result.report.earningsSummary.toLowerCase()).toContain("next earnings");
    expect(result.report.earningsSummary.toLowerCase()).toContain("est. eps");
  });

  it("uses real news headlines in report summary when available", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    await recordNewsArticles(ticker, [
      {
        headline: "[DEMO] Synthetic headline",
        url: `https://demo.local/${ticker.toLowerCase()}/demo-news`,
        source: "Demo News (Local Fake Data)",
        publishedAt: new Date("2026-05-01T00:05:00.000Z"),
        sentiment: Sentiment.NEUTRAL,
      },
    ]);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.newsSummary).toContain("Top headlines:");
    expect(result.report.newsSummary).not.toContain("Only demo/local news");
    expect(result.report.newsSummary).toContain("[TEST] Bullish catalyst");
  });

  it("calls out demo-only coverage when real news is unavailable", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      price: 100,
      previousClose: 99,
      changePercent: 1,
      capturedAt: new Date("2026-05-10T00:00:00.000Z"),
    });

    await recordNewsArticles(ticker, [
      {
        headline: "[DEMO] Placeholder market update",
        url: `https://demo.local/${ticker.toLowerCase()}/demo-1`,
        source: "Demo News (Local Fake Data)",
        publishedAt: new Date("2026-05-10T00:01:00.000Z"),
        sentiment: Sentiment.NEUTRAL,
      },
    ]);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.newsSummary).toContain("Only demo/local news is available");
    expect(result.report.newsSummary).toContain("[DEMO] Placeholder market update");
  });
});
