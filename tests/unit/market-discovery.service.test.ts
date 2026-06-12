import { afterEach, describe, expect, it, vi } from "vitest";

import { fmpAnalystProvider } from "../../src/providers/fmp";
import {
  ingestDefaultMarketDiscoverySet,
  ingestMarketDiscovery,
  listDiscoveryCandidates,
  rankDiscoveryCandidates,
} from "../../src/services/market-discovery.service";
import { createTestPortfolio, createTestStock, createTestUser } from "../../src/test/factories";
import { addTickerToPortfolio } from "../../src/services/holdings.service";
import { addTickerToWatchlist, createWatchlistForUser } from "../../src/services/watchlists.service";
import * as researchScoringService from "../../src/services/research-scoring.service";

describe("market-discovery.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests market discovery snapshots and lists latest candidates", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockResolvedValue([
      {
        ticker: "TSTDISC01",
        companyName: "Discovery One",
        price: 55,
        changePercent: 4.2,
        volume: 100_000,
        marketCap: 1_000_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:00:00.000Z"),
        source: "FMP",
        raw: { ticker: "TSTDISC01" },
      },
      {
        ticker: "TSTDISC02",
        companyName: "Discovery Two",
        price: 42,
        changePercent: 2.1,
        volume: 80_000,
        marketCap: 700_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:00:00.000Z"),
        source: "FMP",
        raw: { ticker: "TSTDISC02" },
      },
    ]);

    const ingestResult = await ingestMarketDiscovery("gainers", { limit: 2 });
    const listResult = await listDiscoveryCandidates("GAINERS", { limit: 10 });

    expect(ingestResult.category).toBe("GAINERS");
    expect(ingestResult.recordsCreated).toBe(2);
    expect(listResult.category).toBe("GAINERS");
    expect(listResult.candidateCount).toBe(2);
    expect(listResult.topTickers).toContain("TSTDISC01");
    expect(Array.isArray(listResult.warnings)).toBe(true);
    expect(listResult.items).toHaveLength(2);
    expect(listResult.items[0]?.ticker).toBe("TSTDISC01");
  });

  it("continues default discovery ingestion when one category fails", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockImplementation(async (category) => {
      if (category === "LOSERS") {
        throw new Error("LOSERS unavailable");
      }

      return [
        {
          ticker: `TST${category}`.slice(0, 10),
          companyName: `${category} Co.`,
          price: 100,
          changePercent: 1,
          volume: 10_000,
          marketCap: 2_000_000_000,
          category,
          capturedAt: new Date("2099-01-01T00:01:00.000Z"),
          source: "FMP",
          raw: { category },
        },
      ];
    });

    const result = await ingestDefaultMarketDiscoverySet({ limit: 3 });

    expect(result.categories).toHaveLength(5);
    expect(result.warnings.some((warning) => warning.includes("LOSERS"))).toBe(true);

    const losers = result.categories.find((item) => item.category === "LOSERS");
    expect(losers).toBeDefined();
    expect(losers?.recordsCreated).toBe(0);
    expect((losers?.warnings.length ?? 0) > 0).toBe(true);
  });

  it("lists only the latest captured snapshot batch by category", async () => {
    const marketMoverSpy = vi.spyOn(fmpAnalystProvider, "getMarketMovers");

    marketMoverSpy
      .mockResolvedValueOnce([
        {
          ticker: "TSTACT01",
          companyName: "Active Old",
          price: 120,
          changePercent: 1.2,
          volume: 300_000,
          marketCap: 5_000_000_000,
          category: "ACTIVE",
          capturedAt: new Date("2099-01-01T00:01:00.000Z"),
          source: "FMP",
          raw: { batch: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          ticker: "TSTACT02",
          companyName: "Active New",
          price: 130,
          changePercent: 2.2,
          volume: 400_000,
          marketCap: 6_000_000_000,
          category: "ACTIVE",
          capturedAt: new Date("2099-01-01T00:02:00.000Z"),
          source: "FMP",
          raw: { batch: 2 },
        },
      ]);

    await ingestMarketDiscovery("ACTIVE");
    await ingestMarketDiscovery("ACTIVE");

    const result = await listDiscoveryCandidates("ACTIVE", { limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ticker).toBe("TSTACT02");
    expect(result.items[0]?.capturedAt.toISOString()).toContain("2099-01-01T00:02:00.000Z");
  });

  it("filters out candidates below minPrice", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockResolvedValue([
      {
        ticker: "TSTDPRC1",
        companyName: "Low Price Candidate",
        price: 1.25,
        changePercent: 8,
        volume: 600_000,
        marketCap: 400_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:03:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ" },
      },
      {
        ticker: "TSTDPRC2",
        companyName: "Higher Price Candidate",
        price: 18,
        changePercent: 5,
        volume: 900_000,
        marketCap: 1_400_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:03:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ" },
      },
    ]);

    await ingestMarketDiscovery("GAINERS", { limit: 10 });
    const result = await listDiscoveryCandidates("GAINERS", { minPrice: 5, limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ticker).toBe("TSTDPRC2");
  });

  it("filters out extreme change percent candidates", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockResolvedValue([
      {
        ticker: "TSTDCHG1",
        companyName: "Extreme Move",
        price: 12,
        changePercent: 680,
        volume: 800_000,
        marketCap: 2_000_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:04:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ" },
      },
      {
        ticker: "TSTDCHG2",
        companyName: "Reasonable Move",
        price: 22,
        changePercent: 24,
        volume: 1_200_000,
        marketCap: 3_500_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:04:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ" },
      },
    ]);

    await ingestMarketDiscovery("GAINERS", { limit: 10 });
    const result = await listDiscoveryCandidates("GAINERS", {
      maxChangePercent: 300,
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ticker).toBe("TSTDCHG2");
  });

  it("ranks discovery candidates from persisted data and excludes already-held/watchlist tickers", async () => {
    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const watchlist = await createWatchlistForUser(user.id, {
      name: "Discovery Ranking",
      description: "unit test",
      isDefault: false,
    });

    await createTestStock("TSTRK01");
    await createTestStock("TSTRK02");
    await createTestStock("TSTRK03");

    await addTickerToPortfolio(portfolio.id, "TSTRK03", {
      status: "OWNED",
      shares: 5,
      averageCost: 100,
    });

    await addTickerToWatchlist(watchlist.id, "TSTRK02", {
      status: "WATCHING",
      source: "USER",
    });

    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockResolvedValue([
      {
        ticker: "TSTRK01",
        companyName: "Rank One",
        price: 35,
        changePercent: 5,
        volume: 90_000,
        marketCap: 1_100_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:05:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ", sector: "Technology" },
      },
      {
        ticker: "TSTRK02",
        companyName: "Rank Two",
        price: 25,
        changePercent: 4,
        volume: 88_000,
        marketCap: 950_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:05:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ", sector: "Technology" },
      },
      {
        ticker: "TSTRK03",
        companyName: "Rank Three",
        price: 40,
        changePercent: 2,
        volume: 120_000,
        marketCap: 1_900_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:05:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ", sector: "Healthcare" },
      },
    ]);

    await ingestMarketDiscovery("GAINERS", { limit: 10 });

    const scoreSpy = vi.spyOn(researchScoringService, "scoreTickerResearch").mockImplementation(
      async (ticker) => ({
        ticker,
        asOf: new Date("2026-06-10T12:01:00.000Z").toISOString(),
        componentScores: {
          technicalScore: 72,
          fundamentalScore: 70,
          valuationScore: 65,
          analystScore: 68,
          newsScore: 60,
          macroRiskScore: 58,
          earningsRiskScore: 56,
          dataQualityScore: 80,
        },
        compositeScore: ticker === "TSTRK01" ? 76.3 : 61.1,
        suggestedStance: "CANDIDATE",
        bullishFactors: ["Revenue growth is positive."],
        bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
        missingData: [],
        staleDataWarnings: [],
        explanation: "deterministic mock",
      }),
    );

    const result = await rankDiscoveryCandidates({
      category: "GAINERS",
      portfolioId: portfolio.id,
      watchlistId: watchlist.id,
      limit: 5,
      excludeExistingHoldings: true,
      excludeExistingWatchlistItems: true,
    });

    expect(scoreSpy).toHaveBeenCalledTimes(1);
    expect(result.totalCandidates).toBe(3);
    expect(result.scoredCandidatesCount).toBe(1);
    expect(result.skippedCandidatesCount).toBe(2);
    expect(result.rankedCandidates[0]?.ticker).toBe("TSTRK01");
    expect(result.skippedCandidates.some((candidate) => candidate.ticker === "TSTRK02")).toBe(true);
    expect(result.skippedCandidates.some((candidate) => candidate.ticker === "TSTRK03")).toBe(true);
  });

  it("returns noQualifiedCandidates when all ranked discovery names are low-score or HOLD_OFF", async () => {
    await createTestStock("TSTLOW01");
    await createTestStock("TSTLOW02");

    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockResolvedValue([
      {
        ticker: "TSTLOW01",
        companyName: "Low One",
        price: 18,
        changePercent: 1,
        volume: 50_000,
        marketCap: 800_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:06:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ", sector: "Technology" },
      },
      {
        ticker: "TSTLOW02",
        companyName: "Low Two",
        price: 14,
        changePercent: 0.5,
        volume: 45_000,
        marketCap: 650_000_000,
        category: "GAINERS",
        capturedAt: new Date("2099-01-01T00:06:00.000Z"),
        source: "FMP",
        raw: { exchange: "NASDAQ", sector: "Healthcare" },
      },
    ]);

    await ingestMarketDiscovery("GAINERS", { limit: 10 });

    vi.spyOn(researchScoringService, "scoreTickerResearch").mockImplementation(async (ticker) => ({
      ticker,
      asOf: new Date("2026-06-10T12:01:00.000Z").toISOString(),
      componentScores: {
        technicalScore: 40,
        fundamentalScore: 42,
        valuationScore: 41,
        analystScore: 38,
        newsScore: 39,
        macroRiskScore: 55,
        earningsRiskScore: 57,
        dataQualityScore: 72,
      },
      compositeScore: 44.2,
      suggestedStance: "HOLD_OFF",
      bullishFactors: ["Price is above SMA20."],
      bearishFactors: ["Momentum and valuation are weak."],
      missingData: ["analyst"],
      staleDataWarnings: [],
      explanation: "low-score snapshot",
    }));

    const result = await rankDiscoveryCandidates({
      category: "GAINERS",
      limit: 5,
    });

    expect(result.noQualifiedCandidates).toBe(true);
    expect(result.recommendedCandidates).toHaveLength(0);
    expect(result.notRecommendedCandidates.length).toBeGreaterThan(0);
    expect(result.bestAvailableButBelowThreshold.length).toBeGreaterThan(0);
    expect(result.reasonNoQualifiedCandidates).toBeDefined();
    expect(result.suggestedRefreshActions).toContain("refreshDiscoveryCategory");
  });
});
