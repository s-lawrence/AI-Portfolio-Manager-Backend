import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as geopoliticalService from "../../src/services/geopolitical-ingestion.service";
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
        { itemId: "item-1", ticker: "AAA", status: "WATCHING", priority: "HIGH" },
        { itemId: "item-2", ticker: "BBB", status: "WATCHING", priority: "HIGH" },
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

    expect(result.rankedItems).toHaveLength(2);
    expect(result.rankedItems[0].ticker).toBe("AAA");
    expect(result.rankedItems[0].compositeScore).toBeGreaterThanOrEqual(
      result.rankedItems[1].compositeScore,
    );
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
        { ticker: "AAPL", marketValueCad: 700, latestPrice: 200, currency: "USD", sector: "TECH" },
        { ticker: "MSFT", marketValueCad: 200, latestPrice: 180, currency: "USD", sector: "TECH" },
        { ticker: "XOM", marketValueCad: 100, latestPrice: 90, currency: "USD", sector: "ENERGY" },
      ],
      holdingCount: 3,
      holdingsMissingFx: [],
      holdingsUnsupportedCurrency: [],
    } as never);

    const result = await researchScoringService.getPortfolioRiskSnapshot("portfolio-1");

    expect(result.concentrationRisks.length).toBeGreaterThan(0);
    expect(result.topRisks.some((risk) => risk.includes("concentration"))).toBe(true);
  });
});
