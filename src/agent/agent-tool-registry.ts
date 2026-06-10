import { z } from "zod";
import {
  WatchlistItemPriority,
  WatchlistItemSource,
  WatchlistItemStatus,
} from "@prisma/client";

import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_RISK_LEVEL,
  type AgentToolContext,
  type AgentToolDescriptor,
  type AnyAgentToolDefinition,
  AgentToolExecutionError,
} from "./agent-tool.types";
import * as portfoliosService from "../services/portfolios.service";
import * as stocksService from "../services/stocks.service";
import * as watchlistsService from "../services/watchlists.service";
import * as discoveryService from "../services/market-discovery.service";
import * as geopoliticalService from "../services/geopolitical-ingestion.service";
import * as analystService from "../services/analyst-ingestion.service";
import * as realDataIngestionService from "../services/real-data-ingestion.service";
import * as researchScoringService from "../services/research-scoring.service";
import * as macroIngestionService from "../services/macro-ingestion.service";

const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9.\-]+$/, "Ticker must only contain letters, numbers, '.', or '-'.")
  .transform((value) => value.toUpperCase());

const discoveryCategorySchema = z
  .enum(["GAINERS", "LOSERS", "ACTIVE", "ANALYST_UPGRADES", "ANALYST_DOWNGRADES"])
  .or(z.string().trim().min(1).transform((value) => value.toUpperCase()));

const discoveryFiltersSchema = z
  .object({
    minPrice: z.coerce.number().nonnegative().optional(),
    minVolume: z.coerce.number().nonnegative().optional(),
    minMarketCap: z.coerce.number().nonnegative().optional(),
    maxChangePercent: z.coerce.number().nonnegative().optional(),
    excludeOtc: z.boolean().optional(),
  })
  .optional();

const optionalLimitSchema = z.coerce.number().int().positive().max(500).optional();
const watchlistStatusSchema = z.nativeEnum(WatchlistItemStatus).optional();
const watchlistPrioritySchema = z.nativeEnum(WatchlistItemPriority).optional();
const watchlistSourceSchema = z.nativeEnum(WatchlistItemSource).optional();

function resolveDefaultWatchlistSource(
  context: AgentToolContext,
  explicitSource?: WatchlistItemSource,
): WatchlistItemSource {
  if (explicitSource) {
    return explicitSource;
  }

  return context.source === "AGENT" ? WatchlistItemSource.AGENT : WatchlistItemSource.USER;
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AnyAgentToolDefinition>();

  registerTool(definition: AnyAgentToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new AgentToolExecutionError(
        409,
        "AGENT_TOOL_DUPLICATE",
        `Tool '${definition.name}' is already registered.`,
      );
    }

    this.tools.set(definition.name, definition);
  }

  registerTools(definitions: AnyAgentToolDefinition[]): void {
    for (const definition of definitions) {
      this.registerTool(definition);
    }
  }

  listTools(): AnyAgentToolDefinition[] {
    return [...this.tools.values()];
  }

  listToolDescriptors(): AgentToolDescriptor[] {
    return this.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel,
      executionMode: tool.executionMode,
      notes: tool.notes,
    }));
  }

  getTool(name: string): AnyAgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  validateToolInput(name: string, input: unknown): unknown {
    const tool = this.getTool(name);

    if (!tool) {
      throw new AgentToolExecutionError(
        404,
        "AGENT_TOOL_NOT_FOUND",
        `Unknown agent tool '${name}'.`,
      );
    }

    const parsed = tool.inputSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw new AgentToolExecutionError(
        400,
        "AGENT_TOOL_INVALID_INPUT",
        `Invalid input for tool '${name}'.`,
        parsed.error.flatten(),
      );
    }

    return parsed.data;
  }
}

