import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { AGENT_TOOL_NAMES } from "../../src/agent/agent-tool.types";
import * as discoveryService from "../../src/services/market-discovery.service";
import * as portfoliosService from "../../src/services/portfolios.service";
import * as researchScoringService from "../../src/services/research-scoring.service";
import * as stocksService from "../../src/services/stocks.service";
import * as watchlistsService from "../../src/services/watchlists.service";

describe("API agent tools routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists agent tools with standard envelope", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/agent/tools",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.tools)).toBe(true);
    const listedNames = body.data.tools.map((tool: { name: string }) => tool.name);
    expect([...listedNames].sort()).toEqual([...AGENT_TOOL_NAMES].sort());

    await app.close();
  });

  it("returns structured error envelope for unknown tool", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/notARealTool/execute",
      payload: {
        context: {
          source: "USER",
        },
        input: {},
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_NOT_FOUND");

    await app.close();
  });

  it("returns structured error envelope for invalid tool input", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/getDiscoveryCandidates/execute",
      payload: {
        context: {
          source: "USER",
        },
        input: {
          category: "GAINERS",
          filters: {
            minPrice: -10,
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_INVALID_INPUT");

    await app.close();
  });

  it("executes getTickerResearchBundle and returns standard envelope", async () => {
    const bundleSpy = vi
      .spyOn(stocksService, "getStockResearchBundle")
      .mockResolvedValue({
        stock: {
          id: "stock-1",
          ticker: "AAPL",
          companyName: "Apple Inc.",
          exchange: "NASDAQ",
          currency: "USD",
          country: "US",
          sector: "Technology",
          industry: "Consumer Electronics",
          assetType: "EQUITY",
        },
        recentNews: [],
        recentAnalystActions: [],
        latestPriceSnapshot: null,
        latestTechnicalSnapshot: null,
        latestFundamentalSnapshot: null,
        latestAnalystSnapshot: null,
        latestAnnualAnalystEstimate: null,
        latestQuarterAnalystEstimate: null,
        nextEarningsEvent: null,
        latestAIReport: null,
      } as never);
    vi.spyOn(researchScoringService, "getTickerDataQuality").mockResolvedValue({
      ticker: "AAPL",
      hasPrice: true,
      hasTechnical: true,
      hasFundamental: true,
      hasAnalyst: true,
      hasNews: true,
      hasEarnings: true,
      hasReport: true,
      missingData: [],
      staleDataWarnings: [],
      suggestedRefreshActions: [],
    });
    vi.spyOn(researchScoringService, "scoreTickerResearch").mockResolvedValue({
      ticker: "AAPL",
      asOf: new Date().toISOString(),
      componentScores: {
        technicalScore: 60,
        fundamentalScore: 62,
        valuationScore: 55,
        analystScore: 64,
        newsScore: 58,
        macroRiskScore: 52,
        earningsRiskScore: 56,
        dataQualityScore: 90,
      },
      compositeScore: 61,
      suggestedStance: "CANDIDATE",
      actionLabel: "Review candidate",
      bullishFactors: [],
      bearishFactors: [],
      missingData: [],
      staleDataWarnings: [],
      confidence: "HIGH",
      explanation: "deterministic",
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/getTickerResearchBundle/execute",
      payload: {
        context: {
          source: "USER",
          dryRun: false,
        },
        input: {
          ticker: "AAPL",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.toolName).toBe("getTickerResearchBundle");
    expect(body.data.success).toBe(true);
    expect(body.data.dataSummary).toMatchObject({
      ticker: "AAPL",
      compositeScore: 61,
    });
    expect(bundleSpy).toHaveBeenCalledWith("AAPL");

    await app.close();
  });

  it("executes getPortfolioOverview using existing service", async () => {
    const overviewSpy = vi
      .spyOn(portfoliosService, "getPortfolioOverview")
      .mockResolvedValue({
        portfolio: { id: "portfolio-123" },
        holdings: [],
        portfolioBaseCurrency: "CAD",
        holdingCount: 0,
        ownedHoldingCount: 0,
        watchlistHoldingCount: 0,
        estimatedMarketValue: null,
        totalMarketValueNative: null,
        totalMarketValueCad: null,
        totalCostBasisCad: null,
        totalUnrealizedGainLossCad: null,
        totalUnrealizedGainLossPercentCad: null,
        fxRateUsed: null,
        holdingsMissingFx: [],
        holdingsUnsupportedCurrency: [],
        topSectorsByCount: [],
      } as never);

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/getPortfolioOverview/execute",
      payload: {
        context: {
          source: "USER",
        },
        input: {
          portfolioId: "portfolio-123",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(overviewSpy).toHaveBeenCalledWith("portfolio-123");

    await app.close();
  });

  it("executes getDiscoveryCandidates through existing discovery service", async () => {
    const discoverySpy = vi
      .spyOn(discoveryService, "listDiscoveryCandidates")
      .mockResolvedValue({
        category: "GAINERS",
        candidateCount: 0,
        topTickers: [],
        capturedAt: undefined,
        warnings: [],
        items: [],
      });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/getDiscoveryCandidates/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          category: "GAINERS",
          limit: 25,
          filters: {
            minPrice: 5,
            maxChangePercent: 300,
            excludeOtc: true,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(discoverySpy).toHaveBeenCalledWith("GAINERS", {
      limit: 25,
      minPrice: 5,
      minVolume: undefined,
      minMarketCap: undefined,
      maxChangePercent: 300,
      excludeOtc: true,
    });

    await app.close();
  });

  it("executes rankDiscoveryCandidates through existing discovery service", async () => {
    const rankSpy = vi
      .spyOn(discoveryService, "rankDiscoveryCandidates")
      .mockResolvedValue({
        category: "GAINERS",
        totalCandidates: 4,
        scoredCandidatesCount: 3,
        skippedCandidatesCount: 1,
        recommendationThreshold: {
          minimumRecommendationScore: 60,
          monitorOnlyScoreFloor: 50,
          monitorOnlyScoreCeiling: 59.99,
          labels: {
            strongReviewCandidate: "Strong review candidate",
            reviewCandidate: "Review candidate",
            monitorOnly: "Monitor only",
            notRecommended: "Not recommended from current snapshot",
          },
        },
        noQualifiedCandidates: false,
        rankedCandidates: [
          {
            rank: 1,
            ticker: "NVDA",
            companyName: "NVIDIA Corporation",
            category: "GAINERS",
            price: 120,
            changePercent: 2.3,
            marketCap: 2_000_000_000,
            compositeScore: 81.2,
            suggestedStance: "STRONG_CANDIDATE",
            actionLabel: "Strong review candidate",
            qualifiesForRecommendation: true,
            why: ["Revenue growth is positive."],
            cautions: ["RSI is elevated and may signal short-term exhaustion."],
            dataQualityScore: 84,
            bullishFactors: ["Revenue growth is positive."],
            bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
            missingData: [],
            staleDataWarnings: [],
            diversificationNotes: ["Not currently held; can be evaluated as a potential diversification candidate."],
            alreadyHeld: false,
            alreadyInWatchlist: false,
          },
        ],
        recommendedCandidates: [
          {
            rank: 1,
            ticker: "NVDA",
            companyName: "NVIDIA Corporation",
            category: "GAINERS",
            price: 120,
            changePercent: 2.3,
            marketCap: 2_000_000_000,
            compositeScore: 81.2,
            suggestedStance: "STRONG_CANDIDATE",
            actionLabel: "Strong review candidate",
            qualifiesForRecommendation: true,
            why: ["Revenue growth is positive."],
            cautions: ["RSI is elevated and may signal short-term exhaustion."],
            dataQualityScore: 84,
            bullishFactors: ["Revenue growth is positive."],
            bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
            missingData: [],
            staleDataWarnings: [],
            diversificationNotes: ["Not currently held; can be evaluated as a potential diversification candidate."],
            alreadyHeld: false,
            alreadyInWatchlist: false,
          },
        ],
        monitorCandidates: [],
        notRecommendedCandidates: [],
        bestAvailableButBelowThreshold: [],
        skippedCandidates: [
          {
            ticker: "MSFT",
            reason: "Ticker is already held in the portfolio.",
            missingData: [],
          },
        ],
        warnings: [],
        reasonNoQualifiedCandidates: undefined,
        suggestedRefreshActions: [],
      });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/rankDiscoveryCandidates/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          category: "GAINERS",
          portfolioId: "portfolio-1",
          watchlistId: "watchlist-1",
          limit: 5,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(rankSpy).toHaveBeenCalledWith({
      category: "GAINERS",
      portfolioId: "portfolio-1",
      watchlistId: "watchlist-1",
      limit: 5,
      excludeExistingHoldings: undefined,
      excludeExistingWatchlistItems: undefined,
    });

    await app.close();
  });

  it("returns confirmation-required error for mutation tool without confirmed=true", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/addTickerToWatchlist/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          watchlistId: "watchlist-1",
          ticker: "AAPL",
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_CONFIRMATION_REQUIRED");
    expect(body.error.message).toBe("Tool requires confirmation.");

    await app.close();
  });

  it("returns confirmation-required error for runPortfolioFullRefresh without confirmed=true", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/runPortfolioFullRefresh/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          portfolioId: "portfolio-1",
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_CONFIRMATION_REQUIRED");

    await app.close();
  });

  it("returns confirmation-required error for refreshWatchlistResearchData without confirmed=true", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/refreshWatchlistResearchData/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          watchlistId: "watchlist-1",
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_CONFIRMATION_REQUIRED");

    await app.close();
  });

  it("returns confirmation-required error for refreshTickerAnalystData without confirmed=true", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/refreshTickerAnalystData/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          ticker: "AAPL",
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_CONFIRMATION_REQUIRED");

    await app.close();
  });

  it("returns planned-action result for dry-run mutation without writing", async () => {
    const addSpy = vi.spyOn(watchlistsService, "addTickerToWatchlist");

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/addTickerToWatchlist/execute",
      payload: {
        context: {
          source: "AGENT",
          dryRun: true,
        },
        confirmed: true,
        input: {
          watchlistId: "watchlist-1",
          ticker: "AAPL",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(body.data.data).toMatchObject({
      plannedAction: true,
      toolName: "addTickerToWatchlist",
    });
    expect(addSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it("executes confirmed mutation and calls watchlist service", async () => {
    const addSpy = vi
      .spyOn(watchlistsService, "addTickerToWatchlist")
      .mockResolvedValue({ id: "item-1" } as never);

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/addTickerToWatchlist/execute",
      payload: {
        context: {
          source: "AGENT",
          dryRun: false,
        },
        confirmed: true,
        input: {
          watchlistId: "watchlist-1",
          ticker: "AAPL",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(addSpy).toHaveBeenCalledWith("watchlist-1", "AAPL", expect.objectContaining({
      source: "AGENT",
      status: "WATCHING",
      priority: "MEDIUM",
    }));

    await app.close();
  });

  it("returns disabled error for disabled high-impact tool", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/rebalancePaperPortfolio/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        confirmed: true,
        input: {
          portfolioId: "portfolio-1",
        },
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AGENT_TOOL_DISABLED");

    await app.close();
  });

  it("executes compareTickers scoring tool and returns standard envelope", async () => {
    const compareSpy = vi.spyOn(researchScoringService, "compareTickers").mockResolvedValue({
      asOf: new Date().toISOString(),
      requestedTickers: ["AAPL", "MSFT", "NVDA"],
      scores: [],
      keyDifferences: [],
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/compareTickers/execute",
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          tickers: ["AAPL", "MSFT", "NVDA"],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(compareSpy).toHaveBeenCalledWith(["AAPL", "MSFT", "NVDA"]);

    await app.close();
  });
});
