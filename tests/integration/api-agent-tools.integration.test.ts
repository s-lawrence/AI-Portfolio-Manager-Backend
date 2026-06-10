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
          ticker: "AAPL",
        },
      } as never);

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
