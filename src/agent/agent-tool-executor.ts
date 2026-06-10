import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_RISK_LEVEL,
  AgentToolExecutionError,
  type AgentToolResult,
  type ExecuteAgentToolRequest,
} from "./agent-tool.types";
import type { AgentToolRegistry } from "./agent-tool-registry";

const MAX_ERROR_LENGTH = 300;
const MAX_LIST_ITEMS = 5;

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*[^\s,;]+/gi, "api_key=[REDACTED]");
}

function firstLine(value: string): string {
  const [line] = value.split(/\r?\n/);
  return line ?? value;
}

function toErrorMessage(error: unknown): string {
  const fallback = "Tool execution failed.";
  let raw = fallback;

  if (error instanceof Error && error.message) {
    raw = error.message;
  } else if (typeof error === "string" && error.trim().length > 0) {
    raw = error;
  } else if (error != null) {
    raw = String(error);
  }

  const normalized = redactSecrets(firstLine(raw)).trim();
  return normalized.length > 0 ? normalized.slice(0, MAX_ERROR_LENGTH) : fallback;
}

function calculateDurationMs(startedAt: Date, finishedAt: Date): number {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toBoundedStringList(values: unknown[], maxItems = MAX_LIST_ITEMS): string[] {
  return values
    .map((value) => asString(value))
    .filter((value): value is string => value != null)
    .slice(0, maxItems);
}

function toTopTickersFromScores(items: unknown[], maxItems = 3): string[] {
  return items
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => value != null)
    .map((value) => {
      const ticker = asString(value.ticker) ?? "UNKNOWN";
      const score = asNumber(value.compositeScore);
      return score == null ? ticker : `${ticker} (${score.toFixed(1)})`;
    })
    .slice(0, maxItems);
}

