import {
  PredictionHorizon,
  Recommendation,
  Sentiment,
  TrendDirection,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildTickerReportContext,
  createTickerReportFromInput,
  generateTickerReport,
  generateMockTickerReport,
} from "../../src/services/ai-reports.service";
import { recordEarningsEvent } from "../../src/services/earnings.service";
import { listAIReportsByStockId } from "../../src/repositories/ai-reports.repository";
import { upsertAnalystActionEvent } from "../../src/repositories/analyst-action-events.repository";
import { upsertAnalystSnapshot } from "../../src/repositories/analyst-snapshots.repository";
import { upsertMacroEventByProviderIdentity } from "../../src/repositories/macro-events.repository";
import { upsertMacroSeriesObservation } from "../../src/repositories/macro-series-observations.repository";
import { listPredictionsByStockId } from "../../src/repositories/predictions.repository";
import { getStockProfile } from "../../src/services/stocks.service";
import { recordFundamentalSnapshot } from "../../src/services/fundamentals.service";
import { upsertFxRateSnapshot } from "../../src/services/fx-rates.service";
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

async function seedTechnicalRichData(ticker: string): Promise<void> {
  await recordPriceSnapshot(ticker, {
    price: 150,
    previousClose: 148,
    changePercent: 1.35,
    capturedAt: new Date("2026-05-04T00:00:00.000Z"),
  });

  await recordTechnicalSnapshot(ticker, {
    trendDirection: TrendDirection.SIDEWAYS,
    sma20: 147,
    sma50: 145,
    sma200: 140,
    rsi14: 56.4,
    macd: 0.89,
    macdSignal: 0.75,
    macdHistogram: 0.14,
    capturedAt: new Date("2026-05-04T00:01:00.000Z"),
  });

  await recordFundamentalSnapshot(ticker, {
    capturedAt: new Date("2026-05-04T00:02:00.000Z"),
    marketCap: BigInt(90_000_000_000),
    revenueGrowth: 0.08,
    peRatio: 28,
    debtToEquity: 0.9,
  });

  await recordNewsArticles(ticker, [
    {
      headline: "[TEST] Technical-rich setup news",
      url: `https://example.com/${ticker}/technical-rich-1`,
      publishedAt: new Date("2026-05-04T00:03:00.000Z"),
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.55,
      materialityScore: 0.45,
    },
  ]);
}

