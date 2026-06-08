import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { env } from "../../src/config/env";
import {
  bankOfCanadaProvider,
} from "../../src/providers/bank-of-canada";
import {
  fredProvider,
} from "../../src/providers/fred";
import {
  fmpEconomicsProvider,
  fmpEarningsProvider,
  fmpFundamentalsProvider,
  fmpAnalystProvider,
  fmpMarketDataProvider,
  fmpNewsProvider,
  fmpProfileProvider,
} from "../../src/providers/fmp";
import {
  gdeltProvider,
} from "../../src/providers/gdelt";
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
    expect(typeof body.data.historicalSnapshotsUpdated).toBe("number");

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

  it("keeps latest quote consistent across latest endpoint, research bundle, and portfolio overview", async () => {
    env.FMP_API_KEY = "test-fmp-key";
    const ticker = `TSTCONS${Date.now().toString().slice(-4)}`;

    vi.spyOn(fmpProfileProvider, "getCompanyProfile").mockImplementation(async (symbol) => ({
      ticker: symbol,
      companyName: `${symbol} Company`,
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software",
      country: "US",
      currency: "USD",
      assetType: "EQUITY",
    }));

    vi.spyOn(fmpMarketDataProvider, "getQuote").mockImplementation(async (symbol) => ({
      ticker: symbol,
      price: 310,
      previousClose: 305,
      close: 310,
      volume: 123_456,
      marketCap: 2_000_000_000,
      changePercent: 1.64,
    }));

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (symbol) => [
        {
          ticker: symbol,
          date: new Date("2026-05-01T00:00:00.000Z"),
          open: 220,
          high: 224,
          low: 215,
          close: 217,
          volume: 900_000,
        },
        {
          ticker: symbol,
          date: new Date("2026-04-30T00:00:00.000Z"),
          open: 216,
          high: 219,
          low: 212,
          close: 214,
          volume: 880_000,
        },
      ],
    );

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockImplementation(async (symbol) => ({
      ticker: symbol,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 330,
      priceTargetHigh: 360,
      priceTargetLow: 290,
      priceTargetConsensus: 335,
      analystCount: 20,
      ratingConsensus: "BUY",
      upsidePercent: 8,
      raw: { symbol },
    }));

    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 335,
      analystCount: 20,
      ratingConsensus: "BUY",
      raw: { source: "consensus" },
    });

    vi.spyOn(fmpAnalystProvider, "getAnalystRatings").mockResolvedValue({
      source: "FMP",
      analystCount: 20,
      ratingConsensus: "BUY",
      strongBuyCount: 8,
      buyCount: 9,
      holdCount: 3,
      sellCount: 0,
      strongSellCount: 0,
      raw: { source: "ratings" },
    });

    vi.spyOn(fmpAnalystProvider, "getUpgradesDowngrades").mockImplementation(async (symbol) => [
      {
        ticker: symbol,
        source: "FMP",
        actionType: "UPGRADE",
        firm: "Firm Alpha",
        eventDate: new Date("2026-06-11T00:00:00.000Z"),
        newPriceTarget: 345,
        raw: { symbol },
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-latest-consistency-${Date.now()}@example.com`,
      name: "[TEST] API Latest Consistency User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Latest Consistency Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    const addHoldingResponse = await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker,
        status: "OWNED",
        shares: 10,
      },
    });

    expect(addHoldingResponse.statusCode).toBe(201);

    const ingestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/market-data`,
      payload: {
        historicalLimit: 2,
        runAnalysis: false,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const analystIngestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/ticker/${ticker}/analyst`,
      payload: {},
    });

    expect(analystIngestionResponse.statusCode).toBe(200);

    const latestResponse = await app.inject({
      method: "GET",
      url: `/api/market-data/${ticker}/latest`,
    });
    expect(latestResponse.statusCode).toBe(200);
    expect(latestResponse.json().data.price).toBe(310);

    const researchResponse = await app.inject({
      method: "GET",
      url: `/api/stocks/${ticker}/research-bundle`,
    });
    expect(researchResponse.statusCode).toBe(200);
    expect(researchResponse.json().data.latestPriceSnapshot.price).toBe(310);
    expect(researchResponse.json().data.latestAnalystSnapshot).toBeDefined();
    expect(Array.isArray(researchResponse.json().data.recentAnalystActions)).toBe(true);
    expect(researchResponse.json().data.recentAnalystActions.length).toBeGreaterThan(0);

    const portfolioResponse = await app.inject({
      method: "GET",
      url: `/api/portfolios/${portfolioId}`,
    });
    expect(portfolioResponse.statusCode).toBe(200);

    const holdings = portfolioResponse.json().data.holdings as Array<{
      ticker: string;
      latestPrice: number | null;
    }>;
    const targetHolding = holdings.find((holding) => holding.ticker === ticker);

    expect(targetHolding).toBeDefined();
    expect(targetHolding?.latestPrice).toBe(310);

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

    const fundamentalsCalls = new Map<string, number>();

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(
      async (ticker) => {
        const nextCount = (fundamentalsCalls.get(ticker) ?? 0) + 1;
        fundamentalsCalls.set(ticker, nextCount);

        return {
          ticker,
          marketCap: nextCount === 1 ? 3_500_000_000 : 3_700_000_000,
          peRatio: nextCount === 1 ? 25 : 19,
          source: "FMP",
        };
      },
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
    expect(
      body.data.marketData.results.every(
        (result: { historicalSnapshotsUpdated?: unknown }) =>
          typeof result.historicalSnapshotsUpdated === "number",
      ),
    ).toBe(true);
    expect(Array.isArray(body.data.marketData.failedTickers)).toBe(true);
    expect(body.data.fundamentals).toBeDefined();
    expect(typeof body.data.fundamentals.tickersProcessed).toBe("number");
    expect(typeof body.data.fundamentals.tickersFailed).toBe("number");
    expect(typeof body.data.fundamentals.snapshotsCreated).toBe("number");
    expect(typeof body.data.fundamentals.snapshotsUpdated).toBe("number");
    expect(typeof body.data.fundamentals.snapshotsSkipped).toBe("number");
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
    expect(body.data.economics).toBeUndefined();
    expect(Array.isArray(body.data.warnings)).toBe(true);

    const latestMarketResponse = await app.inject({
      method: "GET",
      url: "/api/market-data/TSTFRA01/latest",
    });

    expect(latestMarketResponse.statusCode).toBe(200);
    const latestMarketBody = latestMarketResponse.json();
    expect(["FMP_QUOTE", "FMP_HISTORICAL"]).toContain(latestMarketBody.data.source);

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

    const secondRefreshBody = secondRefreshResponse.json();
    expect(secondRefreshBody.success).toBe(true);
    expect(secondRefreshBody.data.fundamentals.snapshotsUpdated).toBeGreaterThanOrEqual(1);
    expect(
      secondRefreshBody.data.fundamentals.results.some(
        (result: { snapshotUpdated?: boolean }) => result.snapshotUpdated === true,
      ),
    ).toBe(true);
    expect(
      secondRefreshBody.data.fundamentals.results.some((result: { warnings?: string[] }) =>
        (result.warnings ?? []).some((warning: string) => warning.includes("already exists for today")),
      ),
    ).toBe(false);

    const secondReportsResponse = await app.inject({
      method: "GET",
      url: "/api/reports/TSTFRA01?limit=20",
    });

    expect(secondReportsResponse.statusCode).toBe(200);
    const secondReportsBody = secondReportsResponse.json();
    const secondReportCount = secondReportsBody.data.items.length;
    expect(secondReportCount).toBe(firstReportCount);
    expect(secondReportsBody.data.items[0]?.fundamentalSummary).toContain("P/E 19.0");

    await app.close();
  });

  it("returns success envelopes for economics ingestion endpoints", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    vi.spyOn(fmpEconomicsProvider, "getTreasuryRates").mockResolvedValue([
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        year10: 4.51,
      },
    ]);

    vi.spyOn(fmpEconomicsProvider, "getEconomicIndicators").mockResolvedValue([
      {
        name: "GDP",
        seriesId: "GDP",
        value: 2.1,
        date: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);

    vi.spyOn(fmpEconomicsProvider, "getEconomicCalendar").mockResolvedValue([
      {
        title: "[TEST] US CPI",
        country: "US",
        category: "Inflation",
        importance: "HIGH",
        eventDate: new Date("2026-06-12T12:30:00.000Z"),
      },
    ]);

    vi.spyOn(fmpEconomicsProvider, "getMarketRiskPremium").mockResolvedValue([
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        country: "US",
        totalRiskPremium: 5.4,
      },
    ]);

    const app = buildApp();

    const treasuryResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/economics/treasury-rates",
      payload: {
        from: "2026-05-01",
        to: "2026-06-03",
        limit: 100,
      },
    });

    expect(treasuryResponse.statusCode).toBe(200);
    expect(treasuryResponse.json().success).toBe(true);

    const indicatorsResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/economics/indicators",
      payload: {
        namesOrSeries: ["GDP"],
      },
    });

    expect(indicatorsResponse.statusCode).toBe(200);
    expect(indicatorsResponse.json().success).toBe(true);

    const calendarResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/economics/calendar",
      payload: {
        from: "2026-06-01",
        to: "2026-07-01",
      },
    });

    expect(calendarResponse.statusCode).toBe(200);
    expect(calendarResponse.json().success).toBe(true);

    const mrpResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/economics/market-risk-premium",
      payload: {
        from: "2026-05-01",
        to: "2026-06-03",
      },
    });

    expect(mrpResponse.statusCode).toBe(200);
    expect(mrpResponse.json().success).toBe(true);

    const defaultSetResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/fmp/economics/default-set",
      payload: {
        includeTreasuryRates: true,
        includeCalendar: true,
        includeMarketRiskPremium: true,
        includeIndicators: true,
      },
    });

    expect(defaultSetResponse.statusCode).toBe(200);
    expect(defaultSetResponse.json().success).toBe(true);

    await app.close();
  });

  it("returns success envelopes for BoC/FRED macro ingestion endpoints", async () => {
    vi.spyOn(bankOfCanadaProvider, "getUsdCadRate").mockResolvedValue([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.3712,
        capturedAt: new Date("2026-06-15T00:00:00.000Z"),
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    vi.spyOn(bankOfCanadaProvider, "getSeriesObservations").mockResolvedValue([
      {
        provider: "BANK_OF_CANADA",
        seriesId: "FXUSDCAD",
        name: "FXUSDCAD",
        country: "CA",
        category: "currency",
        value: 1.3712,
        observedAt: new Date("2026-06-15T00:00:00.000Z"),
        source: "Bank of Canada Valet",
      },
    ]);

    vi.spyOn(fredProvider, "getSeriesObservations").mockImplementation(async (seriesId) => [
      {
        provider: "FRED",
        seriesId,
        name: seriesId,
        country: "US",
        category: "rates",
        value: 4.25,
        observedAt: new Date("2026-06-15T00:00:00.000Z"),
        source: "FRED",
      },
    ]);

    const app = buildApp();

    const bocUsdCadResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/macro/boc/usd-cad",
      payload: {
        from: "2026-06-01",
        to: "2026-06-20",
        limit: 50,
      },
    });

    expect(bocUsdCadResponse.statusCode).toBe(200);
    expect(bocUsdCadResponse.json().success).toBe(true);
    expect(bocUsdCadResponse.json().data.recordsCreated).toBeGreaterThan(0);

    const bocSeriesResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/macro/boc/series/fxusdcad",
      payload: {
        from: "2026-06-01",
        to: "2026-06-20",
      },
    });

    expect(bocSeriesResponse.statusCode).toBe(200);
    expect(bocSeriesResponse.json().success).toBe(true);

    const fredSingleResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/macro/fred/dgs10",
      payload: {
        from: "2026-06-01",
        to: "2026-06-20",
      },
    });

    expect(fredSingleResponse.statusCode).toBe(200);
    expect(fredSingleResponse.json().success).toBe(true);

    const fredDefaultResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/macro/fred/default-set",
      payload: {
        from: "2026-06-01",
        to: "2026-06-20",
      },
    });

    expect(fredDefaultResponse.statusCode).toBe(200);
    expect(fredDefaultResponse.json().success).toBe(true);

    const macroDefaultResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/macro/default",
      payload: {
        from: "2026-06-01",
        to: "2026-06-20",
      },
    });

    expect(macroDefaultResponse.statusCode).toBe(200);
    expect(macroDefaultResponse.json().success).toBe(true);
    expect(
      macroDefaultResponse.json().data.bankOfCanada.recordsCreated +
        macroDefaultResponse.json().data.bankOfCanada.recordsUpdated +
        macroDefaultResponse.json().data.bankOfCanada.recordsSkipped,
    ).toBeGreaterThan(0);
    expect(
      macroDefaultResponse.json().data.fred.recordsCreated +
        macroDefaultResponse.json().data.fred.recordsUpdated +
        macroDefaultResponse.json().data.fred.recordsSkipped,
    ).toBeGreaterThan(0);

    await app.close();
  });

  it("includes economics result in full-refresh when includeEconomics is true", async () => {
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
        url: `https://example.com/${ticker.toLowerCase()}-full-refresh-news-eco`,
        publishedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    ]);

    vi.spyOn(fmpEconomicsProvider, "getTreasuryRates").mockResolvedValue([
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        year10: 4.51,
      },
    ]);
    vi.spyOn(fmpEconomicsProvider, "getEconomicIndicators").mockResolvedValue([]);
    vi.spyOn(fmpEconomicsProvider, "getEconomicCalendar").mockResolvedValue([
      {
        title: "[TEST] US CPI",
        country: "US",
        category: "Inflation",
        importance: "HIGH",
        eventDate: new Date("2026-06-12T12:30:00.000Z"),
      },
    ]);
    vi.spyOn(fmpEconomicsProvider, "getMarketRiskPremium").mockResolvedValue([
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        country: "US",
        totalRiskPremium: 5.4,
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-full-refresh-economics-${Date.now()}@example.com`,
      name: "[TEST] API Full Refresh Economics User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Full Refresh Economics Portfolio",
        baseCurrency: "USD",
      },
    });

    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFRE01",
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
        includeEconomics: true,
        runAnalysis: false,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);
    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.economics).toBeDefined();
    expect(body.data.economics.treasuryRates.recordsCreated).toBeGreaterThan(0);

    await app.close();
  });

  it("includes BoC/FRED macro in full-refresh and remains non-blocking on FRED failures", async () => {
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

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    vi.spyOn(bankOfCanadaProvider, "getUsdCadRate").mockResolvedValue([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.374,
        capturedAt: new Date("2026-06-21T00:00:00.000Z"),
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    vi.spyOn(fredProvider, "getSeriesObservations").mockRejectedValue(
      new Error("simulated fred outage"),
    );

    const app = buildApp();

    const user = await createUser({
      email: `test+api-full-refresh-macro-${Date.now()}@example.com`,
      name: "[TEST] API Full Refresh Macro User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Full Refresh Macro Portfolio",
        baseCurrency: "USD",
      },
    });

    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFRM01",
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
        includeBankOfCanada: true,
        includeFred: true,
        runAnalysis: false,
      },
    });

    expect(ingestionResponse.statusCode).toBe(200);

    const body = ingestionResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.marketData).toBeDefined();
    expect(body.data.fundamentals).toBeDefined();
    expect(body.data.earnings).toBeDefined();
    expect(body.data.news).toBeDefined();
    expect(body.data.bankOfCanada.recordsCreated).toBeGreaterThan(0);
    expect(body.data.fred).toBeDefined();
    expect(body.data.warnings.some((warning: string) => warning.includes("FRED"))).toBe(true);

    await app.close();
  });

  it("returns success envelopes for analyst ingestion and analyst read endpoints", async () => {
    env.FMP_API_KEY = "test-fmp-key";

    const ticker = "TSTANAPI1";

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockResolvedValue({
      ticker,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 120,
      priceTargetHigh: 130,
      priceTargetLow: 100,
      priceTargetConsensus: 125,
      analystCount: 12,
      ratingConsensus: "BUY",
      raw: { ticker },
    });

    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 125,
      analystCount: 12,
      ratingConsensus: "BUY",
      raw: { source: "consensus" },
    });

    vi.spyOn(fmpAnalystProvider, "getAnalystRatings").mockResolvedValue({
      source: "FMP",
      analystCount: 12,
      ratingConsensus: "BUY",
      strongBuyCount: 4,
      buyCount: 6,
      holdCount: 2,
      sellCount: 0,
      strongSellCount: 0,
      raw: { source: "ratings" },
    });

    vi.spyOn(fmpAnalystProvider, "getUpgradesDowngrades").mockResolvedValue([
      {
        ticker,
        source: "FMP",
        actionType: "UPGRADE",
        firm: "Firm A",
        eventDate: new Date("2026-06-11T00:00:00.000Z"),
        newPriceTarget: 132,
        raw: { ticker },
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-analyst-${Date.now()}@example.com`,
      name: "[TEST] API Analyst User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Analyst Portfolio",
        baseCurrency: "USD",
      },
    });

    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker,
        status: "OWNED",
        shares: 3,
      },
    });

    const createWatchlistResponse = await app.inject({
      method: "POST",
      url: "/api/watchlists",
      payload: {
        userId: user.id,
        name: "[TEST] Analyst Watchlist",
      },
    });

    const watchlistId = createWatchlistResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: `/api/watchlists/${watchlistId}/items`,
      payload: {
        ticker,
      },
    });

    const tickerIngestion = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/ticker/${ticker}/analyst`,
      payload: {},
    });

    expect(tickerIngestion.statusCode).toBe(200);
    expect(tickerIngestion.json().success).toBe(true);

    const portfolioIngestion = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/analyst`,
      payload: {},
    });

    expect(portfolioIngestion.statusCode).toBe(200);
    expect(portfolioIngestion.json().success).toBe(true);

    const watchlistIngestion = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/watchlist/${watchlistId}/analyst`,
      payload: {},
    });

    expect(watchlistIngestion.statusCode).toBe(200);
    expect(watchlistIngestion.json().success).toBe(true);

    const latestResponse = await app.inject({
      method: "GET",
      url: `/api/analyst/${ticker}/latest`,
    });

    expect(latestResponse.statusCode).toBe(200);
    expect(latestResponse.json().success).toBe(true);
    expect(latestResponse.json().data.priceTargetConsensus).toBe(125);

    const actionsResponse = await app.inject({
      method: "GET",
      url: `/api/analyst/${ticker}/actions?limit=5`,
    });

    expect(actionsResponse.statusCode).toBe(200);
    expect(actionsResponse.json().success).toBe(true);
    expect(Array.isArray(actionsResponse.json().data)).toBe(true);
    expect(actionsResponse.json().data.length).toBeGreaterThan(0);

    await app.close();
  });

  it("returns success envelopes for discovery refresh/list/default-set endpoints", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockImplementation(async (category) => {
      return [
        {
          ticker: `TST${category}`.slice(0, 10),
          companyName: `${category} Co.`,
          price: 101,
          changePercent: 2.5,
          volume: 20_000,
          marketCap: 1_500_000_000,
          category: category as
            | "GAINERS"
            | "LOSERS"
            | "ACTIVE"
            | "ANALYST_UPGRADES"
            | "ANALYST_DOWNGRADES",
          capturedAt: new Date("2026-06-12T00:00:00.000Z"),
          source: "FMP",
          raw: { category },
        },
      ];
    });

    const app = buildApp();

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/discovery/fmp/GAINERS/refresh",
      payload: {
        limit: 5,
      },
    });

    expect(refreshResponse.statusCode).toBe(200);
    expect(refreshResponse.json().success).toBe(true);
    expect(refreshResponse.json().data.category).toBe("GAINERS");

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/discovery/GAINERS?limit=5",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().success).toBe(true);
    expect(listResponse.json().data.category).toBe("GAINERS");
    expect(Array.isArray(listResponse.json().data.items)).toBe(true);

    const defaultSetResponse = await app.inject({
      method: "POST",
      url: "/api/discovery/fmp/default-set",
      payload: {
        limit: 3,
      },
    });

    expect(defaultSetResponse.statusCode).toBe(200);
    expect(defaultSetResponse.json().success).toBe(true);
    expect(Array.isArray(defaultSetResponse.json().data.categories)).toBe(true);
    expect(defaultSetResponse.json().data.categories.length).toBe(5);

    await app.close();
  });

  it("includes analystData section in full-refresh when includeAnalystData=true", async () => {
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
        marketCap: 3_000_000_000,
        peRatio: 21,
        source: "FMP",
      }),
    );

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockResolvedValue({
      ticker: "TSTFRANA",
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 140,
      priceTargetHigh: 150,
      priceTargetLow: 120,
      priceTargetConsensus: 138,
      analystCount: 9,
      ratingConsensus: "BUY",
      raw: { source: "summary" },
    });

    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 138,
      analystCount: 9,
      ratingConsensus: "BUY",
      raw: { source: "consensus" },
    });

    vi.spyOn(fmpAnalystProvider, "getAnalystRatings").mockResolvedValue({
      source: "FMP",
      analystCount: 9,
      ratingConsensus: "BUY",
      strongBuyCount: 3,
      buyCount: 4,
      holdCount: 2,
      sellCount: 0,
      strongSellCount: 0,
      raw: { source: "ratings" },
    });

    vi.spyOn(fmpAnalystProvider, "getUpgradesDowngrades").mockResolvedValue([
      {
        ticker: "TSTFRANA",
        source: "FMP",
        actionType: "UPGRADE",
        firm: "Firm Analyst",
        eventDate: new Date("2026-06-11T00:00:00.000Z"),
        newPriceTarget: 145,
        raw: { source: "actions" },
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-full-refresh-analyst-${Date.now()}@example.com`,
      name: "[TEST] API Full Refresh Analyst User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Full Refresh Analyst Portfolio",
        baseCurrency: "USD",
      },
    });

    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFRANA",
        status: "OWNED",
        shares: 5,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/full-refresh`,
      payload: {
        includeAnalystData: true,
        includeEconomics: false,
        includeBankOfCanada: false,
        includeFred: false,
        runAnalysis: false,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.analystData).toBeDefined();
    expect(body.data.analystData.tickersProcessed).toBeGreaterThan(0);
    expect(body.data.analystData.snapshotsCreated + body.data.analystData.snapshotsUpdated).toBeGreaterThan(0);

    await app.close();
  });

  it("returns success envelopes for GDELT ingestion and geopolitical read endpoints", async () => {
    vi.spyOn(gdeltProvider, "searchDocArticles").mockImplementation(async (options) => {
      const query = options.query ?? options.queries?.[0] ?? "global risk";

      return [
        {
          provider: "GDELT",
          title: `Headline for ${query}`,
          url: `https://example.com/${encodeURIComponent(query)}`,
          domain: "example.com",
          sourceCountry: "US",
          language: "English",
          publishedAt: new Date("2026-06-12T00:00:00.000Z"),
          query,
          category: "GEOPOLITICAL",
          theme: "GLOBAL_RISK",
          tone: -0.5,
          sentiment: "NEUTRAL",
          raw: { query },
        },
      ];
    });

    vi.spyOn(gdeltProvider, "getDefaultQueries").mockReturnValue(["geopolitical risk"]);

    const app = buildApp();

    const ingestQueryResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/gdelt/query",
      payload: {
        query: "war OR sanctions",
        maxRecords: 25,
      },
    });

    expect(ingestQueryResponse.statusCode).toBe(200);
    expect(ingestQueryResponse.json().success).toBe(true);
    expect(ingestQueryResponse.json().data.query).toBe("war OR sanctions");

    const ingestDefaultResponse = await app.inject({
      method: "POST",
      url: "/api/ingestion/gdelt/default-risk-set",
      payload: {
        maxRecordsPerQuery: 25,
      },
    });

    expect(ingestDefaultResponse.statusCode).toBe(200);
    expect(ingestDefaultResponse.json().success).toBe(true);
    expect(ingestDefaultResponse.json().data.queriesProcessed).toBeGreaterThan(0);

    const latestResponse = await app.inject({
      method: "GET",
      url: "/api/geopolitical/latest?limit=20",
    });

    expect(latestResponse.statusCode).toBe(200);
    expect(latestResponse.json().success).toBe(true);
    expect(Array.isArray(latestResponse.json().data.items)).toBe(true);

    const summaryResponse = await app.inject({
      method: "GET",
      url: "/api/geopolitical/summary?days=7",
    });

    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json().success).toBe(true);
    expect(typeof summaryResponse.json().data.totalEvents).toBe("number");

    await app.close();
  });

  it("includes geopolitical section in full-refresh when includeGdelt=true", async () => {
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
      price: 145,
      previousClose: 142,
      close: 145,
      volume: 7_000,
    }));

    vi.spyOn(fmpMarketDataProvider, "getHistoricalDailyPrices").mockImplementation(
      async (ticker) => buildHistoricalSeries(ticker),
    );

    vi.spyOn(fmpFundamentalsProvider, "getFundamentals").mockImplementation(
      async (ticker) => ({
        ticker,
        marketCap: 4_000_000_000,
        peRatio: 19,
        source: "FMP",
      }),
    );

    vi.spyOn(fmpEarningsProvider, "getNextEarnings").mockResolvedValue(null);
    vi.spyOn(fmpEarningsProvider, "getEarningsHistory").mockResolvedValue([]);
    vi.spyOn(fmpNewsProvider, "getCompanyNews").mockResolvedValue([]);

    vi.spyOn(gdeltProvider, "getDefaultQueries").mockReturnValue([
      "geopolitical risk OR sanctions OR conflict",
    ]);

    vi.spyOn(gdeltProvider, "searchDocArticles").mockResolvedValue([
      {
        provider: "GDELT",
        title: "Geopolitical signal",
        url: "https://example.com/geopolitical-signal",
        domain: "example.com",
        sourceCountry: "US",
        language: "English",
        publishedAt: new Date("2026-06-12T00:00:00.000Z"),
        query: "geopolitical risk OR sanctions OR conflict",
        category: "GEOPOLITICAL",
        theme: "GLOBAL_RISK",
        tone: -0.2,
        sentiment: "NEUTRAL",
        raw: { sample: true },
      },
    ]);

    const app = buildApp();

    const user = await createUser({
      email: `test+api-full-refresh-gdelt-${Date.now()}@example.com`,
      name: "[TEST] API Full Refresh GDELT User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] Full Refresh GDELT Portfolio",
        baseCurrency: "USD",
      },
    });

    const portfolioId = createPortfolioResponse.json().data.id as string;

    await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker: "TSTFRGDELT",
        status: "OWNED",
        shares: 3,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/portfolio/${portfolioId}/full-refresh`,
      payload: {
        includeGdelt: true,
        gdeltMaxRecordsPerQuery: 25,
        gdeltLookbackDays: 7,
        includeEconomics: false,
        includeBankOfCanada: false,
        includeFred: false,
        runAnalysis: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.success).toBe(true);
    expect(body.data.geopolitical).toBeDefined();
    expect(body.data.geopolitical.queriesProcessed).toBeGreaterThan(0);

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