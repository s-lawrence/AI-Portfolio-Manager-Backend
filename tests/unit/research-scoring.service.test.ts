import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldingStatus } from "@prisma/client";

import * as geopoliticalService from "../../src/services/geopolitical-ingestion.service";
import { upsertFxRateSnapshot } from "../../src/services/fx-rates.service";
import * as macroSeriesService from "../../src/services/macro-series.service";
import * as portfoliosService from "../../src/services/portfolios.service";
import * as researchScoringService from "../../src/services/research-scoring.service";
import * as stocksService from "../../src/services/stocks.service";
import * as watchlistsService from "../../src/services/watchlists.service";

function buildBundle(overrides: Record<string, unknown> = {}): unknown {
  return {
    stock: { ticker: "AAPL" },
    latestPriceSnapshot: {
      price: 200,
      capturedAt: new Date(),
    },
    latestTechnicalSnapshot: {
      sma50: 190,
      sma200: 175,
      rsi14: 55,
      macd: 1.2,
      trendDirection: "UPTREND",
      capturedAt: new Date(),
    },
    latestFundamentalSnapshot: {
      revenueGrowth: 0.11,
      grossMargin: 0.48,
      operatingMargin: 0.24,
      netMargin: 0.21,
      debtToEquity: 0.9,
      currentRatio: 1.8,
      peRatio: 28,
      forwardPeRatio: 24,
      priceToSales: 5,
      priceToBook: 7,
      evToEbitda: 16,
      capturedAt: new Date(),
    },
    latestAnalystSnapshot: {
      upsidePercent: 14,
      ratingConsensus: "Buy",
      strongBuyCount: 8,
      buyCount: 12,
      holdCount: 4,
      sellCount: 1,
      strongSellCount: 0,
      capturedAt: new Date(),
    },
    recentAnalystActions: [
      {
        actionType: "UPGRADE",
        eventDate: new Date(),
      },
    ],
    recentNews: [
      {
        sentiment: "BULLISH",
        sentimentScore: 0.7,
        materialityScore: 0.8,
        publishedAt: new Date(),
      },
      {
        sentiment: "NEUTRAL",
        sentimentScore: 0,
        materialityScore: 0.4,
        publishedAt: new Date(),
      },
    ],
    nextEarningsEvent: {
      earningsDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    },
    fmpFinancialRating: {
      returnOnEquityScore: 70,
      returnOnAssetsScore: 68,
    },
    ...overrides,
  };
}

function buildWatchlistItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    itemId: "item-1",
    ticker: "AAA",
    status: "WATCHING",
    priority: "HIGH",
    latestPriceSnapshot: { price: 100, capturedAt: new Date() },
    latestTechnicalSnapshot: null,
    latestFundamentalSnapshot: null,
    latestAnalystSnapshot: null,
    recentAnalystActions: [],
    topHeadlines: [],
    nextEarningsEvent: null,
    ...overrides,
  };
}

