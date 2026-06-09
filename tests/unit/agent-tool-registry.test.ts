import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentToolExecutor } from "../../src/agent/agent-tool-executor";
import {
  AgentToolRegistry,
  createAgentToolRegistry,
} from "../../src/agent/agent-tool-registry";
import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_RISK_LEVEL,
  AgentToolExecutionError,
} from "../../src/agent/agent-tool.types";
import * as analystService from "../../src/services/analyst-ingestion.service";
import * as discoveryService from "../../src/services/market-discovery.service";
import * as geopoliticalService from "../../src/services/geopolitical-ingestion.service";
import * as portfoliosService from "../../src/services/portfolios.service";
import * as realDataIngestionService from "../../src/services/real-data-ingestion.service";
import * as researchScoringService from "../../src/services/research-scoring.service";
import * as stocksService from "../../src/services/stocks.service";
import * as watchlistsService from "../../src/services/watchlists.service";

describe("agent tool registry and executor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists registered default tools", () => {
    const registry = createAgentToolRegistry();

    const names = registry.listToolDescriptors().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "getPortfolioOverview",
        "getTickerResearchBundle",
        "getWatchlistResearchBundle",
        "getDiscoveryCandidates",
        "getGeopoliticalSummary",
        "getLatestAnalystContext",
        "scoreTickerResearch",
        "scoreWatchlist",
        "compareTickers",
        "getPortfolioRiskSnapshot",
        "runPortfolioFullRefresh",
        "refreshTickerAnalystData",
        "refreshWatchlistAnalystData",
        "refreshDiscoveryCategory",
        "refreshGdeltRiskContext",
        "addTickerToWatchlist",
        "updateWatchlistItem",
        "removeWatchlistItem",
        "rebalancePaperPortfolio",
      ]),
    );
  });

  it("rejects duplicate tool registration", () => {
    const registry = new AgentToolRegistry();

    registry.registerTool({
      name: "testTool",
      description: "Test tool",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({}),
      notes: [],
      execute: async () => ({ ok: true }),
    });

    expect(() =>
      registry.registerTool({
        name: "testTool",
        description: "Duplicate",
        riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
        executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
        inputSchema: z.object({}),
        notes: [],
        execute: async () => ({ ok: true }),
      }),
    ).toThrowError(AgentToolExecutionError);
  });

  it("returns structured error for unknown tool name", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "unknownTool",
        input: {},
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("rejects invalid tool input via zod", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "getTickerResearchBundle",
        input: { ticker: "" },
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_INVALID_INPUT",
      statusCode: 400,
    });
  });

  it("getPortfolioOverview tool calls existing portfolio service", async () => {
    const portfolioOverviewSpy = vi
      .spyOn(portfoliosService, "getPortfolioOverview")
      .mockResolvedValue({
        portfolio: { id: "portfolio-1" },
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

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getPortfolioOverview",
      input: { portfolioId: "portfolio-1" },
      context: { source: "USER" },
    });

    expect(portfolioOverviewSpy).toHaveBeenCalledWith("portfolio-1");
    expect(result.success).toBe(true);
  });

  it("getTickerResearchBundle tool calls existing stocks service", async () => {
    const bundleSpy = vi
      .spyOn(stocksService, "getStockResearchBundle")
      .mockResolvedValue({ stock: { ticker: "AAPL" } } as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getTickerResearchBundle",
      input: { ticker: "aapl" },
      context: { source: "USER" },
    });

    expect(bundleSpy).toHaveBeenCalledWith("AAPL");
    expect(result.success).toBe(true);
  });

  it("getWatchlistResearchBundle tool calls existing watchlist service", async () => {
    const bundleSpy = vi
      .spyOn(watchlistsService, "getWatchlistResearchBundle")
      .mockResolvedValue({ watchlist: { id: "watchlist-1" }, itemCount: 0, items: [] } as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getWatchlistResearchBundle",
      input: { watchlistId: "watchlist-1" },
      context: { source: "USER" },
    });

    expect(bundleSpy).toHaveBeenCalledWith("watchlist-1");
    expect(result.success).toBe(true);
  });

  it("getDiscoveryCandidates input schema rejects invalid filters", async () => {
    const discoverySpy = vi
      .spyOn(discoveryService, "listDiscoveryCandidates")
      .mockResolvedValue({ category: "GAINERS", items: [] });

    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "getDiscoveryCandidates",
        input: {
          category: "gainers",
          filters: {
            minPrice: -1,
          },
        },
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_INVALID_INPUT",
      statusCode: 400,
    });

    expect(discoverySpy).not.toHaveBeenCalled();
  });

  it("confirmation-required tools cannot execute without confirmed=true", async () => {
    const registry = new AgentToolRegistry();
    registry.registerTool({
      name: "refreshPortfolioMarketData",
      description: "Refresh portfolio market data",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({ portfolioId: z.string().trim().min(1) }),
      notes: ["Potentially expensive refresh tool."],
      execute: async (input: { portfolioId: string }) => ({
        portfolioId: input.portfolioId,
        refreshed: true,
      }),
    });

    const executor = new AgentToolExecutor(registry);

    await expect(
      executor.executeByName({
        toolName: "refreshPortfolioMarketData",
        input: { portfolioId: "portfolio-1" },
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_CONFIRMATION_REQUIRED",
      statusCode: 409,
    });

    const confirmedResult = await executor.executeByName({
      toolName: "refreshPortfolioMarketData",
      input: { portfolioId: "portfolio-1" },
      context: { source: "USER" },
      confirmed: true,
    });

    expect(confirmedResult.success).toBe(true);
  });

  it("getLatestAnalystContext calls existing analyst read helpers", async () => {
    const snapshotSpy = vi
      .spyOn(analystService, "getLatestTickerAnalystSnapshot")
      .mockResolvedValue({ id: "snapshot-1" } as never);
    const actionsSpy = vi
      .spyOn(analystService, "listTickerAnalystActions")
      .mockResolvedValue([{ id: "action-1" }] as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getLatestAnalystContext",
      input: { ticker: "aapl", actionsLimit: 7 },
      context: { source: "AGENT" },
    });

    expect(snapshotSpy).toHaveBeenCalledWith("AAPL");
    expect(actionsSpy).toHaveBeenCalledWith("AAPL", 7);
    expect(result.success).toBe(true);
  });

  it("getGeopoliticalSummary tool calls existing geopolitical service", async () => {
    const geopoliticalSpy = vi
      .spyOn(geopoliticalService, "getGeopoliticalSummary")
      .mockResolvedValue({
        from: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        to: new Date("2026-06-08T00:00:00.000Z").toISOString(),
        totalEvents: 0,
        countsByCategory: [],
        countsByTheme: [],
        sentimentMix: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
        topHeadlines: [],
        topCountries: [],
        topDomains: [],
      });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getGeopoliticalSummary",
      input: { days: 14 },
      context: { source: "SYSTEM" },
    });

    expect(geopoliticalSpy).toHaveBeenCalledWith({ days: 14 });
    expect(result.success).toBe(true);
  });

  it("refresh tools require confirmation", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "refreshTickerAnalystData",
        input: { ticker: "AAPL" },
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_CONFIRMATION_REQUIRED",
      statusCode: 409,
      details: {
        toolName: "refreshTickerAnalystData",
        riskLevel: "REFRESH",
      },
    });
  });

  it("mutation tools require confirmation", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "addTickerToWatchlist",
        input: {
          watchlistId: "watchlist-1",
          ticker: "AAPL",
        },
        context: { source: "AGENT" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_CONFIRMATION_REQUIRED",
      statusCode: 409,
      details: {
        toolName: "addTickerToWatchlist",
        riskLevel: "MUTATION",
      },
    });
  });

  it("dry-run addTickerToWatchlist does not write", async () => {
    const addSpy = vi.spyOn(watchlistsService, "addTickerToWatchlist");
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    const result = await executor.executeByName({
      toolName: "addTickerToWatchlist",
      input: {
        watchlistId: "watchlist-1",
        ticker: "AAPL",
      },
      context: { source: "AGENT", dryRun: true },
      confirmed: true,
    });

    expect(addSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      plannedAction: true,
      toolName: "addTickerToWatchlist",
    });
  });

  it("confirmed addTickerToWatchlist writes", async () => {
    const addSpy = vi
      .spyOn(watchlistsService, "addTickerToWatchlist")
      .mockResolvedValue({ id: "item-1" } as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "addTickerToWatchlist",
      input: {
        watchlistId: "watchlist-1",
        ticker: "AAPL",
      },
      context: { source: "AGENT", dryRun: false },
      confirmed: true,
    });

    expect(addSpy).toHaveBeenCalledWith("watchlist-1", "AAPL", expect.objectContaining({
      source: "AGENT",
      status: "WATCHING",
      priority: "MEDIUM",
    }));
    expect(result.success).toBe(true);
  });

  it("updateWatchlistItem dry-run does not write", async () => {
    const updateSpy = vi.spyOn(watchlistsService, "updateWatchlistItemDetails");
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    const result = await executor.executeByName({
      toolName: "updateWatchlistItem",
      input: {
        itemId: "item-1",
        thesis: "Updated thesis",
      },
      context: { source: "AGENT", dryRun: true },
      confirmed: true,
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      plannedAction: true,
      toolName: "updateWatchlistItem",
    });
  });

  it("runPortfolioFullRefresh dry-run does not call refresh service", async () => {
    const refreshSpy = vi.spyOn(realDataIngestionService, "ingestPortfolioFmpFullRefresh");
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    const result = await executor.executeByName({
      toolName: "runPortfolioFullRefresh",
      input: {
        portfolioId: "portfolio-1",
        includeGdelt: true,
      },
      context: { source: "AGENT", dryRun: true },
      confirmed: true,
    });

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("GDELT refresh preserves failedQueries warnings", async () => {
    vi.spyOn(geopoliticalService, "ingestDefaultGdeltRiskSet").mockResolvedValue({
      startedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-01T00:00:01.000Z").toISOString(),
      durationMs: 1000,
      queriesProcessed: 2,
      queriesFailed: 1,
      eventsCreated: 3,
      eventsUpdated: 1,
      eventsSkipped: 0,
      warnings: ["query failed: throttled"],
      failedQueries: [
        {
          query: "war OR sanctions",
          reason: "rate limited",
          statusCode: 429,
          retryAttempted: true,
        },
      ],
      results: [],
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "refreshGdeltRiskContext",
      input: {
        mode: "quick",
      },
      context: { source: "AGENT" },
      confirmed: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      queriesFailed: 1,
      warnings: ["query failed: throttled"],
      failedQueries: [
        {
          query: "war OR sanctions",
        },
      ],
    });
  });

  it("disabled tool cannot execute", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "rebalancePaperPortfolio",
        input: {
          portfolioId: "portfolio-1",
        },
        context: { source: "AGENT" },
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_DISABLED",
      statusCode: 403,
      details: {
        toolName: "rebalancePaperPortfolio",
        riskLevel: "HIGH_IMPACT",
      },
    });
  });

  it("scoreTickerResearch tool calls deterministic scoring service", async () => {
    const scoreSpy = vi.spyOn(researchScoringService, "scoreTickerResearch").mockResolvedValue({
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
      bullishFactors: [],
      bearishFactors: [],
      missingData: [],
      staleDataWarnings: [],
      explanation: "deterministic",
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "scoreTickerResearch",
      input: { ticker: "aapl" },
      context: { source: "AGENT" },
    });

    expect(scoreSpy).toHaveBeenCalledWith("AAPL");
    expect(result.success).toBe(true);
    expect((result.data as { ticker: string }).ticker).toBe("AAPL");
  });
});