function buildToolDataSummary(toolName: string, data: unknown): Record<string, unknown> {
  const payload = asRecord(data) ?? {};

  if (toolName === "getPortfolioOverview") {
    const portfolio = asRecord(payload.portfolio);
    return {
      portfolioId: asString(portfolio?.id) ?? asString(payload.portfolioId),
      totalMarketValueCad: asNumber(payload.totalMarketValueCad),
      holdingsCount: asArray(payload.holdings).length,
      missingFxOrCurrencyIssuesCount:
        asArray(payload.holdingsMissingFx).length +
        asArray(payload.holdingsUnsupportedCurrency).length,
    };
  }

  if (toolName === "getPortfolioRiskSnapshot") {
    const fxRate = asRecord(payload.fxRateUsed);
    return {
      concentrationRisksCount: asArray(payload.concentrationRisks).length,
      holdingsMissingFxCount: asArray(payload.holdingsMissingFx).length,
      holdingsUnsupportedCurrencyCount: asArray(payload.holdingsUnsupportedCurrency).length,
      topRisks: toBoundedStringList(asArray(payload.topRisks), 3),
      fxRateUsed: fxRate
        ? {
            pair: asString(fxRate.pair),
            rate: asNumber(fxRate.rate),
            source: asString(fxRate.source),
          }
        : null,
    };
  }

  if (toolName === "getTickerResearchBundle") {
    const stock = asRecord(payload.stock);
    const report = asRecord(payload.latestAIReport);
    const analyst = asRecord(payload.latestAnalystSnapshot);
    const fundamentals = asRecord(payload.latestFundamentalSnapshot);
    const missingCategories: string[] = [];

    if (!asRecord(payload.latestPriceSnapshot)) {
      missingCategories.push("price");
    }
    if (!asRecord(payload.latestTechnicalSnapshot)) {
      missingCategories.push("technical");
    }
    if (!asRecord(payload.latestFundamentalSnapshot)) {
      missingCategories.push("fundamentals");
    }
    if (!asRecord(payload.latestAnalystSnapshot) && asArray(payload.recentAnalystActions).length === 0) {
      missingCategories.push("analyst");
    }
    if (asArray(payload.recentNews).length === 0) {
      missingCategories.push("news");
    }
    if (!asRecord(payload.nextEarningsEvent)) {
      missingCategories.push("earnings");
    }

    return {
      ticker: asString(stock?.ticker),
      latestPrice: asNumber(asRecord(payload.latestPriceSnapshot)?.price),
      recommendation: asString(report?.recommendation),
      analystConsensus:
        asString(analyst?.ratingConsensus) ?? asString(fundamentals?.analystConsensus),
      missingDataCategories: missingCategories,
    };
  }

  if (toolName === "scoreTickerResearch") {
    return {
      ticker: asString(payload.ticker),
      compositeScore: asNumber(payload.compositeScore),
      suggestedStance: asString(payload.suggestedStance),
      topBullishFactors: toBoundedStringList(asArray(payload.bullishFactors), 3),
      topBearishFactors: toBoundedStringList(asArray(payload.bearishFactors), 3),
      missingDataCount: asArray(payload.missingData).length,
    };
  }

  if (toolName === "getWatchlistResearchBundle") {
    const items = asArray(payload.items)
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value != null);

    const useful = items
      .filter((item) => item.hasResearchData === true)
      .map((item) => asString(item.ticker))
      .filter((ticker): ticker is string => ticker != null)
      .slice(0, MAX_LIST_ITEMS);

    const missing = items
      .filter((item) => item.hasResearchData === false)
      .map((item) => asString(item.ticker))
      .filter((ticker): ticker is string => ticker != null)
      .slice(0, MAX_LIST_ITEMS);

    return {
      watchlistId: asString(asRecord(payload.watchlist)?.id),
      itemCount: asNumber(payload.itemCount) ?? items.length,
      tickersWithUsefulResearch: useful,
      tickersMissingData: missing,
    };
  }

  if (toolName === "scoreWatchlist") {
    const rankedItems = asArray(payload.rankedItems);
    return {
      totalItems: asNumber(payload.totalItems) ?? asNumber(payload.itemCount),
      scoredItemsCount:
        asNumber(payload.scoredItemsCount) ?? rankedItems.length,
      skippedItemsCount: asNumber(payload.skippedItemsCount),
      topRankedTickers: toTopTickersFromScores(rankedItems),
    };
  }

  if (toolName === "getTickerDataQuality") {
    return {
      ticker: asString(payload.ticker),
      missingDataCount: asArray(payload.missingData).length,
      staleDataWarningCount: asArray(payload.staleDataWarnings).length,
      suggestedRefreshActions: toBoundedStringList(asArray(payload.suggestedRefreshActions), 3),
    };
  }

  if (toolName === "getWatchlistDataQuality") {
    const perTickerQuality = asArray(payload.perTickerQuality);
    return {
      watchlistId: asString(payload.watchlistId),
      itemCount: asNumber(payload.itemCount),
      completeItemsCount: asNumber(payload.completeItemsCount),
      partialItemsCount: asNumber(payload.partialItemsCount),
      emptyItemsCount: asNumber(payload.emptyItemsCount),
      perTickerQualityCount: perTickerQuality.length,
      suggestedRefreshActions: toBoundedStringList(asArray(payload.suggestedRefreshActions), 3),
    };
  }

  if (toolName === "getPortfolioDataQuality") {
    return {
      portfolioId: asString(payload.portfolioId),
      holdingCount: asNumber(payload.holdingCount),
      missingFxIssuesCount: asArray(payload.missingFxIssues).length,
      missingCurrencyIssuesCount: asArray(payload.missingCurrencyIssues).length,
      missingPriceIssuesCount: asArray(payload.missingPriceIssues).length,
      staleDataWarningCount: asArray(payload.staleDataWarnings).length,
      suggestedRefreshActions: toBoundedStringList(asArray(payload.suggestedRefreshActions), 3),
    };
  }

  if (toolName === "compareTickers") {
    const scores = asArray(payload.scores)
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value != null);
    const highest = [...scores]
      .sort((left, right) => (asNumber(right.compositeScore) ?? -1) - (asNumber(left.compositeScore) ?? -1))[0];

    return {
      requestedTickers: toBoundedStringList(asArray(payload.requestedTickers), 10),
      comparedCount: scores.length,
      highestScoreTicker: asString(highest?.ticker),
      highestScore: asNumber(highest?.compositeScore),
      warnings: toBoundedStringList(asArray(payload.warnings), 3),
    };
  }

  if (toolName === "getDiscoveryCandidates") {
    const items = asArray(payload.items)
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value != null);
    return {
      category: asString(payload.category),
      candidateCount: items.length,
      topTickers: items
        .map((item) => asString(item.ticker))
        .filter((ticker): ticker is string => ticker != null)
        .slice(0, MAX_LIST_ITEMS),
    };
  }

  if (toolName === "getGeopoliticalSummary") {
    const sentiment = asRecord(payload.sentimentMix);
    return {
      totalEvents: asNumber(payload.totalEvents),
      sentimentMix: sentiment
        ? {
            positive: asNumber(sentiment.positive),
            neutral: asNumber(sentiment.neutral),
            negative: asNumber(sentiment.negative),
            unknown: asNumber(sentiment.unknown),
          }
        : null,
      topHeadlines: asArray(payload.topHeadlines)
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value != null)
        .map((value) => asString(value.title))
        .filter((title): title is string => title != null)
        .slice(0, 3),
      topRisks: asArray(payload.countsByTheme)
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value != null)
        .map((value) => asString(value.key))
        .filter((key): key is string => key != null)
        .slice(0, 3),
    };
  }

  if (toolName === "runPortfolioFullRefresh") {
    return {
      plannedOrExecuted: "executed",
      portfolioId: asString(payload.portfolioId),
      tickersProcessed: asNumber(payload.tickersProcessed),
      tickersFailed: asNumber(payload.tickersFailed),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "refreshTickerAnalystData") {
    return {
      plannedOrExecuted: "executed",
      ticker: asString(payload.ticker),
      snapshotsCreated: asNumber(payload.snapshotsCreated),
      snapshotsUpdated: asNumber(payload.snapshotsUpdated),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "refreshWatchlistAnalystData" || toolName === "refreshWatchlistResearchData") {
    return {
      plannedOrExecuted: "executed",
      watchlistId: asString(payload.watchlistId),
      tickersProcessed: asNumber(payload.tickersProcessed),
      tickersFailed: asNumber(payload.tickersFailed),
      tickersSkipped: asNumber(payload.tickersSkipped),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "refreshUsdCadFxRate") {
    return {
      plannedOrExecuted: "executed",
      recordsCreated: asNumber(payload.recordsCreated),
      recordsUpdated: asNumber(payload.recordsUpdated),
      recordsSkipped: asNumber(payload.recordsSkipped),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "refreshDiscoveryCategory") {
    return {
      plannedOrExecuted: "executed",
      category: asString(payload.category),
      recordsCreated: asNumber(payload.recordsCreated),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "refreshGdeltRiskContext") {
    return {
      plannedOrExecuted: "executed",
      queriesProcessed: asNumber(payload.queriesProcessed),
      queriesFailed: asNumber(payload.queriesFailed),
      eventsCreated: asNumber(payload.eventsCreated),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "addTickerToWatchlist") {
    return {
      plannedOrExecuted: "executed",
      itemId: asString(payload.id),
      watchlistId: asString(payload.watchlistId),
      ticker: asString(payload.ticker),
    };
  }

  if (toolName === "updateWatchlistItem" || toolName === "removeWatchlistItem") {
    return {
      plannedOrExecuted: "executed",
      itemId: asString(payload.id),
      watchlistId: asString(payload.watchlistId),
      ticker: asString(payload.ticker),
    };
  }

  return {
    toolName,
    hasData: data != null,
  };
}

function buildDryRunSummary(toolName: string, plannedData: unknown): Record<string, unknown> {
  const payload = asRecord(plannedData) ?? {};
  const plannedTickers = asArray(payload.plannedTickers);
  return {
    plannedOrExecuted: "planned",
    toolName,
    plannedAction: payload.plannedAction === true,
    watchlistId: asString(payload.watchlistId),
    plannedTickers: toBoundedStringList(plannedTickers),
    plannedTickersCount: plannedTickers.length,
    tickersProcessed: asNumber(payload.tickersProcessed),
    tickersSkipped: asNumber(payload.tickersSkipped),
    message: asString(payload.message),
  };
}

export class AgentToolExecutor {
  constructor(private readonly registry: AgentToolRegistry) {}

  async executeByName(request: ExecuteAgentToolRequest): Promise<AgentToolResult> {
    const tool = this.registry.getTool(request.toolName);
    if (!tool) {
      throw new AgentToolExecutionError(
        404,
        "AGENT_TOOL_NOT_FOUND",
        `Unknown agent tool '${request.toolName}'.`,
      );
    }

    if (tool.executionMode === AGENT_TOOL_EXECUTION_MODE.DISABLED) {
      throw new AgentToolExecutionError(
        403,
        "AGENT_TOOL_DISABLED",
        `Tool '${tool.name}' is currently disabled.`,
        {
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
        },
      );
    }

    if (
      tool.executionMode === AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED &&
      request.confirmed !== true
    ) {
      throw new AgentToolExecutionError(
        409,
        "AGENT_TOOL_CONFIRMATION_REQUIRED",
        "Tool requires confirmation.",
        {
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
        },
      );
    }

    const input = this.registry.validateToolInput(tool.name, request.input);

    const startedAtDate = new Date();
    const warnings: string[] = [];
    const errors: string[] = [];
    const dryRun = Boolean(request.context.dryRun);

    if (dryRun && tool.riskLevel !== AGENT_TOOL_RISK_LEVEL.READ_ONLY) {
      warnings.push("Dry-run mode: execution was not performed.");
      const plannedData = tool.dryRunPlan
        ? await tool.dryRunPlan(input, request.context)
        : {
            plannedAction: true,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            executionMode: tool.executionMode,
            input,
            message:
              tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION
                ? "Dry-run validated mutation input. No database write was performed."
                : "Dry-run validated refresh input. No provider call or data write was performed.",
          };
      const finishedAtDate = new Date();

      return {
        toolName: tool.name,
        success: true,
        data: plannedData,
        dataSummary: buildDryRunSummary(tool.name, plannedData),
        warnings,
        errors,
        metadata: {
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
          dryRun,
        },
      };
    }

    try {
      const data = await tool.execute(input, request.context);

      if (tool.outputSchema) {
        const parsedOutput = tool.outputSchema.safeParse(data);
        if (!parsedOutput.success) {
          errors.push("Tool output validation failed.");
        }
      }

      const finishedAtDate = new Date();
      return {
        toolName: tool.name,
        success: errors.length === 0,
        data,
        dataSummary: buildToolDataSummary(tool.name, data),
        warnings,
        errors,
        metadata: {
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
          dryRun,
        },
      };
    } catch (error) {
      if (error instanceof AgentToolExecutionError) {
        throw error;
      }

      errors.push(toErrorMessage(error));
      const finishedAtDate = new Date();

      return {
        toolName: tool.name,
        success: false,
        dataSummary: {
          toolName: tool.name,
          failed: true,
        },
        warnings,
        errors,
        metadata: {
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
          dryRun,
        },
      };
    }
  }
}
