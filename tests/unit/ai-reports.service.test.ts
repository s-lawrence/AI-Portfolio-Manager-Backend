import {
  PredictionHorizon,
  Recommendation,
  Sentiment,
  TrendDirection,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  generateMockTickerReport,
} from "../../src/services/ai-reports.service";
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
});
