import { afterEach, describe, expect, it, vi } from "vitest";

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
import { listRecentNewsByTicker } from "../../src/repositories/news-articles.repository";
import { listPriceSnapshotsByTicker } from "../../src/repositories/price-snapshots.repository";
import { getLatestTechnicalSnapshot } from "../../src/repositories/technical-snapshots.repository";
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
import * as portfolioAnalysisService from "../../src/services/portfolio-analysis.service";
import { getLatestFundamentals } from "../../src/services/fundamentals.service";
import { getStockProfile } from "../../src/services/stocks.service";
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

describe("real-data-ingestion.service", () => {
  afterEach(() => {
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
    expect(result.historicalSnapshotsSkipped).toBe(0);
    expect(result.technicalSnapshotCreated).toBe(true);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();
    expect(stock?.companyName).toBe("Test FMP Company");
    expect(stock?.exchange).toBe("NASDAQ");

    const snapshots = await listPriceSnapshotsByTicker(ticker, 20);
    expect(snapshots.length).toBeGreaterThanOrEqual(4);

    const technicalSnapshot = stock
      ? await getLatestTechnicalSnapshot(stock.id)
      : null;
    expect(technicalSnapshot).not.toBeNull();
  });

  it("skips duplicate historical snapshots on repeated ingestion", async () => {
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
    expect(secondRun.historicalSnapshotsSkipped).toBe(3);
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

  it("skips same-day fundamentals snapshot on repeated ingestion", async () => {
    const ticker = "TSTFMPF2";

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker,
      marketCap: 12_000_000_000,
      peRatio: 22,
      source: "FMP",
    });

    await ingestTickerFundamentals(ticker);
    const secondRun = await ingestTickerFundamentals(ticker);

    expect(secondRun.snapshotCreated).toBe(false);
    expect(secondRun.warnings.some((warning) => warning.includes("already exists"))).toBe(
      true,
    );
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
});