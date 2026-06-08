import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/config/env";
import { ProviderNotFoundError } from "../../src/providers/errors";
import {
  fmpEarningsProvider,
  fmpFundamentalsProvider,
  fmpMarketDataProvider,
  fmpNewsProvider,
  fmpProfileProvider,
} from "../../src/providers/fmp";
import { ProviderHistoricalPrice } from "../../src/providers/types";
import { listEarningsEventsByStockId } from "../../src/repositories/earnings-events.repository";
import { getLatestAIReportByStockId } from "../../src/repositories/ai-reports.repository";
import { listFundamentalSnapshotsByStockId } from "../../src/repositories/fundamental-snapshots.repository";
import { listRecentNewsByTicker } from "../../src/repositories/news-articles.repository";
import { listPriceSnapshotsByTicker } from "../../src/repositories/price-snapshots.repository";
import { recordPriceSnapshot } from "../../src/services/market-data.service";
import { getLatestTechnicalSnapshot } from "../../src/repositories/technical-snapshots.repository";
import { getLatestMarketSnapshot } from "../../src/services/market-data.service";
import { getPortfolioOverview } from "../../src/services/portfolios.service";
import {
  ingestPortfolioFmpFullRefresh,
  ingestPortfolioNews,
  ingestPortfolioEarnings,
  ingestPortfolioFundamentals,
  ingestPortfolioMarketData,
  ingestTickerEarnings,
  ingestTickerFundamentals,
  ingestTickerMarketData,
  ingestTickerNews,
} from "../../src/services/real-data-ingestion.service";
import * as fmpEconomicsIngestionService from "../../src/services/fmp-economics-ingestion.service";
import * as macroIngestionService from "../../src/services/macro-ingestion.service";
import * as analystIngestionService from "../../src/services/analyst-ingestion.service";
import * as geopoliticalIngestionService from "../../src/services/geopolitical-ingestion.service";
import * as portfolioAnalysisService from "../../src/services/portfolio-analysis.service";
import { getLatestFundamentals } from "../../src/services/fundamentals.service";
import { getStockProfile, getStockResearchBundle } from "../../src/services/stocks.service";
import {
  createTestHolding,
  createTestPortfolio,
  createTestStock,
} from "../../src/test/factories";

function buildHistoricalSeries(ticker: string): ProviderHistoricalPrice[] {
  return [
    {
      ticker,
      date: new Date("2026-02-01T00:00:00.000Z"),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1000,
    },
    {
      ticker,
      date: new Date("2026-02-02T00:00:00.000Z"),
      open: 101,
      high: 103,
      low: 100,
      close: 102,
      volume: 1200,
    },
    {
      ticker,
      date: new Date("2026-02-03T00:00:00.000Z"),
      open: 102,
      high: 104,
      low: 101,
      close: 103,
      volume: 1300,
    },
  ];
}

function buildLongHistoricalSeries(
  ticker: string,
  points: number = 250,
): ProviderHistoricalPrice[] {
  const start = Date.UTC(2025, 0, 2);

  return Array.from({ length: points }, (_, index) => {
    const base = 120 + index * 0.22;
    const oscillation = Math.sin(index / 8) * 1.7;
    const close = base + oscillation;
    const date = new Date(start + index * 24 * 60 * 60 * 1000);

    return {
      ticker,
      date,
      open: close - 0.5,
      high: close + 1.2,
      low: close - 1.3,
      close,
      volume: 20_000 + index * 15,
    };
  });
}

function mockSuccessfulFullRefreshProviders(ticker: string): void {
  vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
    ticker,
    companyName: `${ticker} Co.`,
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Software",
    country: "US",
    currency: "USD",
    assetType: "EQUITY",
  });

  vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
    ticker,
    price: 180,
    previousClose: 178,
    close: 180,
    volume: 10_000,
  });

  vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
    buildHistoricalSeries(ticker),
  );

  vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
    ticker,
    marketCap: 2_500_000_000,
    peRatio: 19,
    source: "FMP",
  });

  vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
  vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
  vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);
}

