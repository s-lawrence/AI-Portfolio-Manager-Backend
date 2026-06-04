import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { env } from "../../src/config/env";
import {
  fmpEarningsProvider,
  fmpFundamentalsProvider,
  fmpMarketDataProvider,
  fmpNewsProvider,
  fmpProfileProvider,
} from "../../src/providers/fmp";
import { ProviderHistoricalPrice } from "../../src/providers/types";
import { createUser } from "../../src/repositories/users.repository";

function buildHistoricalSeries(ticker: string): ProviderHistoricalPrice[] {
  return [
    {
      ticker,
      date: new Date("2026-01-01T00:00:00.000Z"),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    },
    {
      ticker,
      date: new Date("2026-01-02T00:00:00.000Z"),
      open: 100,
      high: 102,
      low: 99.5,
      close: 101,
      volume: 1200,
    },
  ];
}

describe("API ingestion routes", () => {
  const originalFmpApiKey = env.FMP_API_KEY;

  afterEach(() => {
    env.FMP_API_KEY = originalFmpApiKey;
    vi.restoreAllMocks();
  });

  it("returns success envelope for ticker ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockResolvedValue({
      ticker: "TSTAPI01",
      companyName: "API Test Company",
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    });

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockResolvedValue({
      ticker: "TSTAPI01",
      price: 112,
      previousClose: 110,
      close: 112,
      volume: 2000,
      marketCap: 1_000_000,
    });

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockResolvedValue(
      buildHistoricalSeries("TSTAPI01"),
    );

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/ticker/TSTAPI01/market-data",
      payload: {
        historicalLimit: 250,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.ticker).toBe("TSTAPI01");
    expect(typeof body.data.quoteSnapshotCreated).toBe("boolean");

    await app.close();
  });

  it("returns success envelope for portfolio ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockImplementation(async (ticker) => ({
      ticker,
      companyName: `${ticker} Company`,
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    }));

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async (ticker) => ({
      ticker,
      price: 90,
      previousClose: 89,
      close: 90,
      volume: 10_000,
    }));

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (ticker) => buildHistoricalSeries(ticker),
    );

    const app = buildApp();

    const user = await createUser({
      email: `test+api-ingestion-${Date.now()}@example.com`,
      name: "[TEST] API Ingestion User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Ingestion Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTPFA01",
        status: "OWNED",
        shares: 5,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTPFB01",
        status: "WATCHLIST",
      },
    });

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/market-data`,
      payload: {
        historicalLimit: 250,
        runAnalysis: false,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.portfolioId).toBe(portfolioId);
    expect(body.data.tickersProcessed).toBe(2);
    expect(Array.isArray(body.data.results)).toBe(true);

    await app.close();
  });

  it("returns success envelope for ticker fundamentals ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockResolvedValue({
      ticker: "TSTFUN01",
      period: "Q1",
      fiscalYear: 2026,
      fiscalQuarter: "Q1",
      marketCap: 1_500_000_000,
      peRatio: 17,
      revenueGrowth: 0.08,
      source: "FMP",
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/ticker/TSTFUN01/fundamentals",
      payload: {},
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.ticker).toBe("TSTFUN01");
    expect(typeof body.data.snapshotCreated).toBe("boolean");
    expect(Array.isArray(body.data.fieldsPopulated)).toBe(true);

    await app.close();
  });

  it("returns success envelope for portfolio fundamentals ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(
      async (ticker) => ({
        ticker,
        marketCap: 2_000_000_000,
        peRatio: 20,
        source: "FMP",
      }),
    );

    const app = buildApp();

    const user = await createUser({
      email: `test+api-fund-ingestion-${Date.now()}@example.com`,
      name: "[TEST] API Fundamentals Ingestion User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Fundamentals Ingestion Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFPA01",
        status: "OWNED",
        shares: 5,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFPB01",
        status: "WATCHLIST",
      },
    });

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/fundamentals`,
      payload: {},
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.portfolioId).toBe(portfolioId);
    expect(body.data.tickersProcessed).toBe(2);
    expect(Array.isArray(body.data.results)).toBe(true);

    await app.close();
  });

  it("returns success envelope for full-basic portfolio ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockImplementation(async (ticker) => ({
      ticker,
      companyName: `${ticker} Company`,
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    }));

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async (ticker) => ({
      ticker,
      price: 110,
      previousClose: 108,
      close: 110,
      volume: 5_000,
    }));

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (ticker) => buildHistoricalSeries(ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(
      async (ticker) => ({
        ticker,
        marketCap: 4_200_000_000,
        peRatio: 21,
        source: "FMP",
      }),
    );

    const app = buildApp();

    const user = await createUser({
      email: `test+api-full-basic-ingestion-${Date.now()}@example.com`,
      name: "[TEST] API Full Basic Ingestion User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Full Basic Ingestion Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFB01",
        status: "OWNED",
        shares: 3,
      },
    });

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/full-basic`,
      payload: {
        historicalLimit: 50,
        runAnalysis: false,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.portfolioId).toBe(portfolioId);
    expect(body.data.marketData).toBeDefined();
    expect(body.data.fundamentals).toBeDefined();

    await app.close();
  });

  it("returns success envelope for ticker earnings ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue({
      ticker: "TSTEAR01",
      fiscalQuarter: "Q2",
      fiscalYear: 2026,
      earningsDate: new Date("2026-08-03T12:30:00.000Z"),
      estimatedEps: 1.42,
      source: "FMP",
    });

    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/ticker/TSTEAR01/earnings",
      payload: {},
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.ticker).toBe("TSTEAR01");
    expect(typeof body.data.eventsCreated).toBe("number");

    await app.close();
  });

  it("returns success envelope for portfolio earnings ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockImplementation(async (ticker) => ({
      ticker,
      fiscalQuarter: "Q2",
      fiscalYear: 2026,
      earningsDate: new Date("2026-08-03T12:30:00.000Z"),
      estimatedEps: 1.42,
      source: "FMP",
    }));

    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-earnings-ingestion-${Date.now()}@example.com`,
      name: "[TEST] API Earnings Ingestion User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Earnings Ingestion Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTEPA01",
        status: "OWNED",
        shares: 5,
      },
    });

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/earnings`,
      payload: {},
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.portfolioId).toBe(portfolioId);
    expect(body.data.tickersProcessed).toBe(1);

    await app.close();
  });

  it("returns success envelope for ticker news ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([
      {
        ticker: "TSTNWS01",
        headline: "Company beats estimates",
        summary: "Strong demand and guidance raise.",
        url: "https://example.com/tstnws01-1",
        source: "Wire",
        publishedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/ticker/TSTNWS01/news",
      payload: {
        limit: 10,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.ticker).toBe("TSTNWS01");
    expect(typeof body.data.articlesCreated).toBe("number");

    await app.close();
  });

  it("returns success envelope for portfolio news ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockImplementation(async (ticker) => [
      {
        ticker,
        headline: `${ticker} update`,
        url: `https://example.com/${ticker.toLowerCase()}-news`,
        publishedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-news-ingestion-${Date.now()}@example.com`,
      name: "[TEST] API News Ingestion User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] News Ingestion Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTNPA01",
        status: "OWNED",
        shares: 5,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTNPB01",
        status: "WATCHLIST",
      },
    });

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/news`,
      payload: {
        limitPerTicker: 5,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.portfolioId).toBe(portfolioId);
    expect(body.data.tickersProcessed).toBe(2);
    expect(Array.isArray(body.data.results)).toBe(true);

    await app.close();
  });

  it("returns success envelope for full-refresh portfolio ingestion endpoint", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockImplementation(async (ticker) => ({
      ticker,
      companyName: `${ticker} Company`,
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    }));

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async (ticker) => ({
      ticker,
      price: 130,
      previousClose: 128,
      close: 130,
      volume: 8_000,
    }));

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (ticker) => buildHistoricalSeries(ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(
      async (ticker) => ({
        ticker,
        marketCap: 3_500_000_000,
        peRatio: 25,
        source: "FMP",
      }),
    );

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockImplementation(async (ticker) => ({
      ticker,
      fiscalQuarter: "Q3",
      fiscalYear: 2026,
      earningsDate: new Date("2026-09-03T12:30:00.000Z"),
      estimatedEps: 1.25,
      source: "FMP",
    }));
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);

    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockImplementation(async (ticker) => [
      {
        ticker,
        headline: `${ticker} full refresh news`,
        url: `https://example.com/${ticker.toLowerCase()}-full-refresh-news`,
        publishedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-full-refresh-ingestion-${Date.now()}@example.com`,
      name: "[TEST] API Full Refresh Ingestion User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Full Refresh Ingestion Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFRA01",
        status: "OWNED",
        shares: 4,
      },
    });

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/full-refresh`,
      payload: {
        historicalLimit: 50,
        newsLimitPerTicker: 10,
        runAnalysis: true,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.portfolioId).toBe(portfolioId);
    expect(typeof body.data.startedAt).toBe("string");
    expect(typeof body.data.finishedAt).toBe("string");
    expect(body.data.marketData).toBeDefined();
    expect(typeof body.data.marketData.tickersProcessed).toBe("number");
    expect(typeof body.data.marketData.tickersFailed).toBe("number");
    expect(Array.isArray(body.data.marketData.results)).toBe(true);
    expect(Array.isArray(body.data.marketData.failedTickers)).toBe(true);
    expect(body.data.fundamentals).toBeDefined();
    expect(typeof body.data.fundamentals.tickersProcessed).toBe("number");
    expect(typeof body.data.fundamentals.tickersFailed).toBe("number");
    expect(Array.isArray(body.data.fundamentals.results)).toBe(true);
    expect(Array.isArray(body.data.fundamentals.failedTickers)).toBe(true);
    expect(body.data.earnings).toBeDefined();
    expect(typeof body.data.earnings.tickersProcessed).toBe("number");
    expect(typeof body.data.earnings.tickersFailed).toBe("number");
    expect(Array.isArray(body.data.earnings.results)).toBe(true);
    expect(Array.isArray(body.data.earnings.failedTickers)).toBe(true);
    expect(body.data.news).toBeDefined();
    expect(typeof body.data.news.tickersProcessed).toBe("number");
    expect(typeof body.data.news.tickersFailed).toBe("number");
    expect(Array.isArray(body.data.news.results)).toBe(true);
    expect(Array.isArray(body.data.news.failedTickers)).toBe(true);
    expect(body.data.analysis).toBeDefined();
    expect(Array.isArray(body.data.warnings)).toBe(true);

    const firstReportsResponse = await app.inject({
      method: "GET",
      url: "/api/reports/TSTFRA01?limit=20",
    });

    expect(firstReportsResponse.statusCode).toBe(200);
    const firstReportsBody = firstReportsResponse.json();
    const firstReportCount = firstReportsBody.data.items.length;
    expect(firstReportCount).toBeGreaterThanOrEqual(1);

    const secondRefreshResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/full-refresh`,
      payload: {
        historicalLimit: 50,
        newsLimitPerTicker: 10,
        runAnalysis: true,
      },
    });

    expect(secondRefreshResponse.statusCode).toBe(200);

    const secondReportsResponse = await app.inject({
      method: "GET",
      url: "/api/reports/TSTFRA01?limit=20",
    });

    expect(secondReportsResponse.statusCode).toBe(200);
    const secondReportsBody = secondReportsResponse.json();
    const secondReportCount = secondReportsBody.data.items.length;
    expect(secondReportCount).toBe(firstReportCount);

    await app.close();
  });

  it("returns clear configuration error when FMP API key is missing", async () => {
    env.FMP_API_KEY = undefined;

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/ticker/AAPL/market-data",
      payload: {
        historicalLimit: 50,
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(String(body.error.message)).toMatch(/api key is not configured/i);

    await app.close();
  });
});