describe("research-scoring.service", () => {
  beforeEach(() => {
    vi.spyOn(geopoliticalService, "getGeopoliticalSummary").mockResolvedValue({
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString(),
      totalEvents: 35,
      countsByCategory: [],
      countsByTheme: [],
      sentimentMix: {
        positive: 8,
        neutral: 20,
        negative: 5,
        unknown: 2,
      },
      topHeadlines: [],
      topCountries: [],
      topDomains: [],
    });

    vi.spyOn(macroSeriesService, "getLatestMacroObservation").mockImplementation(
      async (_provider: string, seriesId: string) => {
        const value =
          seriesId === "DGS10"
            ? 4.2
            : seriesId === "DGS2"
              ? 3.9
              : seriesId === "FEDFUNDS"
                ? 4.75
                : 2.8;

        return {
          provider: "FRED",
          seriesId,
          value,
          observedAt: new Date(),
        } as never;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scoreTickerResearch returns component scores and explanation", async () => {
    vi.spyOn(stocksService, "getStockResearchBundle").mockResolvedValue(buildBundle() as never);

    const result = await researchScoringService.scoreTickerResearch("AAPL");

    expect(result.ticker).toBe("AAPL");
    expect(result.componentScores.technicalScore).toBeTypeOf("number");
    expect(result.componentScores.fundamentalScore).toBeTypeOf("number");
    expect(result.componentScores.valuationScore).toBeTypeOf("number");
    expect(result.componentScores.analystScore).toBeTypeOf("number");
    expect(result.componentScores.newsScore).toBeTypeOf("number");
    expect(result.componentScores.macroRiskScore).toBeTypeOf("number");
    expect(result.componentScores.earningsRiskScore).toBeTypeOf("number");
    expect(result.componentScores.dataQualityScore).toBeTypeOf("number");
    expect(result.explanation).toContain("Deterministic weighted score");
  });

  it("missing data lowers dataQualityScore", async () => {
    vi.spyOn(stocksService, "getStockResearchBundle").mockResolvedValue(
      buildBundle({
        latestTechnicalSnapshot: null,
        latestFundamentalSnapshot: null,
        latestAnalystSnapshot: null,
        recentAnalystActions: [],
        recentNews: [],
      }) as never,
    );

    const result = await researchScoringService.scoreTickerResearch("AAPL");

    expect(result.componentScores.dataQualityScore).toBeLessThan(70);
    expect(result.missingData.length).toBeGreaterThan(0);
  });

  it("analyst upside improves analystScore", async () => {
    const stockSpy = vi.spyOn(stocksService, "getStockResearchBundle");
    stockSpy
      .mockResolvedValueOnce(
        buildBundle({
          latestAnalystSnapshot: {
            upsidePercent: 22,
            ratingConsensus: "Strong Buy",
            strongBuyCount: 10,
            buyCount: 9,
            holdCount: 3,
            sellCount: 0,
            strongSellCount: 0,
            capturedAt: new Date(),
          },
        }) as never,
      )
      .mockResolvedValueOnce(
        buildBundle({
          latestAnalystSnapshot: {
            upsidePercent: -18,
            ratingConsensus: "Sell",
            strongBuyCount: 0,
            buyCount: 1,
            holdCount: 5,
            sellCount: 7,
            strongSellCount: 4,
            capturedAt: new Date(),
          },
        }) as never,
      );

    const positive = await researchScoringService.scoreTickerResearch("AAPL");
    const negative = await researchScoringService.scoreTickerResearch("AAPL");

    expect(positive.componentScores.analystScore).toBeGreaterThan(negative.componentScores.analystScore);
  });

  it("overbought RSI creates caution", async () => {
    vi.spyOn(stocksService, "getStockResearchBundle").mockResolvedValue(
      buildBundle({
        latestTechnicalSnapshot: {
          sma50: 190,
          sma200: 170,
          rsi14: 82,
          macd: 0.5,
          trendDirection: "UPTREND",
          capturedAt: new Date(),
        },
      }) as never,
    );

    const result = await researchScoringService.scoreTickerResearch("AAPL");

    expect(result.bearishFactors).toContain("RSI indicates overbought conditions.");
  });

  it("scoreWatchlist ranks candidates", async () => {
    vi.spyOn(watchlistsService, "getWatchlistResearchBundle").mockResolvedValue({
      watchlist: { id: "watchlist-1", name: "Main" },
      itemCount: 2,
      items: [
        buildWatchlistItem({ itemId: "item-1", ticker: "AAA", status: "WATCHING", priority: "HIGH" }),
        buildWatchlistItem({ itemId: "item-2", ticker: "BBB", status: "WATCHING", priority: "HIGH" }),
      ],
    } as never);

    vi.spyOn(stocksService, "getStockResearchBundle").mockImplementation(async (ticker: string) => {
      if (ticker === "AAA") {
        return buildBundle({ stock: { ticker: "AAA" } }) as never;
      }

      return buildBundle({
        stock: { ticker: "BBB" },
        latestTechnicalSnapshot: {
          sma50: 210,
          sma200: 220,
          rsi14: 78,
          macd: -0.4,
          trendDirection: "DOWNTREND",
          capturedAt: new Date(),
        },
        latestAnalystSnapshot: {
          upsidePercent: -12,
          ratingConsensus: "Sell",
          strongBuyCount: 0,
          buyCount: 2,
          holdCount: 5,
          sellCount: 4,
          strongSellCount: 2,
          capturedAt: new Date(),
        },
      }) as never;
    });

    const result = await researchScoringService.scoreWatchlist("watchlist-1");

    expect(result.totalItems).toBe(2);
    expect(result.activeItemsCount).toBe(2);
    expect(result.scoredItemsCount).toBe(2);
    expect(result.skippedItemsCount).toBe(0);
    expect(result.rankedItems).toHaveLength(2);
    expect(result.rankedItems[0].ticker).toBe("AAA");
    expect(result.rankedItems[0].compositeScore).toBeGreaterThanOrEqual(
      result.rankedItems[1].compositeScore,
    );
  });

  it("scoreWatchlist does not return zero when one item is scorable and others are skipped", async () => {
    vi.spyOn(watchlistsService, "getWatchlistResearchBundle").mockResolvedValue({
      watchlist: { id: "watchlist-1", name: "Main" },
      itemCount: 5,
      items: [
        buildWatchlistItem({ itemId: "item-1", ticker: "ADD", status: "WATCHING", latestPriceSnapshot: null }),
        buildWatchlistItem({ itemId: "item-2", ticker: "INTC", status: "WATCHING", latestPriceSnapshot: null }),
        buildWatchlistItem({ itemId: "item-3", ticker: "WLTH", status: "WATCHING", latestPriceSnapshot: null }),
        buildWatchlistItem({ itemId: "item-4", ticker: "NVDA", status: "WATCHING" }),
        buildWatchlistItem({ itemId: "item-5", ticker: "RY.TO", status: "WATCHING", latestPriceSnapshot: null }),
      ],
    } as never);

    vi.spyOn(stocksService, "getStockResearchBundle").mockImplementation(async (ticker: string) => {
      if (ticker === "NVDA") {
        return buildBundle({ stock: { ticker: "NVDA" } }) as never;
      }

      return null as never;
    });

    const result = await researchScoringService.scoreWatchlist("watchlist-1");

    expect(result.totalItems).toBe(5);
    expect(result.activeItemsCount).toBe(5);
    expect(result.scoredItemsCount).toBeGreaterThanOrEqual(1);
    expect(result.rankedItems.some((item) => item.ticker === "NVDA")).toBe(true);
    expect(result.skippedItemsCount).toBeGreaterThanOrEqual(1);
  });

  it("scoreWatchlist returns skippedItems reasons for no-data entries", async () => {
    vi.spyOn(watchlistsService, "getWatchlistResearchBundle").mockResolvedValue({
      watchlist: { id: "watchlist-1", name: "Main" },
      itemCount: 2,
      items: [
        buildWatchlistItem({ itemId: "item-1", ticker: "ADD", status: "WATCHING", latestPriceSnapshot: null }),
        buildWatchlistItem({ itemId: "item-2", ticker: "NVDA", status: "WATCHING" }),
      ],
    } as never);

    vi.spyOn(stocksService, "getStockResearchBundle").mockImplementation(async (ticker: string) => {
      if (ticker === "NVDA") {
        return buildBundle({ stock: { ticker: "NVDA" } }) as never;
      }

      return null as never;
    });

    const result = await researchScoringService.scoreWatchlist("watchlist-1");

    expect(result.skippedItems.some((item) => item.ticker === "ADD")).toBe(true);
    expect(result.skippedItems[0]?.reason.length).toBeGreaterThan(0);
  });

  it("scoreWatchlist includes WATCHING items and excludes REJECTED/ARCHIVED/CONVERTED_TO_HOLDING", async () => {
    vi.spyOn(watchlistsService, "getWatchlistResearchBundle").mockResolvedValue({
      watchlist: { id: "watchlist-1", name: "Main" },
      itemCount: 5,
      items: [
        buildWatchlistItem({ itemId: "item-1", ticker: "AAA", status: "WATCHING" }),
        buildWatchlistItem({ itemId: "item-2", ticker: "BBB", status: "RESEARCHING" }),
        buildWatchlistItem({ itemId: "item-3", ticker: "CCC", status: "CANDIDATE" }),
        buildWatchlistItem({ itemId: "item-4", ticker: "DDD", status: "REJECTED" }),
        buildWatchlistItem({ itemId: "item-5", ticker: "EEE", status: "ARCHIVED" }),
      ],
    } as never);

    vi.spyOn(stocksService, "getStockResearchBundle").mockImplementation(async (ticker: string) =>
      buildBundle({ stock: { ticker } }) as never,
    );

    const result = await researchScoringService.scoreWatchlist("watchlist-1");

    expect(result.activeItemsCount).toBe(3);
    expect(result.rankedItems.some((item) => item.ticker === "AAA")).toBe(true);
    expect(result.rankedItems.some((item) => item.ticker === "BBB")).toBe(true);
    expect(result.rankedItems.some((item) => item.ticker === "CCC")).toBe(true);
    expect(result.rankedItems.some((item) => item.ticker === "DDD")).toBe(false);
    expect(result.rankedItems.some((item) => item.ticker === "EEE")).toBe(false);
  });

  it("scoreWatchlist dataQuality penalty does not exclude otherwise scorable items", async () => {
    vi.spyOn(watchlistsService, "getWatchlistResearchBundle").mockResolvedValue({
      watchlist: { id: "watchlist-1", name: "Main" },
      itemCount: 1,
      items: [
        buildWatchlistItem({
          itemId: "item-1",
          ticker: "NVDA",
          status: "WATCHING",
          latestPriceSnapshot: { price: 100, capturedAt: new Date() },
          latestTechnicalSnapshot: null,
          latestFundamentalSnapshot: null,
          latestAnalystSnapshot: null,
          recentAnalystActions: [],
          topHeadlines: [],
          nextEarningsEvent: null,
        }),
      ],
    } as never);

    vi.spyOn(stocksService, "getStockResearchBundle").mockResolvedValue(
      buildBundle({
        stock: { ticker: "NVDA" },
        latestTechnicalSnapshot: null,
        latestFundamentalSnapshot: null,
        latestAnalystSnapshot: null,
        recentAnalystActions: [],
        recentNews: [],
      }) as never,
    );

    const result = await researchScoringService.scoreWatchlist("watchlist-1");

    expect(result.scoredItemsCount).toBe(1);
    expect(result.rankedItems[0]?.score.componentScores.dataQualityScore).toBeLessThan(100);
  });

  it("getTickerDataQuality reports missing coverage and suggested refresh actions", async () => {
    vi.spyOn(stocksService, "getStockResearchBundle").mockResolvedValue(
      buildBundle({
        stock: { ticker: "NVDA" },
        latestTechnicalSnapshot: null,
        latestFundamentalSnapshot: null,
        latestAnalystSnapshot: null,
        recentAnalystActions: [],
        recentNews: [],
      }) as never,
    );

    const result = await researchScoringService.getTickerDataQuality("nvda");

    expect(result.ticker).toBe("NVDA");
    expect(result.missingData).toEqual(
      expect.arrayContaining(["technical", "fundamental", "analyst", "news", "report"]),
    );
    expect(result.suggestedRefreshActions).toContain("refreshWatchlistResearchData");
    expect(result.suggestedRefreshActions).toContain("refreshTickerAnalystData");
  });

  it("getWatchlistDataQuality reports complete/partial/empty counts", async () => {
    vi.spyOn(watchlistsService, "getWatchlistResearchBundle").mockResolvedValue({
      watchlist: { id: "watchlist-1", name: "Main" },
      itemCount: 3,
      items: [
        buildWatchlistItem({
          itemId: "item-1",
          ticker: "AAA",
          latestTechnicalSnapshot: { capturedAt: new Date() },
          latestFundamentalSnapshot: { capturedAt: new Date() },
          latestAnalystSnapshot: { capturedAt: new Date() },
          recentAnalystActions: [{ actionType: "UPGRADE", eventDate: new Date() }],
          topHeadlines: [{ publishedAt: new Date(), sentiment: "NEUTRAL" }],
          nextEarningsEvent: { earningsDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
          latestAIReport: { id: "report-1" },
          latestReportDate: new Date(),
        }),
        buildWatchlistItem({
          itemId: "item-2",
          ticker: "BBB",
          latestTechnicalSnapshot: null,
          latestFundamentalSnapshot: null,
          latestAnalystSnapshot: null,
          recentAnalystActions: [],
          topHeadlines: [],
          nextEarningsEvent: null,
          latestAIReport: null,
          latestReportDate: null,
        }),
        buildWatchlistItem({
          itemId: "item-3",
          ticker: "CCC",
          latestPriceSnapshot: null,
          latestTechnicalSnapshot: null,
          latestFundamentalSnapshot: null,
          latestAnalystSnapshot: null,
          recentAnalystActions: [],
          topHeadlines: [],
          nextEarningsEvent: null,
          latestAIReport: null,
          latestReportDate: null,
        }),
      ],
    } as never);

    const result = await researchScoringService.getWatchlistDataQuality("watchlist-1");

    expect(result.completeItemsCount).toBe(1);
    expect(result.partialItemsCount).toBe(1);
    expect(result.emptyItemsCount).toBe(1);
    expect(result.suggestedRefreshActions).toContain("refreshWatchlistResearchData");
  });

  it("compareTickers returns all requested tickers", async () => {
    vi.spyOn(stocksService, "getStockResearchBundle").mockImplementation(async (ticker: string) =>
      buildBundle({ stock: { ticker } }) as never,
    );

    const result = await researchScoringService.compareTickers(["AAPL", "MSFT", "NVDA"]);

    expect(result.requestedTickers).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(result.scores.map((entry) => entry.ticker)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("getPortfolioRiskSnapshot identifies concentration risk", async () => {
    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        { ticker: "AAPL", marketValueCad: 700, latestPrice: 200, currency: "USD", nativeCurrency: "USD", sector: "TECH", status: HoldingStatus.OWNED },
        { ticker: "MSFT", marketValueCad: 200, latestPrice: 180, currency: "USD", nativeCurrency: "USD", sector: "TECH", status: HoldingStatus.OWNED },
        { ticker: "XOM", marketValueCad: 100, latestPrice: 90, currency: "USD", nativeCurrency: "USD", sector: "ENERGY", status: HoldingStatus.OWNED },
      ],
      holdingCount: 3,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.concentrationRisks.length).toBeGreaterThan(0);
    expect(result.topRisks.some((risk) => risk.includes("concentration"))).toBe(true);
  });

  it("getPortfolioRiskSnapshot with USD holdings and stored USD/CAD does not report missing FX", async () => {
    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.36,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-05T00:00:00.000Z"),
    });

    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "AAPL",
          marketValueCad: 136,
          latestPrice: 100,
          currency: "USD",
          nativeCurrency: "USD",
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 1,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.holdingsMissingFx).toEqual([]);
    expect(result.conversionStatuses[0]?.conversionStatus).toBe("CONVERTED");
    expect(result.fxRateUsed?.pair).toBe("USD/CAD");
    expect(result.missingData.some((entry) => /missing fx rates/i.test(entry))).toBe(false);
  });

  it("getPortfolioRiskSnapshot with USD holdings and no USD/CAD reports missing FX", async () => {
    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "MSFT",
          marketValueCad: null,
          latestPrice: 100,
          currency: "USD",
          nativeCurrency: "USD",
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 1,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.holdingsMissingFx).toEqual([{ ticker: "MSFT", currency: "USD" }]);
    expect(result.missingData.some((entry) => /Missing FX rates/i.test(entry))).toBe(true);
  });

  it("getPortfolioRiskSnapshot with CAD holdings reports DIRECT_CAD and no missing FX", async () => {
    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "SHOP",
          marketValueCad: 250,
          latestPrice: 50,
          currency: "CAD",
          nativeCurrency: "CAD",
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 1,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.holdingsMissingFx).toEqual([]);
    expect(result.conversionStatuses[0]?.conversionStatus).toBe("DIRECT_CAD");
  });

  it("getPortfolioRiskSnapshot with null currency reports missing currency metadata, not missing FX", async () => {
    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "NVDA",
          marketValueCad: null,
          latestPrice: 100,
          currency: null,
          nativeCurrency: null,
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 1,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.holdingsMissingCurrency).toEqual([{ ticker: "NVDA" }]);
    expect(result.holdingsMissingFx).toEqual([]);
    expect(result.missingData.some((entry) => /missing currency metadata/i.test(entry))).toBe(true);
    expect(result.missingData.some((entry) => /missing fx rates/i.test(entry))).toBe(false);
  });

  it("getPortfolioRiskSnapshot with unsupported currency reports unsupported currency", async () => {
    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "SAP",
          marketValueCad: null,
          latestPrice: 100,
          currency: "EUR",
          nativeCurrency: "EUR",
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 1,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.holdingsUnsupportedCurrency).toEqual([{ ticker: "SAP", currency: "EUR" }]);
    expect(result.missingData.some((entry) => /unsupported currencies/i.test(entry))).toBe(true);
    expect(result.missingData.some((entry) => /missing usd\/cad fx/i.test(entry))).toBe(false);
  });

  it("portfolio overview and risk snapshot agree on fxRateUsed", async () => {
    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.4,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-06T00:00:00.000Z"),
    });

    const expectedFxRateUsed = {
      pair: "USD/CAD" as const,
      rate: 1.4,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-06T00:00:00.000Z"),
    };

    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "AAPL",
          marketValueCad: 140,
          latestPrice: 100,
          currency: "USD",
          nativeCurrency: "USD",
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 1,
      fxRateUsed: expectedFxRateUsed,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.fxRateUsed).toEqual(expectedFxRateUsed);
  });

  it("getPortfolioDataQuality reports missing fx/currency/price issues with refresh suggestions", async () => {
    vi.spyOn(portfoliosService, "getPortfolioOverview").mockResolvedValue({
      portfolio: { id: "portfolio-1" },
      holdings: [
        {
          ticker: "AAPL",
          marketValueCad: null,
          latestPrice: 100,
          latestPriceCapturedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          currency: "USD",
          nativeCurrency: "USD",
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
        {
          ticker: "SHOP",
          marketValueCad: null,
          latestPrice: null,
          latestPriceCapturedAt: null,
          currency: null,
          nativeCurrency: null,
          sector: "TECH",
          status: HoldingStatus.OWNED,
        },
      ],
      holdingCount: 2,
      fxRateUsed: null,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioDataQuality("portfolio-1");

    expect(result.holdingCount).toBe(2);
    expect(result.missingFxIssues.some((entry) => entry.ticker === "AAPL")).toBe(true);
    expect(result.missingCurrencyIssues.some((entry) => entry.ticker === "SHOP")).toBe(true);
    expect(result.missingPriceIssues.some((entry) => entry.ticker === "SHOP")).toBe(true);
    expect(result.suggestedRefreshActions).toContain("refreshUsdCadFxRate");
    expect(result.suggestedRefreshActions).toContain("runPortfolioFullRefresh");
  });
});