describe("real-data-ingestion.service", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ingests ticker profile, quote, historical snapshots, and technical snapshot", async () => {
    const ticker = "TSTFMP01";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker,
      companyName: "Test FMP Company",
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
      marketCap: 120_000_000,
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker,
      price: 105,
      open: 104,
      high: 106,
      low: 103,
      close: 105,
      previousClose: 103,
      volume: 15_000,
      marketCap: 120_000_000,
      changePercent: 1.94,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries(ticker),
    );

    const result = await ingestTickerMarketData(ticker, { historicalLimit: 3 });

    expect(result.ticker).toBe(ticker);
    expect(result.profileUpdated).toBe(true);
    expect(result.quoteSnapshotCreated).toBe(true);
    expect(result.historicalSnapshotsCreated).toBe(3);
    expect(result.historicalSnapshotsUpdated).toBe(0);
    expect(result.historicalSnapshotsSkipped).toBe(0);
    expect(result.technicalSnapshotCreated).toBe(true);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();
    expect(stock?.companyName).toBe("Test FMP Company");
    expect(stock?.exchange).toBe("NASDAQ");

    const snapshots = await listPriceSnapshotsByTicker(ticker, 20);
    expect(snapshots.length).toBeGreaterThanOrEqual(4);
    expect(snapshots.some((snapshot) => snapshot.source === "FMP_QUOTE")).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.source === "FMP_HISTORICAL")).toBe(true);

    const technicalSnapshot = stock
      ? await getLatestTechnicalSnapshot(stock.id)
      : null;
    expect(technicalSnapshot).not.toBeNull();
  });

  it("updates existing same-day historical snapshots on repeated ingestion", async () => {
    const ticker = "TSTFMP02";
    const historicalSeries = buildHistoricalSeries(ticker);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker,
      companyName: "Duplicate Test Inc.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker,
      price: 210,
      previousClose: 208,
      close: 210,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      historicalSeries,
    );

    await ingestTickerMarketData(ticker, { historicalLimit: 3 });
    const secondRun = await ingestTickerMarketData(ticker, { historicalLimit: 3 });

    expect(secondRun.historicalSnapshotsCreated).toBe(0);
    expect(secondRun.historicalSnapshotsUpdated).toBe(0);
    expect(secondRun.historicalSnapshotsSkipped).toBe(3);
  });

  it("selects the latest quote over stale historical closes across core services", async () => {
    const ticker = "TSTFMPQVS";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker,
      companyName: "Quote Priority Test Co.",
      exchange: "NASDAQ",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker,
      price: 310,
      previousClose: 305,
      close: 310,
      volume: 2_000_000,
      marketCap: 1_200_000_000_000,
      changePercent: 1.64,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue([
      {
        ticker,
        date: new Date("2026-05-01T00:00:00.000Z"),
        open: 220,
        high: 224,
        low: 215,
        close: 217,
        volume: 900_000,
      },
      {
        ticker,
        date: new Date("2026-04-30T00:00:00.000Z"),
        open: 216,
        high: 219,
        low: 212,
        close: 214,
        volume: 880_000,
      },
    ]);

    await ingestTickerMarketData(ticker, { historicalLimit: 2 });

    const latest = await getLatestMarketSnapshot(ticker);
    expect(latest).not.toBeNull();
    expect(latest?.price).toBe(310);

    const bundle = await getStockResearchBundle(ticker);
    expect(bundle).not.toBeNull();
    expect(bundle?.latestPriceSnapshot?.price).toBe(310);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const portfolio = await createTestPortfolio();
    await createTestHolding(portfolio.id, stock!.id);

    const overview = await getPortfolioOverview(portfolio.id);
    expect(overview).not.toBeNull();
    expect(overview?.holdings[0]?.latestPrice).toBe(310);
  });

  it("upserts stale same-day historical rows and recalculates technicals from FMP data scale", async () => {
    const ticker = "TSTFMPUPD1";

    // Seed stale null-source legacy rows on the same days as incoming FMP history.
    for (let index = 0; index < 210; index += 1) {
      const date = new Date(Date.UTC(2025, 0, 2 + index, 0, 0, 0, 0));

      await recordPriceSnapshot(ticker, {
        source: null,
        price: 210 + Math.sin(index / 9),
        close: 210 + Math.sin(index / 9),
        high: 212 + Math.sin(index / 9),
        low: 208 + Math.sin(index / 9),
        capturedAt: date,
      });
    }

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker,
      companyName: "Historical Upsert Co.",
      exchange: "NASDAQ",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker,
      price: 310.26,
      previousClose: 307,
      close: 310.26,
      volume: 100_000,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      Array.from({ length: 210 }, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 2 + index, 0, 0, 0, 0));
        const close = 295 + index * 0.08 + Math.sin(index / 7) * 1.3;

        return {
          ticker,
          date,
          open: close - 0.6,
          high: close + 1.1,
          low: close - 1.2,
          close,
          volume: 20_000 + index,
        };
      }),
    );

    const result = await ingestTickerMarketData(ticker, { historicalLimit: 210 });

    expect(result.historicalSnapshotsCreated).toBe(0);
    expect(result.historicalSnapshotsUpdated).toBe(210);
    expect(result.historicalSnapshotsSkipped).toBe(0);

    const snapshots = await listPriceSnapshotsByTicker(ticker, 600);
    const perDay = new Map<string, number>();
    for (const snapshot of snapshots) {
      const key = snapshot.capturedAt.toISOString().slice(0, 10);
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }

    // One quote row may share a day, but historical dates must remain non-duplicated by date-day.
    expect([...perDay.values()].every((count) => count <= 2)).toBe(true);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const technical = stock ? await getLatestTechnicalSnapshot(stock.id) : null;
    expect(technical).not.toBeNull();
    expect(technical?.sma50).not.toBeNull();
    expect(technical?.sma200).not.toBeNull();
    expect(technical?.fiftyTwoWeekHigh ?? 0).toBeGreaterThan(290);
    expect(technical?.fiftyTwoWeekLow ?? 9999).toBeGreaterThan(250);

    const research = await getStockResearchBundle(ticker);
    expect(research).not.toBeNull();
    expect(research?.latestTechnicalSnapshot).toBeTruthy();
    expect(research?.latestTechnicalSnapshot?.sma50 ?? 0).toBeGreaterThan(290);
  }, 15000);

  it("creates a complete technical snapshot with 250 historical prices", async () => {
    const ticker = "TSTFMP250";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker,
      companyName: "Long History Test Co.",
      exchange: "NASDAQ",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker,
      price: 180,
      previousClose: 178,
      close: 180,
      volume: 50_000,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildLongHistoricalSeries(ticker, 250),
    );

    const result = await ingestTickerMarketData(ticker, { historicalLimit: 250 });

    expect(result.technicalSnapshotCreated).toBe(true);
    expect(
      result.warnings.some((warning) => warning.toLowerCase().includes("missing sma200")),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.toLowerCase().includes("missing rsi14")),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.toLowerCase().includes("missing macd")),
    ).toBe(false);
    expect(
      result.warnings.some((warning) => warning.toLowerCase().includes("missing annualized volatility")),
    ).toBe(false);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const technicalSnapshot = stock
      ? await getLatestTechnicalSnapshot(stock.id)
      : null;

    expect(technicalSnapshot).not.toBeNull();
    expect(technicalSnapshot?.sma50).not.toBeNull();
    expect(technicalSnapshot?.sma200).not.toBeNull();
    expect(technicalSnapshot?.rsi14).not.toBeNull();
    expect(technicalSnapshot?.macd).not.toBeNull();
    expect(technicalSnapshot?.macdSignal).not.toBeNull();
    expect(technicalSnapshot?.macdHistogram).not.toBeNull();
    expect(technicalSnapshot?.trendDirection).not.toBeNull();
  });

  it("returns indicator warnings when historical data is incomplete", async () => {
    const ticker = "TSTFMPWARN";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker,
      companyName: "Short History Test Co.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker,
      price: 95,
      previousClose: 94,
      close: 95,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildLongHistoricalSeries(ticker, 25),
    );

    const result = await ingestTickerMarketData(ticker, { historicalLimit: 25 });

    expect(result.technicalSnapshotCreated).toBe(true);
    expect(
      result.warnings.some((warning) => warning.toLowerCase().includes("missing sma50")),
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.toLowerCase().includes("missing sma200")),
    ).toBe(true);
  });

  it("continues portfolio ingestion when one ticker fails", async () => {
    const portfolio = await createTestPortfolio();
    const successfulStock = await createTestStock("TSTFMPA3");
    const failingStock = await createTestStock("TSTFMPB3");

    await createTestHolding(portfolio.id, successfulStock.id);
    await createTestHolding(portfolio.id, failingStock.id);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockImplementation(async (ticker) => {
      if (ticker === successfulStock.ticker) {
        return {
          ticker,
          companyName: "Successful Co.",
          exchange: "NYSE",
        };
      }

      return {
        ticker,
        companyName: "Failing Co.",
        exchange: "NYSE",
      };
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async (ticker) => {
      if (ticker === failingStock.ticker) {
        throw new ProviderNotFoundError(
          "Financial Modeling Prep",
          `Quote not found for ticker ${ticker}.`,
        );
      }

      return {
        ticker,
        price: 55,
        previousClose: 54,
        close: 55,
      };
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (ticker) => buildHistoricalSeries(ticker),
    );

    const result = await ingestPortfolioMarketData(portfolio.id, {
      historicalLimit: 3,
    });

    expect(result.portfolioId).toBe(portfolio.id);
    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.failedTickers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticker: failingStock.ticker,
        }),
      ]),
    );
  });

  it("ingests ticker fundamentals and stores latest fundamental snapshot", async () => {
    const ticker = "TSTFMPF1";

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker,
      period: "Q1",
      fiscalYear: 2026,
      fiscalQuarter: "Q1",
      marketCap: 50_000_000_000,
      peRatio: 18.2,
      revenueGrowth: 0.14,
      grossMargin: 0.51,
      debtToEquity: 0.7,
      freeCashFlow: 1_200_000_000,
      source: "FMP",
    });

    const result = await ingestTickerFundamentals(ticker);

    expect(result.ticker).toBe(ticker);
    expect(result.snapshotCreated).toBe(true);
    expect(result.snapshotUpdated).toBe(false);
    expect(result.snapshotSkipped).toBe(false);
    expect(result.fieldsPopulated).toEqual(
      expect.arrayContaining([
        "period",
        "fiscalYear",
        "fiscalQuarter",
        "marketCap",
        "peRatio",
        "revenueGrowth",
        "grossMargin",
        "debtToEquity",
        "freeCashFlow",
        "source",
      ]),
    );

    const latest = await getLatestFundamentals(ticker);
    expect(latest).not.toBeNull();
    expect(latest?.source).toBe("FMP");
    expect(latest?.marketCap).toBe(BigInt(50_000_000_000));
    expect(latest?.freeCashFlow).toBe(BigInt(1_200_000_000));
  });

  it("updates same-day fundamentals snapshot on repeated ingestion", async () => {
    const ticker = "TSTFMPF2";

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals")
      .mockResolvedValueOnce({
        ticker,
        marketCap: 12_000_000_000,
        peRatio: 22,
        pegRatio: 2.1,
        priceToSales: 6.5,
        priceToBook: 9.2,
        evToEbitda: 15.8,
        debtToEquity: 1.3,
        currentRatio: 1.05,
        grossMargin: 0.42,
        operatingMargin: 0.2,
        netMargin: 0.17,
        dividendYield: 0.004,
        eps: 4.4,
        source: "FMP",
      })
      .mockResolvedValueOnce({
        ticker,
        marketCap: 13_500_000_000,
        peRatio: 18,
        pegRatio: 1.7,
        priceToSales: 5.8,
        priceToBook: 8.6,
        evToEbitda: 13.2,
        debtToEquity: 0.95,
        currentRatio: 1.21,
        grossMargin: 0.46,
        operatingMargin: 0.24,
        netMargin: 0.19,
        dividendYield: 0.0045,
        eps: 5.1,
        source: "FMP",
      });

    const firstRun = await ingestTickerFundamentals(ticker);
    const secondRun = await ingestTickerFundamentals(ticker);

    expect(firstRun.snapshotCreated).toBe(true);
    expect(firstRun.snapshotUpdated).toBe(false);
    expect(firstRun.snapshotSkipped).toBe(false);

    expect(secondRun.snapshotCreated).toBe(false);
    expect(secondRun.snapshotUpdated).toBe(true);
    expect(secondRun.snapshotSkipped).toBe(false);
    expect(secondRun.fieldsPopulated).toEqual(
      expect.arrayContaining([
        "marketCap",
        "peRatio",
        "pegRatio",
        "priceToSales",
        "priceToBook",
        "evToEbitda",
        "debtToEquity",
        "currentRatio",
        "grossMargin",
        "operatingMargin",
        "netMargin",
        "dividendYield",
        "eps",
      ]),
    );
    expect(secondRun.warnings.some((warning) => warning.includes("already exists"))).toBe(false);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const snapshots = await listFundamentalSnapshotsByStockId(stock!.id, 10);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.marketCap).toBe(BigInt(13_500_000_000));
    expect(snapshots[0]?.peRatio).toBe(18);
    expect(snapshots[0]?.pegRatio).toBe(1.7);
    expect(snapshots[0]?.priceToSales).toBe(5.8);
    expect(snapshots[0]?.priceToBook).toBe(8.6);
    expect(snapshots[0]?.evToEbitda).toBe(13.2);
    expect(snapshots[0]?.debtToEquity).toBe(0.95);
    expect(snapshots[0]?.currentRatio).toBe(1.21);
    expect(snapshots[0]?.grossMargin).toBe(0.46);
    expect(snapshots[0]?.operatingMargin).toBe(0.24);
    expect(snapshots[0]?.netMargin).toBe(0.19);
    expect(snapshots[0]?.dividendYield).toBe(0.0045);
    expect(snapshots[0]?.eps).toBe(5.1);
  });

  it("creates a new fundamentals snapshot on a different UTC day", async () => {
    vi.useFakeTimers();
    const ticker = "TSTFMPF3";

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals")
      .mockResolvedValueOnce({
        ticker,
        marketCap: 9_100_000_000,
        peRatio: 24,
        source: "FMP",
      })
      .mockResolvedValueOnce({
        ticker,
        marketCap: 9_200_000_000,
        peRatio: 23,
        source: "FMP",
      });

    vi.setSystemTime(new Date("2026-06-04T10:00:00.000Z"));
    const firstRun = await ingestTickerFundamentals(ticker);

    vi.setSystemTime(new Date("2026-06-05T10:00:00.000Z"));
    const secondRun = await ingestTickerFundamentals(ticker);

    expect(firstRun.snapshotCreated).toBe(true);
    expect(firstRun.snapshotUpdated).toBe(false);
    expect(secondRun.snapshotCreated).toBe(true);
    expect(secondRun.snapshotUpdated).toBe(false);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const snapshots = await listFundamentalSnapshotsByStockId(stock!.id, 10);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("continues portfolio fundamentals ingestion when one ticker fails", async () => {
    const portfolio = await createTestPortfolio();
    const successfulStock = await createTestStock("TSTFMPC1");
    const failingStock = await createTestStock("TSTFMPC2");

    await createTestHolding(portfolio.id, successfulStock.id);
    await createTestHolding(portfolio.id, failingStock.id);

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(
      async (ticker) => {
        if (ticker === failingStock.ticker) {
          throw new ProviderNotFoundError(
            "Financial Modeling Prep",
            `Fundamentals not found for ticker ${ticker}.`,
          );
        }

        return {
          ticker,
          marketCap: 7_500_000_000,
          peRatio: 19,
          source: "FMP",
        };
      },
    );

    const result = await ingestPortfolioFundamentals(portfolio.id);

    expect(result.portfolioId).toBe(portfolio.id);
    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.failedTickers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticker: failingStock.ticker,
        }),
      ]),
    );
  });

  it("ingests ticker earnings and stores events", async () => {
    const ticker = "TSTFMPER1";

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue({
      ticker,
      fiscalQuarter: "Q2",
      fiscalYear: 2026,
      earningsDate: new Date("2026-08-03T12:30:00.000Z"),
      estimatedEps: 1.42,
      estimatedRevenue: 88_500_000_000,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([
      {
        ticker,
        fiscalQuarter: "Q1",
        fiscalYear: 2026,
        earningsDate: new Date("2026-05-03T12:30:00.000Z"),
        estimatedEps: 1.31,
        reportedEps: 1.35,
        source: "FMP",
      },
    ]);

    const result = await ingestTickerEarnings(ticker);

    expect(result.ticker).toBe(ticker);
    expect(result.eventsCreated).toBeGreaterThanOrEqual(1);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const events = await listEarningsEventsByStockId(stock!.id);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((event) => event.fiscalQuarter === "Q2")).toBe(true);
  });

  it("skips blank placeholder earnings events during ticker ingestion", async () => {
    const ticker = "TSTFMPER2";

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue({
      ticker,
      earningsDate: new Date("2026-08-03T12:30:00.000Z"),
      // Placeholder-style event: no estimated/reported EPS or revenue values.
    });

    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([
      {
        ticker,
        earningsDate: new Date("2026-05-03T12:30:00.000Z"),
        estimatedEps: 1.31,
        reportedEps: 1.35,
      },
    ]);

    const result = await ingestTickerEarnings(ticker);

    expect(result.ticker).toBe(ticker);
    expect(result.eventsCreated).toBe(1);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const events = await listEarningsEventsByStockId(stock!.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.estimatedEps).toBe(1.31);
    expect(events[0]?.reportedEps).toBe(1.35);
  });

  it("continues portfolio earnings ingestion when one ticker fails", async () => {
    const portfolio = await createTestPortfolio();
    const successfulStock = await createTestStock("TSTFMPE1");
    const failingStock = await createTestStock("TSTFMPE2");

    await createTestHolding(portfolio.id, successfulStock.id);
    await createTestHolding(portfolio.id, failingStock.id);

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockImplementation(async (ticker) => {
      if (ticker === failingStock.ticker) {
        throw new ProviderNotFoundError(
          "Financial Modeling Prep",
          `Earnings not found for ticker ${ticker}.`,
        );
      }

      return {
        ticker,
        fiscalQuarter: "Q2",
        fiscalYear: 2026,
        earningsDate: new Date("2026-08-03T12:30:00.000Z"),
        estimatedEps: 1.42,
        source: "FMP",
      };
    });

    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);

    const result = await ingestPortfolioEarnings(portfolio.id);

    expect(result.portfolioId).toBe(portfolio.id);
    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.failedTickers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticker: failingStock.ticker,
        }),
      ]),
    );
  });

  it("ingests ticker news and applies deterministic sentiment/materiality fallback", async () => {
    const ticker = "TSTFMPNW1";

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([
      {
        ticker,
        headline: "Company beats estimates and raises guidance",
        summary: "Management highlighted strong demand growth.",
        url: "https://example.com/news/tstfmpnw1-1",
        source: "Example Wire",
        publishedAt: new Date("2026-05-04T00:00:00.000Z"),
      },
      {
        ticker,
        headline: "Analyst note",
        summary: "Coverage maintained.",
        url: "https://example.com/news/tstfmpnw1-2",
        source: "Example Wire",
        publishedAt: new Date("2026-05-04T01:00:00.000Z"),
        sentiment: "negative",
        materialityScore: 0.2,
      },
    ]);

    const result = await ingestTickerNews(ticker, { limit: 10 });

    expect(result.ticker).toBe(ticker);
    expect(result.articlesCreated).toBe(2);
    expect(result.articlesUpdated).toBe(0);
    expect(result.articlesSkipped).toBe(0);

    const stored = await listRecentNewsByTicker(ticker, 10);
    expect(stored).toHaveLength(2);
    expect(stored.some((article) => article.sentiment === "BULLISH")).toBe(true);
    expect(stored.some((article) => article.sentiment === "BEARISH")).toBe(true);
    expect(stored.some((article) => (article.materialityScore ?? 0) > 0.4)).toBe(true);
  });

  it("continues portfolio news ingestion when one ticker fails", async () => {
    const portfolio = await createTestPortfolio();
    const successfulStock = await createTestStock("TSTFMPNWA");
    const failingStock = await createTestStock("TSTFMPNWB");

    await createTestHolding(portfolio.id, successfulStock.id);
    await createTestHolding(portfolio.id, failingStock.id);

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockImplementation(async (ticker) => {
      if (ticker === failingStock.ticker) {
        throw new ProviderNotFoundError(
          "Financial Modeling Prep",
          `News not found for ticker ${ticker}.`,
        );
      }

      return [
        {
          ticker,
          headline: "Partnership announced",
          url: `https://example.com/news/${ticker.toLowerCase()}-1`,
          publishedAt: new Date("2026-05-05T00:00:00.000Z"),
        },
      ];
    });

    const result = await ingestPortfolioNews(portfolio.id, { limitPerTicker: 5 });

    expect(result.portfolioId).toBe(portfolio.id);
    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.failedTickers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticker: failingStock.ticker,
        }),
      ]),
    );
  });

  it("runs full-refresh categories in order", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFR1");

    await createTestHolding(portfolio.id, stock.id);

    const stepOrder: string[] = [];

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: stock.ticker,
      companyName: "Refresh Co.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async () => {
      if (!stepOrder.includes("market")) {
        stepOrder.push("market");
      }

      return {
        ticker: stock.ticker,
        price: 101,
        previousClose: 100,
        close: 101,
      };
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries(stock.ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(async () => {
      if (!stepOrder.includes("fundamentals")) {
        stepOrder.push("fundamentals");
      }

      return {
        ticker: stock.ticker,
        marketCap: 1_000_000_000,
        peRatio: 22,
        source: "FMP",
      };
    });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockImplementation(async () => {
      if (!stepOrder.includes("earnings")) {
        stepOrder.push("earnings");
      }

      return {
        ticker: stock.ticker,
        fiscalQuarter: "Q2",
        fiscalYear: 2026,
        earningsDate: new Date("2026-08-03T12:30:00.000Z"),
      };
    });
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockImplementation(async () => {
      if (!stepOrder.includes("news")) {
        stepOrder.push("news");
      }

      return [
        {
          ticker: stock.ticker,
          headline: "Refresh headline",
          url: "https://example.com/refresh-headline",
          publishedAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      ];
    });

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      historicalLimit: 10,
      newsLimitPerTicker: 5,
      runAnalysis: false,
    });

    expect(result.portfolioId).toBe(portfolio.id);
    expect(stepOrder).toEqual(["market", "fundamentals", "earnings", "news"]);
  });

  it("full-refresh continues and returns warnings when a category has partial ticker failures", async () => {
    const portfolio = await createTestPortfolio();
    const successfulStock = await createTestStock("TSTFMPFR2A");
    const failingStock = await createTestStock("TSTFMPFR2B");

    await createTestHolding(portfolio.id, successfulStock.id);
    await createTestHolding(portfolio.id, failingStock.id);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue(null);
    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async (ticker) => {
      if (ticker === failingStock.ticker) {
        throw new ProviderNotFoundError(
          "Financial Modeling Prep",
          `Quote not found for ticker ${ticker}.`,
        );
      }

      return {
        ticker,
        price: 120,
        previousClose: 119,
        close: 120,
      };
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (ticker) => buildHistoricalSeries(ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker: successfulStock.ticker,
      marketCap: 2_000_000_000,
      peRatio: 20,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      historicalLimit: 10,
      newsLimitPerTicker: 5,
      runAnalysis: false,
    });

    expect(result.marketData.tickersFailed).toBe(1);
    expect(result.fundamentals).toBeDefined();
    expect(result.earnings).toBeDefined();
    expect(result.news).toBeDefined();
    expect(result.warnings.some((warning) => warning.includes("Market-data ingestion"))).toBe(
      true,
    );
  });

  it("full-refresh market-data succeeds when legacy same-day duplicates exist", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRLEG");

    await createTestHolding(portfolio.id, stock.id);

    const duplicateDays = [
      new Date("2026-04-01T00:00:00.000Z"),
      new Date("2026-04-02T00:00:00.000Z"),
      new Date("2026-04-03T00:00:00.000Z"),
    ];

    for (const day of duplicateDays) {
      await recordPriceSnapshot(stock.ticker, {
        source: "FMP_HISTORICAL",
        price: 210,
        close: 210,
        capturedAt: day,
      });

      await recordPriceSnapshot(stock.ticker, {
        source: null,
        price: 180,
        close: 180,
        capturedAt: new Date(
          Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            20,
            0,
            0,
            0,
          ),
        ),
      });
    }

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: stock.ticker,
      companyName: "Legacy Duplicate Co.",
      exchange: "NASDAQ",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker: stock.ticker,
      price: 320,
      previousClose: 318,
      close: 320,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue([
      {
        ticker: stock.ticker,
        date: new Date("2026-04-01T00:00:00.000Z"),
        open: 300,
        high: 303,
        low: 299,
        close: 301,
        volume: 20_000,
      },
      {
        ticker: stock.ticker,
        date: new Date("2026-04-02T00:00:00.000Z"),
        open: 301,
        high: 304,
        low: 300,
        close: 302,
        volume: 20_500,
      },
      {
        ticker: stock.ticker,
        date: new Date("2026-04-03T00:00:00.000Z"),
        open: 302,
        high: 305,
        low: 301,
        close: 303,
        volume: 21_000,
      },
    ]);

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker: stock.ticker,
      marketCap: 5_000_000_000,
      peRatio: 19,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      historicalLimit: 3,
      newsLimitPerTicker: 5,
      runAnalysis: false,
    });

    expect(result.marketData.tickersFailed).toBe(0);
    expect(result.marketData.results[0]?.historicalSnapshotsUpdated).toBe(3);

    const snapshots = await listPriceSnapshotsByTicker(stock.ticker, 100);
    const nullSourceRows = snapshots.filter((snapshot) => snapshot.source === null);
    expect(nullSourceRows).toHaveLength(0);

    const canonicalPricesByDay = new Map(
      snapshots
        .filter(
          (snapshot) =>
            snapshot.source === "FMP_HISTORICAL" &&
            snapshot.capturedAt.getUTCHours() === 0 &&
            snapshot.capturedAt.getUTCMinutes() === 0,
        )
        .map((snapshot) => [snapshot.capturedAt.toISOString().slice(0, 10), snapshot.price]),
    );

    expect(canonicalPricesByDay.get("2026-04-01")).toBe(301);
    expect(canonicalPricesByDay.get("2026-04-02")).toBe(302);
    expect(canonicalPricesByDay.get("2026-04-03")).toBe(303);
  });

  it("full-refresh returns analysis when runAnalysis=true", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFR3");

    await createTestHolding(portfolio.id, stock.id);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: stock.ticker,
      companyName: "Analysis Co.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker: stock.ticker,
      price: 140,
      previousClose: 138,
      close: 140,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries(stock.ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker: stock.ticker,
      marketCap: 3_000_000_000,
      peRatio: 18,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    const analysisSpy = vi.spyOn(
      portfolioAnalysisService,
      "runPortfolioAnalysis",
    );

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      runAnalysis: true,
    });

    expect(result.analysis).toBeDefined();
    expect(analysisSpy).toHaveBeenCalled();
  });

  it("full-refresh includes durationMs on top-level and executed sections", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRDUR");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeEconomics: false,
      includeBankOfCanada: false,
      includeFred: false,
      runAnalysis: true,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.marketData.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.fundamentals.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.earnings.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.news.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.analysis?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.economics).toBeUndefined();
    expect(result.bankOfCanada).toBeUndefined();
    expect(result.fred).toBeUndefined();
    expect(result.macro).toBeUndefined();
  });

  it("full-refresh includes analyst data when includeAnalystData=true", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRAN1");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const analystSpy = vi
      .spyOn(analystIngestionService, "ingestPortfolioAnalystData")
      .mockResolvedValue({
        portfolioId: portfolio.id,
        startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
        finishedAt: new Date("2026-06-20T00:00:01.000Z").toISOString(),
        durationMs: 1000,
        tickersProcessed: 1,
        tickersFailed: 0,
        snapshotsCreated: 1,
        snapshotsUpdated: 0,
        actionsCreated: 1,
        actionsUpdated: 0,
        results: [
          {
            ticker: stock.ticker,
            snapshotsCreated: 1,
            snapshotsUpdated: 0,
            actionsCreated: 1,
            actionsUpdated: 0,
            warnings: [],
          },
        ],
        failedTickers: [],
        warnings: [],
      });

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeAnalystData: true,
      includeEconomics: false,
      includeBankOfCanada: false,
      includeFred: false,
      runAnalysis: false,
    });

    expect(analystSpy).toHaveBeenCalledWith(portfolio.id);
    expect(result.analystData).toBeDefined();
    expect(result.analystData?.snapshotsCreated).toBe(1);
  });

  it("full-refresh omits analyst data and skips analyst ingestion when includeAnalystData=false", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRAN0");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const analystSpy = vi.spyOn(analystIngestionService, "ingestPortfolioAnalystData");

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeAnalystData: false,
      includeEconomics: false,
      includeBankOfCanada: false,
      includeFred: false,
      runAnalysis: false,
    });

    expect(analystSpy).not.toHaveBeenCalled();
    expect(result.analystData).toBeUndefined();
  });

  it("full-refresh includes geopolitical data when includeGdelt=true", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRGD1");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const geopoliticalSpy = vi
      .spyOn(geopoliticalIngestionService, "ingestDefaultGdeltRiskSet")
      .mockResolvedValue({
        startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
        finishedAt: new Date("2026-06-20T00:00:02.000Z").toISOString(),
        durationMs: 2000,
        queriesProcessed: 8,
        queriesFailed: 0,
        eventsCreated: 12,
        eventsUpdated: 2,
        eventsSkipped: 1,
        warnings: [],
        failedQueries: [],
        results: [],
      });

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeGdelt: true,
      gdeltLookbackDays: 5,
      gdeltMaxRecordsPerQuery: 20,
      includeEconomics: false,
      includeBankOfCanada: false,
      includeFred: false,
      runAnalysis: false,
    });

    expect(geopoliticalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "quick",
        maxRecordsPerQuery: 20,
      }),
    );
    expect(result.geopolitical).toBeDefined();
    expect(result.geopolitical?.eventsCreated).toBe(12);
  });

  it("full-refresh omits geopolitical data and skips GDELT ingestion when includeGdelt=false", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRGD0");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const geopoliticalSpy = vi.spyOn(
      geopoliticalIngestionService,
      "ingestDefaultGdeltRiskSet",
    );

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeGdelt: false,
      includeEconomics: false,
      includeBankOfCanada: false,
      includeFred: false,
      runAnalysis: false,
    });

    expect(geopoliticalSpy).not.toHaveBeenCalled();
    expect(result.geopolitical).toBeUndefined();
  });

  it("full-refresh omits economics and does not call economics ingestion when includeEconomics=false", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRECO0");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const economicsSpy = vi.spyOn(fmpEconomicsIngestionService, "ingestFmpEconomicsDefaultSet");

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeEconomics: false,
      runAnalysis: false,
    });

    expect(economicsSpy).not.toHaveBeenCalled();
    expect(result.economics).toBeUndefined();
  });

  it("full-refresh includeFred=false omits fred and forwards includeFred=false to macro ingestion", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRFRED0");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const macroSpy = vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx").mockResolvedValue({
      startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-20T00:00:05.000Z").toISOString(),
      durationMs: 5000,
      bankOfCanada: {
        recordsCreated: 1,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: [],
      },
      fred: {
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: [],
      },
      warnings: [],
    });

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeBankOfCanada: true,
      includeFred: false,
      runAnalysis: false,
    });

    expect(macroSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBankOfCanada: true,
        includeFred: false,
      }),
    );
    expect(result.bankOfCanada).toBeDefined();
    expect(result.fred).toBeUndefined();
  });

  it("full-refresh includeBankOfCanada=false omits bankOfCanada and forwards includeBankOfCanada=false", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRBOC0");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const macroSpy = vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx").mockResolvedValue({
      startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-20T00:00:05.000Z").toISOString(),
      durationMs: 5000,
      bankOfCanada: {
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: [],
      },
      fred: {
        recordsCreated: 2,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: [],
      },
      warnings: [],
    });

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeBankOfCanada: false,
      includeFred: true,
      runAnalysis: false,
    });

    expect(macroSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBankOfCanada: false,
        includeFred: true,
      }),
    );
    expect(result.bankOfCanada).toBeUndefined();
    expect(result.fred).toBeDefined();
  });

  it("does not warn about missing FRED API key when includeFred=false", async () => {
    const originalFredApiKey = env.FRED_API_KEY;
    env.FRED_API_KEY = undefined;

    try {
      const portfolio = await createTestPortfolio();
      const stock = await createTestStock("TSTFMPFRNFRD");

      await createTestHolding(portfolio.id, stock.id);
      mockSuccessfulFullRefreshProviders(stock.ticker);

      const macroSpy = vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx");

      const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
        includeEconomics: false,
        includeBankOfCanada: false,
        includeFred: false,
        runAnalysis: false,
      });

      expect(macroSpy).not.toHaveBeenCalled();
      expect(result.warnings.some((warning) => /fred/i.test(warning))).toBe(false);
      expect(result.fred).toBeUndefined();
    } finally {
      env.FRED_API_KEY = originalFredApiKey;
    }
  });

  it("passes fredObservationLimit and bocObservationLimit to macro ingestion", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRLIM1");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const macroSpy = vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx").mockResolvedValue({
      startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-20T00:00:02.000Z").toISOString(),
      durationMs: 2000,
      bankOfCanada: {
        recordsCreated: 0,
        recordsUpdated: 1,
        recordsSkipped: 0,
        warnings: [],
      },
      fred: {
        recordsCreated: 0,
        recordsUpdated: 2,
        recordsSkipped: 0,
        warnings: [],
      },
      warnings: [],
    });

    await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeBankOfCanada: true,
      includeFred: true,
      bocObservationLimit: 44,
      fredObservationLimit: 33,
      macroMaxSeries: 5,
      runAnalysis: false,
    });

    expect(macroSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBankOfCanada: true,
        includeFred: true,
        bankOfCanadaLimit: 44,
        fredObservationLimit: 33,
        maxFredSeries: 5,
      }),
    );
  });

  it("passes configured economics calendar past/future windows", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRECO1");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    const economicsSpy = vi
      .spyOn(fmpEconomicsIngestionService, "ingestFmpEconomicsDefaultSet")
      .mockResolvedValue({
        startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
        finishedAt: new Date("2026-06-20T00:00:03.000Z").toISOString(),
        durationMs: 3000,
        treasuryRates: {
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          warnings: [],
        },
        economicIndicators: {
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          warnings: [],
        },
        economicCalendar: {
          recordsCreated: 1,
          recordsUpdated: 0,
          recordsSkipped: 0,
          warnings: [],
        },
        marketRiskPremium: {
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsSkipped: 0,
          warnings: [],
        },
        warnings: [],
      });

    await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeEconomics: true,
      economicsCalendarPastDays: 3,
      economicsCalendarFutureDays: 14,
      runAnalysis: false,
    });

    const callInput = economicsSpy.mock.calls[0]?.[0];
    expect(callInput).toBeDefined();
    expect(callInput?.calendarFrom).toBeInstanceOf(Date);
    expect(callInput?.calendarTo).toBeInstanceOf(Date);

    if (callInput?.calendarFrom && callInput?.calendarTo) {
      const spanDays =
        (callInput.calendarTo.getTime() - callInput.calendarFrom.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(spanDays).toBeGreaterThanOrEqual(16.9);
      expect(spanDays).toBeLessThanOrEqual(17.1);
    }
  });

  it("continues full-refresh when provider timeout occurs and returns warnings", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRTIME");

    await createTestHolding(portfolio.id, stock.id);
    mockSuccessfulFullRefreshProviders(stock.ticker);

    vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx").mockRejectedValue(
      new Error("Request to FRED timed out after 20000ms."),
    );

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeEconomics: false,
      includeBankOfCanada: false,
      includeFred: true,
      runAnalysis: false,
    });

    expect(result.marketData).toBeDefined();
    expect(result.fundamentals).toBeDefined();
    expect(result.earnings).toBeDefined();
    expect(result.news).toBeDefined();
    expect(result.fred).toBeDefined();
    expect(result.fred?.warnings.some((warning) => /timed out/i.test(warning))).toBe(true);
  });

  it("full-refresh includes BoC/FRED macro results when flags are enabled", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRMAC1");

    await createTestHolding(portfolio.id, stock.id);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: stock.ticker,
      companyName: "Macro Refresh Co.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker: stock.ticker,
      price: 222,
      previousClose: 219,
      close: 222,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries(stock.ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker: stock.ticker,
      marketCap: 3_000_000_000,
      peRatio: 18,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    const macroSpy = vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx").mockResolvedValue({
      startedAt: new Date("2026-06-20T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-20T00:01:00.000Z").toISOString(),
      bankOfCanada: {
        recordsCreated: 1,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: [],
      },
      fred: {
        recordsCreated: 3,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: [],
      },
      warnings: [],
    });

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeBankOfCanada: true,
      includeFred: true,
      runAnalysis: false,
    });

    expect(macroSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBankOfCanada: true,
        includeFred: true,
      }),
    );
    expect(result.macro).toBeDefined();
    expect(result.bankOfCanada?.recordsCreated).toBe(1);
    expect(result.fred?.recordsCreated).toBe(3);
  });

  it("full-refresh remains non-blocking when macro ingestion throws", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFRMAC2");

    await createTestHolding(portfolio.id, stock.id);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: stock.ticker,
      companyName: "Macro Warning Co.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker: stock.ticker,
      price: 188,
      previousClose: 186,
      close: 188,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries(stock.ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker: stock.ticker,
      marketCap: 2_200_000_000,
      peRatio: 16,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    vi.spyOn(macroIngestionService, "ingestDefaultMacroAndFx").mockRejectedValue(
      new Error("macro pipeline unavailable"),
    );

    const result = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      includeBankOfCanada: true,
      includeFred: true,
      runAnalysis: false,
    });

    expect(result.marketData).toBeDefined();
    expect(result.fundamentals).toBeDefined();
    expect(result.earnings).toBeDefined();
    expect(result.news).toBeDefined();
    expect(result.macro?.warnings.join(" ")).toContain("macro pipeline unavailable");
    expect(result.warnings.some((warning) => warning.includes("Macro ingestion"))).toBe(true);
  });

  it("full-refresh second run refreshes same-day fundamentals and updates same-day report summary", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTFMPFR4");

    await createTestHolding(portfolio.id, stock.id);

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: stock.ticker,
      companyName: "Refresh Fundamentals Co.",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker: stock.ticker,
      price: 150,
      previousClose: 148,
      close: 150,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries(stock.ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals")
      .mockResolvedValueOnce({
        ticker: stock.ticker,
        peRatio: 52,
        revenueGrowth: 0.01,
        marketCap: 4_000_000_000,
        source: "FMP",
      })
      .mockResolvedValueOnce({
        ticker: stock.ticker,
        peRatio: 18,
        revenueGrowth: 0.18,
        marketCap: 4_500_000_000,
        source: "FMP",
      });

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    const firstRun = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      runAnalysis: true,
    });

    const secondRun = await ingestPortfolioFmpFullRefresh(portfolio.id, {
      runAnalysis: true,
    });

    expect(firstRun.fundamentals.snapshotsCreated).toBe(1);
    expect(firstRun.fundamentals.snapshotsUpdated).toBe(0);

    expect(secondRun.fundamentals.snapshotsCreated).toBe(0);
    expect(secondRun.fundamentals.snapshotsUpdated).toBe(1);
    expect(secondRun.fundamentals.results[0]?.snapshotUpdated).toBe(true);
    expect(
      secondRun.fundamentals.results[0]?.warnings.some((warning) =>
        warning.includes("already exists for today"),
      ) ?? false,
    ).toBe(false);

    const latestReport = await getLatestAIReportByStockId(stock.id);
    expect(latestReport).not.toBeNull();
    expect(latestReport?.fundamentalSummary).toContain("P/E 18.0");

    const snapshots = await listFundamentalSnapshotsByStockId(stock.id, 10);
    const sameDaySnapshots = snapshots.filter((snapshot) => {
      return (
        snapshot.capturedAt.getUTCFullYear() === snapshots[0]?.capturedAt.getUTCFullYear() &&
        snapshot.capturedAt.getUTCMonth() === snapshots[0]?.capturedAt.getUTCMonth() &&
        snapshot.capturedAt.getUTCDate() === snapshots[0]?.capturedAt.getUTCDate()
      );
    });

    expect(sameDaySnapshots).toHaveLength(1);
  });
});