async function seedAnalystContextData(ticker: string): Promise<void> {
  const stock = await getStockProfile(ticker);
  if (!stock) {
    throw new Error("Stock must exist before seeding analyst context.");
  }

  await upsertAnalystSnapshot({
    stockId: stock.id,
    source: "FMP",
    capturedAt: new Date("2026-05-04T00:05:00.000Z"),
    priceTargetAverage: 165,
    priceTargetHigh: 180,
    priceTargetLow: 150,
    priceTargetConsensus: 170,
    analystCount: 12,
    ratingConsensus: "BUY",
    strongBuyCount: 5,
    buyCount: 4,
    holdCount: 3,
    sellCount: 0,
    strongSellCount: 0,
    upsidePercent: 13,
    raw: { source: "test-analyst" },
  });

  await upsertAnalystActionEvent({
    stockId: stock.id,
    source: "FMP",
    actionType: "UPGRADE",
    firm: "Firm Analyst",
    eventDate: new Date("2026-05-04T00:06:00.000Z"),
    newPriceTarget: 175,
    raw: { source: "test-analyst-action" },
  });
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

  it("unified generateTickerReport returns deterministic metadata when OpenAI is disabled", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateTickerReport(ticker, {
      useOpenAi: false,
      createPredictions: false,
    });

    expect(result.report.id).toBeDefined();
    expect(result.reportMode).toBe("DETERMINISTIC_FALLBACK");
    expect(result.fallbackUsed).toBe(false);
    expect(result.predictions).toHaveLength(0);
    expect(Array.isArray(result.dataGaps)).toBe(true);
  });

  it("buildTickerReportContext respects include flags for optional context blocks", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const context = await buildTickerReportContext(ticker, {
      includeMacro: false,
      includeGeopolitical: false,
      includeNews: false,
      includeAnalyst: false,
      includeScore: false,
    });

    expect(context.macroContext).toBeNull();
    expect(context.geopoliticalContext).toBeNull();
    expect(context.newsContext).toBeNull();
    expect(context.analystContext).toBeNull();
    expect(context.deterministicScore).toBeNull();
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

  it("uses latest technical indicators in technicalSummary and factors", async () => {
    const ticker = nextTicker();
    await seedTechnicalRichData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.technicalSummary.toLowerCase()).not.toContain("unavailable");
    expect(result.report.technicalSummary).toContain("SIDEWAYS");
    expect(
      result.report.bearishFactors.some((factor) =>
        factor.toLowerCase().includes("missing technical trend snapshot"),
      ),
    ).toBe(false);
  });

  it("only uses missing technical warning when technical snapshot is absent", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      price: 110,
      previousClose: 108,
      changePercent: 1.8,
      capturedAt: new Date("2026-05-05T00:00:00.000Z"),
    });

    await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-05-05T00:01:00.000Z"),
      marketCap: BigInt(70_000_000_000),
      revenueGrowth: 0.04,
      peRatio: 24,
      debtToEquity: 1.0,
    });

    const result = await generateMockTickerReport(ticker);

    expect(result.report.technicalSummary).toBe("Technical trend unavailable.");
    expect(
      result.report.bearishFactors.some((factor) =>
        factor.toLowerCase().includes("missing technical trend snapshot"),
      ),
    ).toBe(true);
  });

  it("prediction rationale omits missing technical text when technical data exists", async () => {
    const ticker = nextTicker();
    await seedTechnicalRichData(ticker);

    const result = await generateMockTickerReport(ticker);

    for (const prediction of result.predictions) {
      expect(
        prediction.bearishRationale?.toLowerCase().includes("missing technical trend snapshot") ??
          false,
      ).toBe(false);
      expect(
        prediction.bullishRationale?.toLowerCase().includes("missing technical trend snapshot") ??
          false,
      ).toBe(false);
    }
  });

  it("includes analyst context in summary and model output when analyst data exists", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);
    await seedAnalystContextData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.fundamentalSummary).toContain("Analyst context:");

    const rawModelOutput = result.report.rawModelOutput as { analystSummary?: string } | null;
    expect(rawModelOutput?.analystSummary).toBeDefined();
    expect(rawModelOutput?.analystSummary?.toLowerCase()).toContain("analyst");
    expect(rawModelOutput?.analystSummary?.toLowerCase()).toContain("latest grade action");

    const allFactors = [...result.report.bullishFactors, ...result.report.bearishFactors];
    expect(allFactors.some((factor) => factor.toLowerCase().includes("analyst"))).toBe(true);
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

  it("includes lightweight macro summary when macro context data exists", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    await upsertMacroSeriesObservation({
      provider: "FMP",
      seriesId: "FMP_TREASURY_10Y",
      observedAt: new Date("2026-06-01T00:00:00.000Z"),
      value: 4.5,
      category: "Treasury Rates",
      country: "US",
    });

    await upsertMacroSeriesObservation({
      provider: "FMP",
      seriesId: "FMP_TREASURY_2Y",
      observedAt: new Date("2026-06-01T00:00:00.000Z"),
      value: 4.1,
      category: "Treasury Rates",
      country: "US",
    });

    await upsertMacroSeriesObservation({
      provider: "FMP",
      seriesId: "FMP_MRP_TOTAL_US",
      observedAt: new Date("2026-06-01T00:00:00.000Z"),
      value: 5.6,
      category: "Market Risk Premium",
      country: "US",
    });

    await upsertMacroEventByProviderIdentity(
      {
        provider: "FMP",
        title: "[TEST] CPI Release",
        eventDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        country: "US",
      },
      {
        eventType: "economic-release",
        category: "Inflation",
        importance: "HIGH",
      },
    );

    const result = await generateMockTickerReport(ticker);

    const macroSummary = result.report.macroGeopoliticalSummary ?? "";
    expect(macroSummary).toContain("10Y");
    expect(macroSummary).toContain("2Y");
    expect(macroSummary).toContain("risk premium");
    expect(macroSummary).toContain("Upcoming high-importance macro events");
  });

  it("includes USD/CAD and FRED 10Y/2Y context when available", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.3722,
      capturedAt: new Date("2026-06-21T00:00:00.000Z"),
      source: "Bank of Canada Valet:FXUSDCAD",
    });

    await upsertMacroSeriesObservation({
      provider: "FRED",
      seriesId: "DGS10",
      observedAt: new Date("2026-06-21T00:00:00.000Z"),
      value: 4.42,
      category: "rates",
      country: "US",
    });

    await upsertMacroSeriesObservation({
      provider: "FRED",
      seriesId: "DGS2",
      observedAt: new Date("2026-06-21T00:00:00.000Z"),
      value: 3.95,
      category: "rates",
      country: "US",
    });

    const result = await generateMockTickerReport(ticker);

    const macroSummary = result.report.macroGeopoliticalSummary ?? "";
    expect(macroSummary).toContain("USD/CAD latest");
    expect(macroSummary).toContain("10Y");
    expect(macroSummary).toContain("2Y");
  });

  it("writes a structured valuation/profitability/health fundamentals summary", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.fundamentalSummary.toLowerCase()).toContain("valuation:");
    expect(result.report.fundamentalSummary.toLowerCase()).toContain("profitability:");
    expect(result.report.fundamentalSummary.toLowerCase()).toContain("financial health:");
  });

  it("includes P/E and Debt/Equity in fundamentalSummary when available", async () => {
    const ticker = nextTicker();
    await seedBullishData(ticker);

    const result = await generateMockTickerReport(ticker);

    expect(result.report.fundamentalSummary).toContain("P/E 24.0");
    expect(result.report.fundamentalSummary).toContain("Debt/Equity 0.80");
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
    expect(second.report.technicalSummary.toLowerCase()).not.toContain("unavailable");

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