function buildReadOnlyTools(): AnyAgentToolDefinition[] {
  return [
    {
      name: "getPortfolioOverview",
      description:
        "Returns a portfolio overview with holdings, market values, CAD equivalents, and latest report context.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1),
      }),
      notes: [
        "Reads only persisted backend data.",
        "Returns not found when the portfolio does not exist.",
      ],
      execute: async (input: { portfolioId: string }) => {
        const result = await portfoliosService.getPortfolioOverview(input.portfolioId);
        if (!result) {
          throw new AgentToolExecutionError(404, "NOT_FOUND", "Portfolio not found.");
        }

        return result;
      },
    },
    {
      name: "getTickerResearchBundle",
      description:
        "Returns local persisted research context for a ticker, including price, technicals, fundamentals, analyst context, and news.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        ticker: tickerSchema,
      }),
      notes: [
        "Does not call external providers directly.",
        "Data freshness depends on prior ingestion runs.",
      ],
      execute: async (input: { ticker: string }) => {
        const result = await stocksService.getStockResearchBundle(input.ticker);
        if (!result) {
          throw new AgentToolExecutionError(404, "NOT_FOUND", "Ticker research bundle not found.");
        }

        return result;
      },
    },
    {
      name: "getWatchlistResearchBundle",
      description:
        "Returns local persisted watchlist research context for all watchlist items with optional geopolitical summary.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
      }),
      notes: [
        "Does not call external providers directly.",
        "Returns not found when the watchlist does not exist.",
      ],
      execute: async (input: { watchlistId: string }) => {
        const result = await watchlistsService.getWatchlistResearchBundle(input.watchlistId);
        if (!result) {
          throw new AgentToolExecutionError(404, "NOT_FOUND", "Watchlist research bundle not found.");
        }

        return result;
      },
    },
    {
      name: "getDiscoveryCandidates",
      description:
        "Returns locally persisted market discovery candidates by category with optional quality filters.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        category: discoveryCategorySchema,
        limit: optionalLimitSchema,
        filters: discoveryFiltersSchema,
      }),
      notes: [
        "Reads only local discovery snapshots.",
        "Freshness depends on previous discovery ingestion/refresh runs.",
      ],
      execute: async (input: {
        category: string;
        limit?: number;
        filters?: {
          minPrice?: number;
          minVolume?: number;
          minMarketCap?: number;
          maxChangePercent?: number;
          excludeOtc?: boolean;
        };
      }) =>
        discoveryService.listDiscoveryCandidates(input.category, {
          limit: input.limit,
          minPrice: input.filters?.minPrice,
          minVolume: input.filters?.minVolume,
          minMarketCap: input.filters?.minMarketCap,
          maxChangePercent: input.filters?.maxChangePercent,
          excludeOtc: input.filters?.excludeOtc,
        }),
    },
    {
      name: "getGeopoliticalSummary",
      description:
        "Returns a bounded geopolitical summary from stored events, including sentiment mix and top headlines.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        days: z.coerce.number().int().positive().max(3650).optional(),
      }),
      notes: [
        "Reads only persisted geopolitical events.",
        "Freshness depends on previous GDELT ingestion runs.",
      ],
      execute: async (input: { days?: number }) =>
        geopoliticalService.getGeopoliticalSummary({
          days: input.days,
        }),
    },
    {
      name: "getLatestAnalystContext",
      description:
        "Returns the latest persisted analyst snapshot and recent analyst actions for a ticker.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        ticker: tickerSchema,
        actionsLimit: optionalLimitSchema,
      }),
      notes: [
        "Reads only persisted analyst context.",
        "Returns not found when no analyst snapshot/actions are available for the ticker.",
      ],
      execute: async (input: { ticker: string; actionsLimit?: number }) => {
        const [latestSnapshot, recentActions] = await Promise.all([
          analystService.getLatestTickerAnalystSnapshot(input.ticker),
          analystService.listTickerAnalystActions(input.ticker, input.actionsLimit ?? 10),
        ]);

        if (!latestSnapshot && recentActions.length === 0) {
          throw new AgentToolExecutionError(404, "NOT_FOUND", "Analyst context not found.");
        }

        return {
          ticker: input.ticker,
          latestSnapshot,
          recentActions,
        };
      },
    },
    {
      name: "scoreTickerResearch",
      description:
        "Returns a deterministic transparent component scorecard for a ticker using local persisted research data.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        ticker: tickerSchema,
      }),
      notes: [
        "Deterministic aid only; not investment advice.",
        "Uses local persisted data only and does not call external LLMs.",
      ],
      execute: async (input: { ticker: string }) => {
        try {
          return await researchScoringService.scoreTickerResearch(input.ticker);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            throw new AgentToolExecutionError(404, "NOT_FOUND", error.message);
          }

          throw error;
        }
      },
    },
    {
      name: "scoreWatchlist",
      description:
        "Scores watchlist items deterministically and returns a ranked list with component breakdowns.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
      }),
      notes: [
        "Deterministic aid only; not investment advice.",
        "Uses scoreTickerResearch logic for each watchlist ticker.",
      ],
      execute: async (input: { watchlistId: string }) => {
        try {
          return await researchScoringService.scoreWatchlist(input.watchlistId);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            throw new AgentToolExecutionError(404, "NOT_FOUND", error.message);
          }

          throw error;
        }
      },
    },
    {
      name: "getTickerDataQuality",
      description:
        "Returns data-coverage and staleness quality diagnostics for a ticker and suggested refresh actions.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        ticker: tickerSchema,
      }),
      notes: [
        "Read-only diagnostics from persisted ticker research snapshots.",
        "Includes missing-data flags, stale-data warnings, and refresh suggestions.",
      ],
      execute: async (input: { ticker: string }) => {
        try {
          return await researchScoringService.getTickerDataQuality(input.ticker);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            throw new AgentToolExecutionError(404, "NOT_FOUND", error.message);
          }

          throw error;
        }
      },
    },
    {
      name: "getWatchlistDataQuality",
      description:
        "Returns coverage/quality diagnostics across watchlist items, including complete/partial/empty counts and suggested refresh actions.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
      }),
      notes: [
        "Read-only diagnostics from persisted watchlist research bundles.",
        "Helps identify stale or incomplete watchlist entries before ranking.",
      ],
      execute: async (input: { watchlistId: string }) => {
        try {
          return await researchScoringService.getWatchlistDataQuality(input.watchlistId);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            throw new AgentToolExecutionError(404, "NOT_FOUND", error.message);
          }

          throw error;
        }
      },
    },
    {
      name: "getPortfolioDataQuality",
      description:
        "Returns portfolio data-quality diagnostics for FX/currency/price coverage and suggests refresh actions.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1),
      }),
      notes: [
        "Read-only diagnostics from local holdings, pricing, and FX context.",
        "Complements getPortfolioRiskSnapshot with explicit data-quality signals.",
      ],
      execute: async (input: { portfolioId: string }) => {
        try {
          return await researchScoringService.getPortfolioDataQuality(input.portfolioId);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            throw new AgentToolExecutionError(404, "NOT_FOUND", error.message);
          }

          throw error;
        }
      },
    },
    {
      name: "compareTickers",
      description:
        "Returns side-by-side deterministic scorecards and key differences for multiple tickers.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        tickers: z.array(tickerSchema).min(1).max(25),
      }),
      notes: [
        "Deterministic aid only; not investment advice.",
        "Highlights component-level differences across requested tickers.",
      ],
      execute: async (input: { tickers: string[] }) =>
        researchScoringService.compareTickers(input.tickers),
    },
    {
      name: "getPortfolioRiskSnapshot",
      description:
        "Returns deterministic portfolio concentration/currency/sector risk snapshot from local portfolio overview data.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1),
      }),
      notes: [
        "Deterministic aid only; not investment advice.",
        "Uses local holdings overview with no provider calls.",
      ],
      execute: async (input: { portfolioId: string }) => {
        try {
          return await researchScoringService.getPortfolioRiskSnapshot(input.portfolioId);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            throw new AgentToolExecutionError(404, "NOT_FOUND", error.message);
          }

          throw error;
        }
      },
    },
    {
      name: "runPortfolioFullRefresh",
      description:
        "Runs a bounded portfolio full-refresh flow (market/fundamentals/earnings/news and optional macro/analyst/geopolitical).",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1),
        refreshMode: z.enum(["quick", "full"]).optional().default("quick"),
        includeEconomics: z.boolean().optional().default(true),
        includeBankOfCanada: z.boolean().optional().default(true),
        includeFred: z.boolean().optional().default(true),
        includeAnalystData: z.boolean().optional().default(true),
        includeGdelt: z.boolean().optional().default(false),
        runAnalysis: z.boolean().optional().default(true),
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run validates input and returns planned options without writes/provider calls.",
      ],
      execute: async (input: {
        portfolioId: string;
        refreshMode?: "quick" | "full";
        includeEconomics?: boolean;
        includeBankOfCanada?: boolean;
        includeFred?: boolean;
        includeAnalystData?: boolean;
        includeGdelt?: boolean;
        runAnalysis?: boolean;
      }) =>
        realDataIngestionService.ingestPortfolioFmpFullRefresh(input.portfolioId, {
          refreshMode: input.refreshMode ?? "quick",
          includeEconomics: input.includeEconomics ?? true,
          includeBankOfCanada: input.includeBankOfCanada ?? true,
          includeFred: input.includeFred ?? true,
          includeAnalystData: input.includeAnalystData ?? true,
          includeGdelt: input.includeGdelt ?? false,
          runAnalysis: input.runAnalysis ?? true,
        }),
    },
    {
      name: "refreshTickerAnalystData",
      description: "Refreshes persisted analyst context for a single ticker using existing analyst ingestion flow.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        ticker: tickerSchema,
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run validates input and returns planned action only.",
      ],
      execute: async (input: { ticker: string }) => analystService.ingestTickerAnalystData(input.ticker),
    },
    {
      name: "refreshUsdCadFxRate",
      description:
        "Refreshes persisted USD/CAD FX snapshots from the configured Bank of Canada USD/CAD series.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({}),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run validates input and returns planned action only.",
        "Targets macro/FX ingestion and must not be used as a stock-ticker refresh.",
      ],
      execute: async () => macroIngestionService.ingestBankOfCanadaUsdCad(),
    },
    {
      name: "refreshWatchlistAnalystData",
      description: "Refreshes persisted analyst context for all tickers in a watchlist.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run validates input and returns planned action only.",
      ],
      execute: async (input: { watchlistId: string }) =>
        analystService.ingestWatchlistAnalystData(input.watchlistId),
    },
    {
      name: "refreshWatchlistResearchData",
      description:
        "Refreshes watchlist ticker research data (market, fundamentals, earnings, news, analyst, optional reports).",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
        historicalLimit: optionalLimitSchema,
        newsLimitPerTicker: optionalLimitSchema,
        includeMarketData: z.boolean().optional(),
        includeFundamentals: z.boolean().optional(),
        includeEarnings: z.boolean().optional(),
        includeNews: z.boolean().optional(),
        includeAnalystData: z.boolean().optional(),
        runReports: z.boolean().optional(),
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run returns planned tickers and selected options without provider calls or writes.",
      ],
      execute: async (input: {
        watchlistId: string;
        historicalLimit?: number;
        newsLimitPerTicker?: number;
        includeMarketData?: boolean;
        includeFundamentals?: boolean;
        includeEarnings?: boolean;
        includeNews?: boolean;
        includeAnalystData?: boolean;
        runReports?: boolean;
      }) =>
        watchlistsService.refreshWatchlistResearchData(input.watchlistId, {
          historicalLimit: input.historicalLimit,
          newsLimitPerTicker: input.newsLimitPerTicker,
          includeMarketData: input.includeMarketData,
          includeFundamentals: input.includeFundamentals,
          includeEarnings: input.includeEarnings,
          includeNews: input.includeNews,
          includeAnalystData: input.includeAnalystData,
          runReports: input.runReports,
        }),
      dryRunPlan: async (input: {
        watchlistId: string;
        historicalLimit?: number;
        newsLimitPerTicker?: number;
        includeMarketData?: boolean;
        includeFundamentals?: boolean;
        includeEarnings?: boolean;
        includeNews?: boolean;
        includeAnalystData?: boolean;
        runReports?: boolean;
      }) => {
        const plan = await watchlistsService.refreshWatchlistResearchData(input.watchlistId, {
          historicalLimit: input.historicalLimit,
          newsLimitPerTicker: input.newsLimitPerTicker,
          includeMarketData: input.includeMarketData,
          includeFundamentals: input.includeFundamentals,
          includeEarnings: input.includeEarnings,
          includeNews: input.includeNews,
          includeAnalystData: input.includeAnalystData,
          runReports: input.runReports,
          dryRun: true,
        });

        return {
          plannedAction: true,
          toolName: "refreshWatchlistResearchData",
          input,
          message: "Dry-run planned watchlist research refresh. No provider call or data write was performed.",
          watchlistId: input.watchlistId,
          plannedTickers: plan.plannedTickers ?? [],
          tickersProcessed: plan.tickersProcessed,
          tickersSkipped: plan.tickersSkipped,
          perTickerResults: plan.perTickerResults,
        };
      },
    },
    {
      name: "refreshDiscoveryCategory",
      description: "Refreshes a discovery category snapshot using the existing discovery ingestion service.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        category: discoveryCategorySchema,
        limit: optionalLimitSchema,
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run validates input and returns planned action only.",
      ],
      execute: async (input: { category: string; limit?: number }) =>
        discoveryService.ingestMarketDiscovery(input.category, {
          limit: input.limit,
        }),
    },
    {
      name: "refreshGdeltRiskContext",
      description:
        "Refreshes persisted geopolitical risk context from the default GDELT risk query set.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        mode: z.enum(["quick", "full"]).optional().default("quick"),
        maxRecordsPerQuery: optionalLimitSchema,
        lookbackDays: z.coerce.number().int().positive().max(3650).optional().default(7),
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Dry-run validates input and returns planned action only.",
        "Warnings and failedQueries from ingestion are preserved in output.",
      ],
      execute: async (input: {
        mode?: "quick" | "full";
        maxRecordsPerQuery?: number;
        lookbackDays?: number;
      }) => {
        const lookbackDays = input.lookbackDays ?? 7;
        return geopoliticalService.ingestDefaultGdeltRiskSet({
          mode: input.mode ?? "quick",
          maxRecordsPerQuery: input.maxRecordsPerQuery,
          from: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000),
          to: new Date(),
        });
      },
    },
    {
      name: "addTickerToWatchlist",
      description:
        "Adds (or upserts) a ticker in a watchlist with optional thesis/target metadata.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.MUTATION,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
        ticker: tickerSchema,
        status: watchlistStatusSchema,
        priority: watchlistPrioritySchema,
        thesis: z.string().trim().min(1).max(4000).optional(),
        riskNotes: z.string().trim().min(1).max(4000).optional(),
        targetEntryPrice: z.coerce.number().positive().optional(),
        targetExitPrice: z.coerce.number().positive().optional(),
        targetAllocation: z.coerce.number().nonnegative().optional(),
        tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
        source: watchlistSourceSchema,
      }),
      notes: [
        "Mutation tool: confirmation required.",
        "Dry-run validates input and returns planned write without DB mutation.",
      ],
      execute: async (
        input: {
          watchlistId: string;
          ticker: string;
          status?: WatchlistItemStatus;
          priority?: WatchlistItemPriority;
          thesis?: string;
          riskNotes?: string;
          targetEntryPrice?: number;
          targetExitPrice?: number;
          targetAllocation?: number;
          tags?: string[];
          source?: WatchlistItemSource;
        },
        context,
      ) =>
        watchlistsService.addTickerToWatchlist(input.watchlistId, input.ticker, {
          status: input.status ?? WatchlistItemStatus.WATCHING,
          priority: input.priority ?? WatchlistItemPriority.MEDIUM,
          thesis: input.thesis,
          riskNotes: input.riskNotes,
          targetEntryPrice: input.targetEntryPrice,
          targetExitPrice: input.targetExitPrice,
          targetAllocation: input.targetAllocation,
          tags: input.tags,
          source: resolveDefaultWatchlistSource(context, input.source),
        }),
    },
    {
      name: "updateWatchlistItem",
      description: "Updates watchlist item status/priority/thesis/target metadata.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.MUTATION,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z
        .object({
          itemId: z.string().trim().min(1),
          status: watchlistStatusSchema,
          priority: watchlistPrioritySchema,
          thesis: z.string().trim().max(4000).optional(),
          riskNotes: z.string().trim().max(4000).optional(),
          targetEntryPrice: z.coerce.number().positive().optional(),
          targetExitPrice: z.coerce.number().positive().optional(),
          targetAllocation: z.coerce.number().nonnegative().optional(),
          tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
          rejectionReason: z.string().trim().max(4000).optional(),
        })
        .refine(
          (value) =>
            value.status != null ||
            value.priority != null ||
            value.thesis != null ||
            value.riskNotes != null ||
            value.targetEntryPrice != null ||
            value.targetExitPrice != null ||
            value.targetAllocation != null ||
            value.tags != null ||
            value.rejectionReason != null,
          "At least one updatable field is required.",
        ),
      notes: [
        "Mutation tool: confirmation required.",
        "Dry-run validates input and returns planned write without DB mutation.",
      ],
      execute: async (input: {
        itemId: string;
        status?: WatchlistItemStatus;
        priority?: WatchlistItemPriority;
        thesis?: string;
        riskNotes?: string;
        targetEntryPrice?: number;
        targetExitPrice?: number;
        targetAllocation?: number;
        tags?: string[];
        rejectionReason?: string;
      }) =>
        watchlistsService.updateWatchlistItemDetails(input.itemId, {
          status: input.status,
          priority: input.priority,
          thesis: input.thesis,
          riskNotes: input.riskNotes,
          targetEntryPrice: input.targetEntryPrice,
          targetExitPrice: input.targetExitPrice,
          targetAllocation: input.targetAllocation,
          tags: input.tags,
          rejectionReason: input.rejectionReason,
        }),
    },
    {
      name: "removeWatchlistItem",
      description: "Removes a watchlist item by item id.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.MUTATION,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        itemId: z.string().trim().min(1),
      }),
      notes: [
        "Mutation tool: confirmation required.",
        "Dry-run validates input and returns planned delete without DB mutation.",
      ],
      execute: async (input: { itemId: string }) => watchlistsService.removeWatchlistItem(input.itemId),
    },
    {
      name: "rebalancePaperPortfolio",
      description:
        "Reserved high-impact placeholder for future paper-portfolio rebalancing automation.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT,
      executionMode: AGENT_TOOL_EXECUTION_MODE.DISABLED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1),
      }),
      notes: [
        "High-impact tool placeholder.",
        "Disabled by policy in this phase.",
      ],
      execute: async () => ({ disabled: true }),
    },
  ];
}

export function createAgentToolRegistry(): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  registry.registerTools(buildReadOnlyTools());
  return registry;
}
