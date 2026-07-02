import { z } from "zod";
import {
  WatchlistItemPriority,
  Sentiment,
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
import * as aiReportsService from "../services/ai-reports.service";
import { normalizeTickerOrThrow } from "../types/common";

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
const investmentObjectiveSchema = z.enum([
  "GROWTH",
  "VALUE",
  "DIVIDEND",
  "QUALITY",
  "LOW_VOLATILITY",
  "MOMENTUM",
  "DIVERSIFICATION",
]);
const investmentTimeHorizonSchema = z.enum(["SHORT", "MEDIUM", "LONG"]);
const investmentRiskToleranceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const agentInvestmentPreferencesSchema = z
  .object({
    objective: investmentObjectiveSchema.optional(),
    timeHorizon: investmentTimeHorizonSchema.optional(),
    riskTolerance: investmentRiskToleranceSchema.optional(),
    preferredSectors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    excludedSectors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    preferredCurrencies: z.array(z.string().trim().min(1).max(10)).max(10).optional(),
    maxSinglePositionWeight: z.coerce.number().nonnegative().max(100).optional(),
    wantsIncome: z.boolean().optional(),
    wantsCanada: z.boolean().optional(),
    wantsUS: z.boolean().optional(),
  })
  .optional();
const SHORT_AMBIGUOUS_TICKERS = new Set(["E", "T", "F", "B"]);

type TickerRefreshSectionResult =
  | {
    attempted: false;
    success: true;
    warnings: string[];
  }
  | {
    attempted: true;
    success: true;
    warnings: string[];
    summary: Record<string, unknown>;
  }
  | {
    attempted: true;
    success: false;
    warnings: string[];
    error: string;
  };

function resolveDefaultWatchlistSource(
  context: AgentToolContext,
  explicitSource?: WatchlistItemSource,
): WatchlistItemSource {
  if (explicitSource) {
    return explicitSource;
  }

  return context.source === "AGENT" ? WatchlistItemSource.AGENT : WatchlistItemSource.USER;
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return "Unexpected error.";
}

function calculateDurationMs(startedAtDate: Date, finishedAtDate: Date): number {
  return Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
}

function toRefreshSectionResult<T extends { warnings?: string[] }>(result: T): TickerRefreshSectionResult {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const summary: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (key === "warnings" || key === "ticker") {
      continue;
    }

    summary[key] = value;
  }

  return {
    attempted: true,
    success: true,
    warnings,
    summary,
  };
}

function toEmptyRefreshSectionResult(): TickerRefreshSectionResult {
  return {
    attempted: false,
    success: true,
    warnings: [],
  };
}

