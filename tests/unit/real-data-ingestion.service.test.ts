import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderNotFoundError } from "../../src/providers/errors";
import {
  fmpFundamentalsProvider,
  fmpMarketDataProvider,
  fmpProfileProvider,
} from "../../src/providers/fmp";
import { ProviderHistoricalPrice } from "../../src/providers/types";
import { listPriceSnapshotsByTicker } from "../../src/repositories/price-snapshots.repository";
import { getLatestTechnicalSnapshot } from "../../src/repositories/technical-snapshots.repository";
import {
  ingestPortfolioFundamentals,
  ingestPortfolioMarketData,
  ingestTickerFundamentals,
  ingestTickerMarketData,
} from "../../src/services/real-data-ingestion.service";
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
});