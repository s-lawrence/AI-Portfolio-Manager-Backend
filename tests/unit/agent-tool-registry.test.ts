import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentToolExecutor } from "../../src/agent/agent-tool-executor";
import {
  AgentToolRegistry,
  createAgentToolRegistry,
} from "../../src/agent/agent-tool-registry";
import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_NAMES,
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
import * as macroIngestionService from "../../src/services/macro-ingestion.service";
import * as aiReportsService from "../../src/services/ai-reports.service";
import { bankOfCanadaProvider } from "../../src/providers/bank-of-canada";
import { updateHolding } from "../../src/repositories/holdings.repository";
import {
  createTestHolding,
  createTestPortfolio,
  createTestPriceSnapshot,
  createTestStock,
} from "../../src/test/factories";

describe("agent tool registry and executor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists registered default tools", () => {
    const registry = createAgentToolRegistry();

    const names = registry.listToolDescriptors().map((tool) => tool.name);
    expect([...names].sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("every registered tool has required metadata and input schema", () => {
    const registry = createAgentToolRegistry();
    const tools = registry.listTools();

    expect(tools.length).toBe(AGENT_TOOL_NAMES.length);

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.riskLevel).toBeTruthy();
      expect(tool.executionMode).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(typeof tool.inputSchema.safeParse).toBe("function");
    }
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
    expect(result.dataSummary).toMatchObject({
      portfolioId: "portfolio-1",
      holdingsCount: 0,
      missingFxOrCurrencyIssuesCount: 0,
    });
  });

  it("getTickerResearchBundle tool calls existing stocks service", async () => {
    const bundleSpy = vi
      .spyOn(stocksService, "getStockResearchBundle")
      .mockResolvedValue({ stock: { id: "stock-1", ticker: "AAPL" }, recentNews: [] } as never);
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

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getTickerResearchBundle",
      input: { ticker: "aapl" },
      context: { source: "USER" },
    });

    expect(bundleSpy).toHaveBeenCalledWith("AAPL");
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      ticker: "AAPL",
      compositeScore: 61,
      missingDataCount: 0,
      staleDataWarningsCount: 0,
    });
  });

  it("getTickerDataQuality tool calls research scoring service", async () => {
    const qualitySpy = vi
      .spyOn(researchScoringService, "getTickerDataQuality")
      .mockResolvedValue({
        ticker: "AAPL",
        hasPrice: true,
        hasTechnical: true,
        hasFundamental: true,
        hasAnalyst: false,
        hasNews: false,
        hasEarnings: true,
        hasReport: false,
        missingData: ["analyst", "news", "report"],
        staleDataWarnings: [],
        suggestedRefreshActions: ["refreshTickerAnalystData"],
      });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getTickerDataQuality",
      input: { ticker: "aapl" },
      context: { source: "USER" },
    });

    expect(qualitySpy).toHaveBeenCalledWith("AAPL");
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      ticker: "AAPL",
      missingDataCount: 3,
    });
  });

  it("resolveTickerOrCompany handles explicit ticker", async () => {
    vi.spyOn(stocksService, "searchStockCandidates").mockResolvedValue([
      {
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        country: "US",
        provider: "LOCAL_DB",
        matchType: "LOCAL",
        confidence: "HIGH",
      },
    ] as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "resolveTickerOrCompany",
      input: { query: "aapl" },
      context: { source: "USER" },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      resolvedTicker: "AAPL",
      isAmbiguous: false,
    });
  });

  it("resolveTickerOrCompany handles company alias", async () => {
    vi.spyOn(stocksService, "searchStockCandidates").mockResolvedValue([
      {
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        country: "US",
        provider: "FMP",
        matchType: "PROVIDER",
        confidence: "HIGH",
      },
    ] as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "resolveTickerOrCompany",
      input: { query: "Apple" },
      context: { source: "USER" },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      resolvedTicker: "AAPL",
    });
  });

  it("resolveTickerOrCompany returns ambiguity for one-letter symbols", async () => {
    vi.spyOn(stocksService, "searchStockCandidates").mockResolvedValue([
      {
        ticker: "E",
        companyName: "ENI S.p.A.",
        exchange: "NYSE",
        currency: "USD",
        country: "US",
        provider: "FMP",
        matchType: "PROVIDER",
        confidence: "LOW",
      },
      {
        ticker: "E.PA",
        companyName: "ENI S.p.A.",
        exchange: "EPA",
        currency: "EUR",
        country: "FR",
        provider: "FMP",
        matchType: "PROVIDER",
        confidence: "LOW",
      },
    ] as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "resolveTickerOrCompany",
      input: { query: "E" },
      context: { source: "USER" },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      isAmbiguous: true,
    });
    expect(result.dataSummary).toMatchObject({
      isAmbiguous: true,
    });
  });

  it("getWatchlistDataQuality tool calls research scoring service", async () => {
    const qualitySpy = vi
      .spyOn(researchScoringService, "getWatchlistDataQuality")
      .mockResolvedValue({
        watchlistId: "watchlist-1",
        itemCount: 2,
        completeItemsCount: 1,
        partialItemsCount: 1,
        emptyItemsCount: 0,
        perTickerQuality: [],
        suggestedRefreshActions: ["refreshWatchlistResearchData"],
      });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getWatchlistDataQuality",
      input: { watchlistId: "watchlist-1" },
      context: { source: "USER" },
    });

    expect(qualitySpy).toHaveBeenCalledWith("watchlist-1");
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      watchlistId: "watchlist-1",
      itemCount: 2,
    });
  });

  it("getPortfolioDataQuality tool calls research scoring service", async () => {
    const qualitySpy = vi
      .spyOn(researchScoringService, "getPortfolioDataQuality")
      .mockResolvedValue({
        portfolioId: "portfolio-1",
        holdingCount: 3,
        missingFxIssues: [{ ticker: "SHOP", currency: "USD" }],
        missingCurrencyIssues: [],
        missingPriceIssues: [{ ticker: "SHOP" }],
        staleDataWarnings: ["Stale price snapshots detected: SHOP."],
        suggestedRefreshActions: ["refreshUsdCadFxRate", "runPortfolioFullRefresh"],
      });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getPortfolioDataQuality",
      input: { portfolioId: "portfolio-1" },
      context: { source: "USER" },
    });

    expect(qualitySpy).toHaveBeenCalledWith("portfolio-1");
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      portfolioId: "portfolio-1",
      missingFxIssuesCount: 1,
      missingPriceIssuesCount: 1,
    });
  });

  it("rankPortfolioHoldings tool calls research scoring service and returns bounded ranking summary", async () => {
    const rankingSpy = vi
      .spyOn(researchScoringService, "rankPortfolioHoldings")
      .mockResolvedValue({
        portfolioId: "portfolio-1",
        asOf: new Date("2026-06-12T00:00:00.000Z").toISOString(),
        totalHoldings: 5,
        scoredHoldingsCount: 4,
        skippedHoldingsCount: 1,
        skippedHoldings: [
          {
            ticker: "NODATA",
            reason: "No meaningful persisted metrics are available for ranking.",
            missingData: ["price", "currency"],
          },
        ],
        rankedHoldings: [
          {
            rank: 1,
            ticker: "NVDA",
            companyName: "NVIDIA Corporation",
            quantity: 10,
            marketValueCad: 1200,
            marketValueNative: 1200,
            portfolioWeight: 24,
            compositeScore: 82.2,
            suggestedStance: "STRONG_CANDIDATE",
            componentScores: {
              technicalScore: 80,
              fundamentalScore: 82,
              valuationScore: 70,
              analystScore: 85,
              newsScore: 76,
              macroRiskScore: 61,
              earningsRiskScore: 58,
              dataQualityScore: 88,
            },
            bullishFactors: ["Revenue growth is positive."],
            bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
            missingData: [],
            staleDataWarnings: [],
          },
        ],
        warnings: [],
      });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "rankPortfolioHoldings",
      input: { portfolioId: "portfolio-1", limit: 3 },
      context: { source: "USER" },
    });

    expect(rankingSpy).toHaveBeenCalledWith("portfolio-1", {
      limit: 3,
      includeWatchlist: false,
    });
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      portfolioId: "portfolio-1",
      totalHoldings: 5,
      scoredHoldingsCount: 4,
      skippedHoldingsCount: 1,
    });
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
    expect(result.dataSummary).toMatchObject({
      watchlistId: "watchlist-1",
      itemCount: 0,
      tickersWithUsefulResearch: [],
      tickersMissingData: [],
    });
  });

  it("getDiscoveryCandidates input schema rejects invalid filters", async () => {
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
    expect(result.dataSummary).toMatchObject({
      totalEvents: 0,
      topHeadlines: [],
      topRisks: [],
    });
  });

  it("dry-run refresh returns planned dataSummary without executing writes", async () => {
    const refreshSpy = vi.spyOn(watchlistsService, "refreshWatchlistResearchData").mockResolvedValue({
      watchlistId: "watchlist-1",
      startedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-01T00:00:01.000Z").toISOString(),
      durationMs: 1000,
      tickersProcessed: 4,
      tickersFailed: 0,
      tickersSkipped: 1,
      plannedTickers: ["NVDA", "AAPL", "MSFT", "TSLA", "AMD", "SHOP"],
      perTickerResults: [],
      warnings: [],
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "refreshWatchlistResearchData",
      input: {
        watchlistId: "watchlist-1",
      },
      context: { source: "USER", dryRun: true },
      confirmed: true,
    });

    expect(refreshSpy).toHaveBeenCalledWith("watchlist-1", expect.objectContaining({ dryRun: true }));
    expect(result.dataSummary).toMatchObject({
      plannedOrExecuted: "planned",
      toolName: "refreshWatchlistResearchData",
      plannedAction: true,
      watchlistId: "watchlist-1",
      plannedTickersCount: 6,
    });
    expect((result.dataSummary?.plannedTickers as string[]).length).toBeLessThanOrEqual(5);
  });

  it("tool dataSummary remains bounded for large payloads", async () => {
    const items = Array.from({ length: 200 }).map((_, index) => ({
      ticker: `TK${index}`,
    }));

    vi.spyOn(discoveryService, "listDiscoveryCandidates").mockResolvedValue({
      category: "GAINERS",
      candidateCount: 200,
      topTickers: ["TK0", "TK1", "TK2", "TK3", "TK4", "TK5"],
      capturedAt: new Date("2026-06-10T12:00:00.000Z").toISOString(),
      warnings: ["stale snapshot"],
      items,
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "getDiscoveryCandidates",
      input: { category: "GAINERS" },
      context: { source: "USER" },
    });

    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      category: "GAINERS",
      candidateCount: 200,
      warningCount: 1,
    });
    expect((result.dataSummary?.topTickers as string[]).length).toBeLessThanOrEqual(5);
  });

  it("rankDiscoveryCandidates tool calls discovery service and returns bounded ranking summary", async () => {
    const rankSpy = vi
      .spyOn(discoveryService, "rankDiscoveryCandidates")
      .mockResolvedValue({
        category: "GAINERS",
        totalCandidates: 10,
        scoredCandidatesCount: 6,
        skippedCandidatesCount: 4,
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
            changePercent: 2.1,
            marketCap: 2_000_000_000,
            compositeScore: 81.3,
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
            changePercent: 2.1,
            marketCap: 2_000_000_000,
            compositeScore: 81.3,
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
        suggestedRefreshActions: ["refreshDiscoveryCategory"],
      });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "rankDiscoveryCandidates",
      input: {
        category: "GAINERS",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
        limit: 5,
      },
      context: { source: "USER" },
    });

    expect(rankSpy).toHaveBeenCalledWith({
      category: "GAINERS",
      portfolioId: "portfolio-1",
      watchlistId: "watchlist-1",
      limit: 5,
      excludeExistingHoldings: undefined,
      excludeExistingWatchlistItems: undefined,
    });
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      category: "GAINERS",
      totalCandidates: 10,
      scoredCandidatesCount: 6,
      skippedCandidatesCount: 4,
      suggestedRefreshActions: ["refreshDiscoveryCategory"],
    });
  });

  it("tool errors are structured and secret-safe", async () => {
    const registry = new AgentToolRegistry();

    registry.registerTool({
      name: "secretThrowTool",
      description: "throws redaction test error",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({}),
      notes: [],
      execute: async () => {
        throw new Error("upstream failed with api_key=sk-secret-12345\n    at FakeStack:10:2");
      },
    });

    const executor = new AgentToolExecutor(registry);
    const result = await executor.executeByName({
      toolName: "secretThrowTool",
      input: {},
      context: { source: "SYSTEM" },
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).not.toContain("sk-secret-12345");
    expect(result.errors[0]).not.toContain("at FakeStack");
    expect(result.errors[0]).toContain("api_key=[REDACTED]");
    expect(result.dataSummary).toMatchObject({
      toolName: "secretThrowTool",
      failed: true,
    });
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

  it("refreshWatchlistResearchData requires confirmation", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "refreshWatchlistResearchData",
        input: { watchlistId: "watchlist-1" },
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_CONFIRMATION_REQUIRED",
      statusCode: 409,
      details: {
        toolName: "refreshWatchlistResearchData",
        riskLevel: "REFRESH",
      },
    });
  });

  it("refreshWatchlistResearchData dry-run returns planned tickers", async () => {
    const refreshSpy = vi.spyOn(watchlistsService, "refreshWatchlistResearchData").mockResolvedValue({
      watchlistId: "watchlist-1",
      startedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-01T00:00:01.000Z").toISOString(),
      durationMs: 1000,
      tickersProcessed: 2,
      tickersFailed: 0,
      tickersSkipped: 1,
      plannedTickers: ["NVDA", "RY.TO"],
      perTickerResults: [
        {
          ticker: "NVDA",
          itemId: "item-1",
          status: "WATCHING",
          skipped: false,
          warnings: [],
          failedCategories: [],
        },
      ],
      warnings: [],
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "refreshWatchlistResearchData",
      input: {
        watchlistId: "watchlist-1",
      },
      context: { source: "USER", dryRun: true },
      confirmed: true,
    });

    expect(refreshSpy).toHaveBeenCalledWith("watchlist-1", expect.objectContaining({ dryRun: true }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      plannedAction: true,
      toolName: "refreshWatchlistResearchData",
      plannedTickers: ["NVDA", "RY.TO"],
    });
  });

  it("confirmed refreshUsdCadFxRate executes Bank of Canada USD/CAD ingestion", async () => {
    const refreshSpy = vi.spyOn(macroIngestionService, "ingestBankOfCanadaUsdCad").mockResolvedValue({
      startedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-01T00:00:01.000Z").toISOString(),
      durationMs: 1000,
      recordsCreated: 1,
      recordsUpdated: 0,
      recordsSkipped: 0,
      warnings: [],
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "refreshUsdCadFxRate",
      input: {},
      context: { source: "AGENT" },
      confirmed: true,
    });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("refreshUsdCadFxRate followed by getPortfolioRiskSnapshot resolves missing FX", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTRFX01");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: "OWNED",
      shares: 10,
      averageCost: 90,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 100,
      capturedAt: new Date("2026-06-07T00:00:00.000Z"),
    });

    const before = await researchScoringService.getPortfolioRiskSnapshot(portfolio.id);
    expect(before.holdingsMissingFx).toEqual([
      {
        ticker: stock.ticker,
        currency: "USD",
      },
    ]);

    vi.spyOn(bankOfCanadaProvider, "getUsdCadRate").mockResolvedValue([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.35,
        capturedAt: new Date("2026-06-07T00:00:00.000Z"),
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const refreshResult = await executor.executeByName({
      toolName: "refreshUsdCadFxRate",
      input: {},
      context: { source: "AGENT" },
      confirmed: true,
    });

    expect(refreshResult.success).toBe(true);

    const after = await researchScoringService.getPortfolioRiskSnapshot(portfolio.id);
    expect(after.holdingsMissingFx).toEqual([]);
    expect(after.fxRateUsed?.pair).toBe("USD/CAD");
    expect(after.conversionStatuses[0]?.conversionStatus).toBe("CONVERTED");
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

    await expect(
      executor.executeByName({
        toolName: "generateTickerReport",
        input: {
          ticker: "AAPL",
          useOpenAi: false,
        },
        context: { source: "AGENT" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_CONFIRMATION_REQUIRED",
      statusCode: 409,
      details: {
        toolName: "generateTickerReport",
        riskLevel: "MUTATION",
      },
    });
  });

  it("generateTickerReport dry-run returns planned context and skips writes", async () => {
    const contextSpy = vi
      .spyOn(aiReportsService, "buildTickerReportContext")
      .mockResolvedValue({
        ticker: "AAPL",
        companyName: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        asOf: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        dataQuality: {
          missingData: [],
          staleDataWarnings: [],
          confidence: "HIGH",
        },
        marketSnapshot: null,
        technicalSnapshot: null,
        fundamentalSnapshot: null,
        analystContext: null,
        recentAnalystActions: [],
        analystEstimates: {
          latestAnnual: null,
          latestQuarter: null,
        },
        fmpFinancialRating: null,
        newsContext: null,
        earningsContext: null,
        macroContext: null,
        geopoliticalContext: null,
        deterministicScore: null,
      } as never);
    const generateSpy = vi.spyOn(aiReportsService, "generateTickerReport");

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "generateTickerReport",
      input: {
        ticker: "AAPL",
        useOpenAi: false,
      },
      context: { source: "AGENT", dryRun: true },
      confirmed: true,
    });

    expect(contextSpy).toHaveBeenCalledWith("AAPL", expect.any(Object));
    expect(generateSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      plannedOrExecuted: "planned",
      toolName: "generateTickerReport",
    });
  });

  it("generateTickerReport executes when confirmed", async () => {
    const generateSpy = vi
      .spyOn(aiReportsService, "generateTickerReport")
      .mockResolvedValue({
        report: {
          id: "report-2",
          recommendation: "BUY",
        },
        predictions: [{ id: "prediction-1" }],
        reportMode: "OPENAI_STRUCTURED",
        fallbackUsed: false,
        warnings: [],
        dataGaps: [],
        modelName: "gpt-test",
      } as never);

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "generateTickerReport",
      input: {
        ticker: "MSFT",
        useOpenAi: true,
      },
      context: { source: "USER" },
      confirmed: true,
    });

    expect(generateSpy).toHaveBeenCalledWith("MSFT", expect.objectContaining({ useOpenAi: true }));
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      reportId: "report-2",
      recommendation: "BUY",
      reportMode: "OPENAI_STRUCTURED",
      predictionCount: 1,
      modelName: "gpt-test",
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

  it("refreshGdeltRiskContext dry-run returns planned query profiles and does not call service", async () => {
    const refreshSpy = vi.spyOn(geopoliticalService, "ingestDefaultGdeltRiskSet");
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    const result = await executor.executeByName({
      toolName: "refreshGdeltRiskContext",
      input: {
        mode: "quick",
        lookbackDays: 7,
      },
      context: { source: "AGENT", dryRun: true },
      confirmed: true,
    });

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      plannedAction: true,
      toolName: "refreshGdeltRiskContext",
      queryProfiles: expect.any(Array),
    });
  });

  it("refreshGdeltRiskContext confirmed path calls ingestion service", async () => {
    const refreshSpy = vi.spyOn(geopoliticalService, "ingestDefaultGdeltRiskSet").mockResolvedValue({
      startedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      finishedAt: new Date("2026-06-01T00:00:01.000Z").toISOString(),
      durationMs: 1000,
      queriesProcessed: 1,
      queriesFailed: 0,
      eventsCreated: 1,
      eventsUpdated: 0,
      eventsSkipped: 0,
      warnings: [],
      failedQueries: [],
      results: [],
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    await executor.executeByName({
      toolName: "refreshGdeltRiskContext",
      input: {
        mode: "quick",
      },
      context: { source: "AGENT" },
      confirmed: true,
    });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
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
      actionLabel: "Review candidate",
      bullishFactors: [],
      bearishFactors: [],
      missingData: [],
      staleDataWarnings: [],
      confidence: "HIGH",
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
    expect(result.dataSummary).toMatchObject({
      ticker: "AAPL",
      compositeScore: 61,
      suggestedStance: "CANDIDATE",
      actionLabel: "Review candidate",
      confidence: "HIGH",
    });
  });

  it("rankWatchlist tool calls deterministic scoring service", async () => {
    const scoreSpy = vi.spyOn(researchScoringService, "scoreWatchlist").mockResolvedValue({
      watchlistId: "watchlist-1",
      watchlistName: "Main",
      asOf: new Date().toISOString(),
      totalItems: 1,
      activeItemsCount: 1,
      scoredItemsCount: 1,
      skippedItemsCount: 0,
      skippedItems: [],
      warnings: [],
      itemCount: 1,
      rankedItems: [
        {
          rank: 1,
          itemId: "item-1",
          ticker: "AAPL",
          compositeScore: 75,
          suggestedStance: "CANDIDATE",
          score: {
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
            compositeScore: 75,
            suggestedStance: "CANDIDATE",
            actionLabel: "Strong review candidate",
            bullishFactors: [],
            bearishFactors: [],
            missingData: [],
            staleDataWarnings: [],
            confidence: "HIGH",
            explanation: "deterministic",
          },
        },
      ],
    });

    const executor = new AgentToolExecutor(createAgentToolRegistry());
    const result = await executor.executeByName({
      toolName: "rankWatchlist",
      input: { watchlistId: "watchlist-1" },
      context: { source: "USER" },
    });

    expect(scoreSpy).toHaveBeenCalledWith("watchlist-1");
    expect(result.success).toBe(true);
    expect(result.dataSummary).toMatchObject({
      totalItems: 1,
      scoredItemsCount: 1,
    });
  });

  it("refreshTickerResearchData requires confirmation and supports dryRun", async () => {
    const executor = new AgentToolExecutor(createAgentToolRegistry());

    await expect(
      executor.executeByName({
        toolName: "refreshTickerResearchData",
        input: { ticker: "AAPL" },
        context: { source: "USER" },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_TOOL_CONFIRMATION_REQUIRED",
      statusCode: 409,
    });

    const dryRun = await executor.executeByName({
      toolName: "refreshTickerResearchData",
      input: { ticker: "AAPL" },
      context: { source: "USER", dryRun: true },
      confirmed: true,
    });

    expect(dryRun.success).toBe(true);
    expect(dryRun.dataSummary).toMatchObject({
      plannedOrExecuted: "planned",
      toolName: "refreshTickerResearchData",
    });
  });
});