function toFailedRefreshSectionResult(error: unknown): TickerRefreshSectionResult {
  const reason = toErrorReason(error);

  return {
    attempted: true,
    success: false,
    warnings: [reason],
    error: reason,
  };
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
      name: "resolveTickerOrCompany",
      description:
        "Resolves user ticker/company mentions into ticker candidates using local stock identity first and provider search when available.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        portfolioId: z.string().trim().min(1).optional(),
        watchlistId: z.string().trim().min(1).optional(),
        preferredCountry: z.string().trim().min(1).max(20).optional(),
        preferredExchange: z.string().trim().min(1).max(20).optional(),
      }),
      notes: [
        "Searches local stock records first, then provider-backed symbol search when configured.",
        "Does not auto-pick low-confidence ambiguous symbols.",
        "Does not create stock records during resolution.",
      ],
      execute: async (input: {
        query: string;
        portfolioId?: string;
        watchlistId?: string;
        preferredCountry?: string;
        preferredExchange?: string;
      }) => {
        const query = input.query.trim();

        let explicitTicker: string | undefined;
        try {
          explicitTicker = normalizeTickerOrThrow(query);
        } catch {
          explicitTicker = undefined;
        }

        const [candidates, portfolioOverview, watchlistDetail] = await Promise.all([
          stocksService.searchStockCandidates(query, {
            country: input.preferredCountry,
            exchange: input.preferredExchange,
            limit: 10,
          }),
          input.portfolioId
            ? portfoliosService.getPortfolioOverview(input.portfolioId).catch(() => null)
            : Promise.resolve(null),
          input.watchlistId
            ? watchlistsService.getWatchlistDetail(input.watchlistId).catch(() => null)
            : Promise.resolve(null),
        ]);

        const heldTickers = new Set(
          (portfolioOverview?.holdings ?? [])
            .map((holding) => holding.ticker?.trim().toUpperCase())
            .filter((ticker): ticker is string => Boolean(ticker)),
        );
        const watchlistTickers = new Set(
          (watchlistDetail?.items ?? [])
            .map((item) => item.stock.ticker?.trim().toUpperCase())
            .filter((ticker): ticker is string => Boolean(ticker)),
        );

        const normalizedCandidates = candidates.map((candidate) => {
          const ticker = candidate.ticker.trim().toUpperCase();
          return {
            ticker,
            companyName: candidate.companyName,
            exchange: candidate.exchange,
            currency: candidate.currency,
            country: candidate.country,
            stockId: candidate.stockId,
            confidence: candidate.confidence,
            alreadyHeld: heldTickers.has(ticker),
            alreadyInWatchlist: watchlistTickers.has(ticker),
          };
        });

        const isShortAmbiguousQuery =
          explicitTicker != null &&
          (explicitTicker.length <= 1 || SHORT_AMBIGUOUS_TICKERS.has(explicitTicker));

        const highConfidenceCandidates = normalizedCandidates.filter(
          (candidate) => candidate.confidence === "HIGH",
        );
        const plausibleCandidates = normalizedCandidates.filter(
          (candidate) => candidate.confidence !== "LOW",
        );

        let isAmbiguous = false;
        let ambiguityReason: string | undefined;

        if (isShortAmbiguousQuery) {
          isAmbiguous = true;
          ambiguityReason =
            `Symbol '${explicitTicker}' is commonly ambiguous across exchanges. Please choose the intended listing.`;
        } else if (plausibleCandidates.length > 1) {
          isAmbiguous = true;
          ambiguityReason =
            "Multiple plausible ticker/company matches were found. Please pick one candidate.";
        }

        let resolvedTicker: string | undefined;
        if (!isAmbiguous) {
          if (highConfidenceCandidates.length === 1) {
            resolvedTicker = highConfidenceCandidates[0].ticker;
          } else if (plausibleCandidates.length === 1) {
            resolvedTicker = plausibleCandidates[0].ticker;
          }
        }

        const confidence = resolvedTicker
          ? (normalizedCandidates.find((candidate) => candidate.ticker === resolvedTicker)?.confidence ?? "HIGH")
          : isAmbiguous
            ? "LOW"
            : normalizedCandidates[0]?.confidence ?? "LOW";

        return {
          query,
          normalizedQuery: explicitTicker ?? query.toUpperCase(),
          explicitTicker,
          resolvedTicker,
          confidence,
          isAmbiguous,
          ambiguityReason,
          candidates: normalizedCandidates,
        };
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
        portfolioId: z.string().trim().min(1).optional(),
        watchlistId: z.string().trim().min(1).optional(),
      }),
      notes: [
        "Does not call external providers directly.",
        "Data freshness depends on prior ingestion runs.",
      ],
      execute: async (input: {
        ticker: string;
        portfolioId?: string;
        watchlistId?: string;
      }) => {
        const [result, dataQuality, deterministicScore, portfolioOverview, watchlistDetail] = await Promise.all([
          stocksService.getStockResearchBundle(input.ticker),
          researchScoringService.getTickerDataQuality(input.ticker).catch(() => null),
          researchScoringService.scoreTickerResearch(input.ticker).catch(() => null),
          input.portfolioId
            ? portfoliosService.getPortfolioOverview(input.portfolioId).catch(() => null)
            : Promise.resolve(null),
          input.watchlistId
            ? watchlistsService.getWatchlistDetail(input.watchlistId).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (!result) {
          throw new AgentToolExecutionError(404, "NOT_FOUND", "Ticker research bundle not found.");
        }

        const ticker = result.stock.ticker.toUpperCase();
        const heldTickers = new Set(
          (portfolioOverview?.holdings ?? [])
            .map((holding) => holding.ticker?.trim().toUpperCase())
            .filter((value): value is string => Boolean(value)),
        );
        const watchlistTickers = new Set(
          (watchlistDetail?.items ?? [])
            .map((item) => item.stock.ticker?.trim().toUpperCase())
            .filter((value): value is string => Boolean(value)),
        );

        const newsArticles = result.recentNews.slice(0, 10);
        const sentimentTotals = newsArticles.reduce(
          (accumulator, article) => {
            if (article.sentiment === Sentiment.BULLISH) {
              accumulator.bullish += 1;
            } else if (article.sentiment === Sentiment.BEARISH) {
              accumulator.bearish += 1;
            } else if (article.sentiment === Sentiment.MIXED) {
              accumulator.mixed += 1;
            } else {
              accumulator.neutral += 1;
            }

            return accumulator;
          },
          {
            bullish: 0,
            bearish: 0,
            neutral: 0,
            mixed: 0,
          },
        );

        return {
          ...result,
          ticker,
          portfolioId: input.portfolioId,
          watchlistId: input.watchlistId,
          company: {
            ticker,
            stockId: result.stock.id,
            companyName: result.stock.companyName,
            exchange: result.stock.exchange,
            currency: result.stock.currency,
            country: result.stock.country,
            sector: result.stock.sector,
            industry: result.stock.industry,
            assetType: result.stock.assetType,
          },
          latestPrice: result.latestPriceSnapshot,
          technicalSnapshot: result.latestTechnicalSnapshot,
          fundamentalSnapshot: result.latestFundamentalSnapshot,
          analystSnapshot: result.latestAnalystSnapshot,
          analystActions: result.recentAnalystActions,
          analystEstimates: {
            latestAnnual: result.latestAnnualAnalystEstimate ?? null,
            latestQuarter: result.latestQuarterAnalystEstimate ?? null,
          },
          topHeadlines: newsArticles,
          newsSentiment: {
            totalArticles: newsArticles.length,
            ...sentimentTotals,
          },
          earningsEvent: result.nextEarningsEvent,
          latestReport: result.latestAIReport,
          deterministicScore,
          dataQuality,
          missingData: dataQuality?.missingData ?? [],
          staleDataWarnings: dataQuality?.staleDataWarnings ?? [],
          alreadyHeld: heldTickers.has(ticker),
          alreadyInWatchlist: watchlistTickers.has(ticker),
        };
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
      name: "rankDiscoveryCandidates",
      description:
        "Ranks persisted discovery candidates for potential new holdings using deterministic local scoring and portfolio/watchlist context.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        category: discoveryCategorySchema.optional(),
        portfolioId: z.string().trim().min(1).optional(),
        watchlistId: z.string().trim().min(1).optional(),
        limit: z.coerce.number().int().positive().max(25).optional(),
        excludeExistingHoldings: z.boolean().optional(),
        excludeExistingWatchlistItems: z.boolean().optional(),
      }),
      notes: [
        "Uses persisted discovery snapshots and deterministic scoreTickerResearch output only.",
        "Designed for new-holding candidate discovery; no provider calls or LLM scoring.",
      ],
      execute: async (input: {
        category?: string;
        portfolioId?: string;
        watchlistId?: string;
        limit?: number;
        excludeExistingHoldings?: boolean;
        excludeExistingWatchlistItems?: boolean;
      }) =>
        discoveryService.rankDiscoveryCandidates({
          category: input.category,
          portfolioId: input.portfolioId,
          watchlistId: input.watchlistId,
          limit: input.limit,
          excludeExistingHoldings: input.excludeExistingHoldings,
          excludeExistingWatchlistItems: input.excludeExistingWatchlistItems,
        }),
    },
    {
      name: "screenMarketCandidates",
      description:
        "Screens persisted market candidates using objective/risk preferences and optional portfolio/watchlist context.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1).optional(),
        watchlistId: z.string().trim().min(1).optional(),
        preferences: agentInvestmentPreferencesSchema,
        limit: z.coerce.number().int().positive().max(25).optional(),
        excludeExistingHoldings: z.boolean().optional(),
        excludeExistingWatchlistItems: z.boolean().optional(),
      }),
      notes: [
        "Uses persisted backend data and deterministic scoring only.",
        "Does not call external providers or use LLM scoring.",
      ],
      execute: async (input: {
        portfolioId?: string;
        watchlistId?: string;
        preferences?: {
          objective?: "GROWTH" | "VALUE" | "DIVIDEND" | "QUALITY" | "LOW_VOLATILITY" | "MOMENTUM" | "DIVERSIFICATION";
          timeHorizon?: "SHORT" | "MEDIUM" | "LONG";
          riskTolerance?: "LOW" | "MEDIUM" | "HIGH";
          preferredSectors?: string[];
          excludedSectors?: string[];
          preferredCurrencies?: string[];
          maxSinglePositionWeight?: number;
          wantsIncome?: boolean;
          wantsCanada?: boolean;
          wantsUS?: boolean;
        };
        limit?: number;
        excludeExistingHoldings?: boolean;
        excludeExistingWatchlistItems?: boolean;
      }) =>
        discoveryService.screenMarketCandidates({
          portfolioId: input.portfolioId,
          watchlistId: input.watchlistId,
          preferences: input.preferences,
          limit: input.limit,
          excludeExistingHoldings: input.excludeExistingHoldings,
          excludeExistingWatchlistItems: input.excludeExistingWatchlistItems,
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
      name: "rankWatchlist",
      description:
        "Ranks watchlist items deterministically and returns a score-based ordering with component breakdowns.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        watchlistId: z.string().trim().min(1),
      }),
      notes: [
        "Canonical alias for scoreWatchlist.",
        "Deterministic aid only; not investment advice.",
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
      name: "rankPortfolioHoldings",
      description:
        "Ranks portfolio holdings deterministically using persisted backend scoring metrics and returns top candidates.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.READ_ONLY,
      executionMode: AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
      inputSchema: z.object({
        portfolioId: z.string().trim().min(1),
        limit: z.coerce.number().int().positive().max(25).optional().default(3),
        includeWatchlist: z.boolean().optional().default(false),
      }),
      notes: [
        "Deterministic aid only; not investment advice.",
        "Uses persisted backend scoring data and does not call external LLMs.",
      ],
      execute: async (input: {
        portfolioId: string;
        limit?: number;
        includeWatchlist?: boolean;
      }) => {
        try {
          return await researchScoringService.rankPortfolioHoldings(input.portfolioId, {
            limit: input.limit,
            includeWatchlist: input.includeWatchlist,
          });
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
      name: "refreshTickerResearchData",
      description:
        "Refreshes persisted ticker research sections (market, fundamentals, news, earnings, analyst) with optional report generation.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.REFRESH,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        ticker: tickerSchema,
        includeMarketData: z.boolean().optional().default(true),
        includeHistorical: z.boolean().optional().default(true),
        includeFundamentals: z.boolean().optional().default(true),
        includeNews: z.boolean().optional().default(true),
        includeEarnings: z.boolean().optional().default(true),
        includeAnalyst: z.boolean().optional().default(true),
        generateReport: z.boolean().optional().default(false),
      }),
      notes: [
        "Refresh tool: confirmation required.",
        "Per-section failures are captured as warnings and do not abort the entire refresh.",
        "Dry-run returns planned sections only and performs no provider calls.",
      ],
      execute: async (input: {
        ticker: string;
        includeMarketData?: boolean;
        includeHistorical?: boolean;
        includeFundamentals?: boolean;
        includeNews?: boolean;
        includeEarnings?: boolean;
        includeAnalyst?: boolean;
        generateReport?: boolean;
      }) => {
        const startedAtDate = new Date();
        const warnings: string[] = [];
        const ticker = input.ticker.toUpperCase();

        const sections: Record<
          "marketData" | "fundamentals" | "news" | "earnings" | "analyst" | "report",
          TickerRefreshSectionResult
        > = {
          marketData: toEmptyRefreshSectionResult(),
          fundamentals: toEmptyRefreshSectionResult(),
          news: toEmptyRefreshSectionResult(),
          earnings: toEmptyRefreshSectionResult(),
          analyst: toEmptyRefreshSectionResult(),
          report: toEmptyRefreshSectionResult(),
        };

        if (input.includeMarketData ?? true) {
          try {
            const marketData = await realDataIngestionService.ingestTickerMarketData(ticker, {
              historicalLimit: (input.includeHistorical ?? true) ? 250 : 1,
            });
            sections.marketData = toRefreshSectionResult(marketData);
          } catch (error) {
            sections.marketData = toFailedRefreshSectionResult(error);
            warnings.push(`marketData: ${toErrorReason(error)}`);
          }
        }

        if (input.includeFundamentals ?? true) {
          try {
            const fundamentals = await realDataIngestionService.ingestTickerFundamentals(ticker);
            sections.fundamentals = toRefreshSectionResult(fundamentals);
          } catch (error) {
            sections.fundamentals = toFailedRefreshSectionResult(error);
            warnings.push(`fundamentals: ${toErrorReason(error)}`);
          }
        }

        if (input.includeNews ?? true) {
          try {
            const news = await realDataIngestionService.ingestTickerNews(ticker, { limit: 30 });
            sections.news = toRefreshSectionResult(news);
          } catch (error) {
            sections.news = toFailedRefreshSectionResult(error);
            warnings.push(`news: ${toErrorReason(error)}`);
          }
        }

        if (input.includeEarnings ?? true) {
          try {
            const earnings = await realDataIngestionService.ingestTickerEarnings(ticker);
            sections.earnings = toRefreshSectionResult(earnings);
          } catch (error) {
            sections.earnings = toFailedRefreshSectionResult(error);
            warnings.push(`earnings: ${toErrorReason(error)}`);
          }
        }

        if (input.includeAnalyst ?? true) {
          try {
            const analyst = await analystService.ingestTickerAnalystData(ticker);
            sections.analyst = toRefreshSectionResult(analyst);
          } catch (error) {
            sections.analyst = toFailedRefreshSectionResult(error);
            warnings.push(`analyst: ${toErrorReason(error)}`);
          }
        }

        if (input.generateReport ?? false) {
          try {
            const report = await aiReportsService.generateTickerReport(ticker, {
              useOpenAi: true,
            });
            sections.report = toRefreshSectionResult(report);
          } catch (error) {
            sections.report = toFailedRefreshSectionResult(error);
            warnings.push(`report: ${toErrorReason(error)}`);
          }
        }

        const finishedAtDate = new Date();

        return {
          ticker,
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          sections,
          warnings,
        };
      },
      dryRunPlan: async (input: {
        ticker: string;
        includeMarketData?: boolean;
        includeHistorical?: boolean;
        includeFundamentals?: boolean;
        includeNews?: boolean;
        includeEarnings?: boolean;
        includeAnalyst?: boolean;
        generateReport?: boolean;
      }) => ({
        plannedAction: true,
        toolName: "refreshTickerResearchData",
        ticker: input.ticker.toUpperCase(),
        plannedSections: {
          marketData: input.includeMarketData ?? true,
          historical: input.includeHistorical ?? true,
          fundamentals: input.includeFundamentals ?? true,
          news: input.includeNews ?? true,
          earnings: input.includeEarnings ?? true,
          analyst: input.includeAnalyst ?? true,
          report: input.generateReport ?? false,
        },
        message:
          "Dry-run planned ticker research refresh. No provider call or data write was performed.",
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
      dryRunPlan: async (input: {
        mode?: "quick" | "full";
        maxRecordsPerQuery?: number;
        lookbackDays?: number;
      }) => {
        const lookbackDays = input.lookbackDays ?? 7;
        const plannedProfiles = geopoliticalService.buildGdeltQueryProfiles({
          lookbackDays,
          maxRecordsPerQuery: input.maxRecordsPerQuery,
          includePortfolioRisk: true,
          includeMacroRisk: input.mode === "quick" || input.mode === "full" || input.mode == null,
        });

        return {
          plannedAction: true,
          toolName: "refreshGdeltRiskContext",
          mode: input.mode ?? "quick",
          lookbackDays,
          queryProfiles: plannedProfiles,
          message:
            "Dry-run planned GDELT risk refresh query profiles. No provider call or data write was performed.",
        };
      },
    },
    {
      name: "generateTickerReport",
      description:
        "Generates and persists a ticker report from backend research context with optional OpenAI structured mode and deterministic fallback.",
      riskLevel: AGENT_TOOL_RISK_LEVEL.MUTATION,
      executionMode: AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED,
      inputSchema: z.object({
        ticker: tickerSchema,
        holdingId: z.string().trim().min(1).optional(),
        portfolioId: z.string().trim().min(1).optional(),
        watchlistId: z.string().trim().min(1).optional(),
        useOpenAi: z.boolean().optional(),
        refreshBeforeGenerate: z.boolean().optional(),
        includeMacro: z.boolean().optional(),
        includeGeopolitical: z.boolean().optional(),
        includeNews: z.boolean().optional(),
        includeAnalyst: z.boolean().optional(),
        includeScore: z.boolean().optional(),
        createPredictions: z.boolean().optional(),
      }),
      notes: [
        "Mutation tool: confirmation required.",
        "Dry-run returns the built report context and selected options without persisting report/predictions.",
        "When OpenAI is enabled in input, runtime may still fallback deterministically based on policy or failures.",
      ],
      execute: async (input: {
        ticker: string;
        holdingId?: string;
        portfolioId?: string;
        watchlistId?: string;
        useOpenAi?: boolean;
        refreshBeforeGenerate?: boolean;
        includeMacro?: boolean;
        includeGeopolitical?: boolean;
        includeNews?: boolean;
        includeAnalyst?: boolean;
        includeScore?: boolean;
        createPredictions?: boolean;
      }) =>
        aiReportsService.generateTickerReport(input.ticker, {
          holdingId: input.holdingId,
          portfolioId: input.portfolioId,
          watchlistId: input.watchlistId,
          useOpenAi: input.useOpenAi,
          refreshBeforeGenerate: input.refreshBeforeGenerate,
          includeMacro: input.includeMacro,
          includeGeopolitical: input.includeGeopolitical,
          includeNews: input.includeNews,
          includeAnalyst: input.includeAnalyst,
          includeScore: input.includeScore,
          createPredictions: input.createPredictions,
        }),
      dryRunPlan: async (input: {
        ticker: string;
        holdingId?: string;
        portfolioId?: string;
        watchlistId?: string;
        useOpenAi?: boolean;
        refreshBeforeGenerate?: boolean;
        includeMacro?: boolean;
        includeGeopolitical?: boolean;
        includeNews?: boolean;
        includeAnalyst?: boolean;
        includeScore?: boolean;
        createPredictions?: boolean;
      }) => {
        const context = await aiReportsService.buildTickerReportContext(input.ticker, {
          portfolioId: input.portfolioId,
          watchlistId: input.watchlistId,
          includeMacro: input.includeMacro,
          includeGeopolitical: input.includeGeopolitical,
          includeNews: input.includeNews,
          includeAnalyst: input.includeAnalyst,
          includeScore: input.includeScore,
        });

        return {
          plannedAction: true,
          toolName: "generateTickerReport",
          ticker: input.ticker,
          holdingId: input.holdingId ?? null,
          portfolioId: input.portfolioId ?? null,
          watchlistId: input.watchlistId ?? null,
          options: {
            useOpenAi: input.useOpenAi ?? true,
            refreshBeforeGenerate: input.refreshBeforeGenerate ?? false,
            includeMacro: input.includeMacro ?? true,
            includeGeopolitical: input.includeGeopolitical ?? true,
            includeNews: input.includeNews ?? true,
            includeAnalyst: input.includeAnalyst ?? true,
            includeScore: input.includeScore ?? true,
            createPredictions: input.createPredictions ?? true,
          },
          plannedSections: {
            marketSnapshot: true,
            technicalSnapshot: true,
            fundamentalSnapshot: true,
            analystContext: input.includeAnalyst ?? true,
            recentAnalystActions: input.includeAnalyst ?? true,
            analystEstimates: input.includeAnalyst ?? true,
            fmpFinancialRating: input.includeAnalyst ?? true,
            newsContext: input.includeNews ?? true,
            earningsContext: true,
            macroContext: input.includeMacro ?? true,
            geopoliticalContext: input.includeGeopolitical ?? true,
            deterministicScore: input.includeScore ?? true,
            portfolioContext: Boolean(input.portfolioId),
            watchlistContext: Boolean(input.watchlistId),
          },
          dataGaps: [
            ...context.dataQuality.missingData,
            ...context.dataQuality.staleDataWarnings,
          ].slice(0, 20),
          contextPreview: {
            ticker: context.ticker,
            asOf: context.asOf,
            dataQuality: context.dataQuality,
            hasMarketSnapshot: context.marketSnapshot != null,
            hasTechnicalSnapshot: context.technicalSnapshot != null,
            hasFundamentalSnapshot: context.fundamentalSnapshot != null,
            hasAnalystContext: context.analystContext != null,
            hasNewsContext: context.newsContext != null,
            hasEarningsContext: context.earningsContext != null,
            hasMacroContext: context.macroContext != null,
            hasGeopoliticalContext: context.geopoliticalContext != null,
          },
          message:
            "Dry-run planned report generation from current context. No report or prediction rows were written.",
        };
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
        addedReason: z.string().trim().min(1).max(4000).optional(),
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
          addedReason?: string;
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
          addedReason: input.addedReason,
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
