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

  if (toolName === "resolveTickerOrCompany") {
    const candidates = asArray(payload.candidates)
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value != null);

    return {
      query: asString(payload.query),
      resolvedTicker: asString(payload.resolvedTicker),
      confidence: asString(payload.confidence),
      isAmbiguous: payload.isAmbiguous === true,
      candidateCount: candidates.length,
      topCandidates: candidates
        .slice(0, 5)
        .map((candidate) => {
          const ticker = asString(candidate.ticker) ?? "UNKNOWN";
          const confidence = asString(candidate.confidence);
          return confidence ? `${ticker} (${confidence})` : ticker;
        }),
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
    const report = asRecord(payload.latestReport) ?? asRecord(payload.latestAIReport);
    const analyst = asRecord(payload.analystSnapshot) ?? asRecord(payload.latestAnalystSnapshot);
    const fundamentals = asRecord(payload.fundamentalSnapshot) ?? asRecord(payload.latestFundamentalSnapshot);
    const latestPrice = asRecord(payload.latestPrice) ?? asRecord(payload.latestPriceSnapshot);
    const deterministicScore = asRecord(payload.deterministicScore);
    const missingData = asArray(payload.missingData);
    const staleDataWarnings = asArray(payload.staleDataWarnings);

    return {
      ticker: asString(payload.ticker) ?? asString(stock?.ticker),
      price: asNumber(latestPrice?.price),
      marketCap:
        asNumber(latestPrice?.marketCap) ??
        asNumber(fundamentals?.marketCap),
      recommendation: asString(report?.recommendation),
      reportId: asString(report?.id),
      compositeScore: asNumber(deterministicScore?.compositeScore),
      analystConsensus:
        asString(analyst?.ratingConsensus) ?? asString(fundamentals?.analystConsensus),
      missingDataCount: missingData.length,
      staleDataWarningsCount: staleDataWarnings.length,
    };
  }

  if (toolName === "scoreTickerResearch") {
    return {
      ticker: asString(payload.ticker),
      compositeScore: asNumber(payload.compositeScore),
      suggestedStance: asString(payload.suggestedStance),
      actionLabel: asString(payload.actionLabel),
      confidence: asString(payload.confidence),
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

  if (toolName === "scoreWatchlist" || toolName === "rankWatchlist") {
    const rankedItems = asArray(payload.rankedItems);
    return {
      totalItems: asNumber(payload.totalItems) ?? asNumber(payload.itemCount),
      scoredItemsCount:
        asNumber(payload.scoredItemsCount) ?? rankedItems.length,
      skippedItemsCount: asNumber(payload.skippedItemsCount),
      topRankedTickers: toTopTickersFromScores(rankedItems),
    };
  }

  if (toolName === "rankPortfolioHoldings") {
    const rankedHoldings = asArray(payload.rankedHoldings);
    const skippedHoldings = asArray(payload.skippedHoldings);

    return {
      portfolioId: asString(payload.portfolioId),
      totalHoldings: asNumber(payload.totalHoldings),
      scoredHoldingsCount: asNumber(payload.scoredHoldingsCount) ?? rankedHoldings.length,
      skippedHoldingsCount: asNumber(payload.skippedHoldingsCount) ?? skippedHoldings.length,
      topRankedTickers: rankedHoldings
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value != null)
        .slice(0, 3)
        .map((item) => {
          const ticker = asString(item.ticker) ?? "UNKNOWN";
          const score = asNumber(item.compositeScore);
          const stance = asString(item.suggestedStance);
          const withScore = score == null ? ticker : `${ticker} (${score.toFixed(1)})`;
          return stance ? `${withScore} ${stance}` : withScore;
        }),
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
      candidateCount: asNumber(payload.candidateCount) ?? items.length,
      topTickers:
        toBoundedStringList(asArray(payload.topTickers), MAX_LIST_ITEMS).length > 0
          ? toBoundedStringList(asArray(payload.topTickers), MAX_LIST_ITEMS)
          : items
            .map((item) => asString(item.ticker))
            .filter((ticker): ticker is string => ticker != null)
            .slice(0, MAX_LIST_ITEMS),
      capturedAt: asString(payload.capturedAt),
      warningCount: asArray(payload.warnings).length,
    };
  }

  if (toolName === "rankDiscoveryCandidates") {
    const rankedCandidates = asArray(payload.rankedCandidates);
    const recommendedCandidates = asArray(payload.recommendedCandidates);
    const monitorCandidates = asArray(payload.monitorCandidates);
    const notRecommendedCandidates = asArray(payload.notRecommendedCandidates);
    const bestAvailableButBelowThreshold = asArray(payload.bestAvailableButBelowThreshold);
    const skippedCandidates = asArray(payload.skippedCandidates);
    return {
      category: asString(payload.category),
      totalCandidates: asNumber(payload.totalCandidates),
      scoredCandidatesCount: asNumber(payload.scoredCandidatesCount) ?? rankedCandidates.length,
      skippedCandidatesCount: asNumber(payload.skippedCandidatesCount) ?? skippedCandidates.length,
      recommendedCandidatesCount: recommendedCandidates.length,
      monitorCandidatesCount: monitorCandidates.length,
      notRecommendedCandidatesCount: notRecommendedCandidates.length,
      bestAvailableButBelowThresholdCount: bestAvailableButBelowThreshold.length,
      noQualifiedCandidates: payload.noQualifiedCandidates === true,
      topRankedTickers: rankedCandidates
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value != null)
        .slice(0, 5)
        .map((item) => {
          const ticker = asString(item.ticker) ?? "UNKNOWN";
          const score = asNumber(item.compositeScore);
          const stance = asString(item.suggestedStance);
          const withScore = score == null ? ticker : `${ticker} (${score.toFixed(1)})`;
          return stance ? `${withScore} ${stance}` : withScore;
        }),
      warningCount: asArray(payload.warnings).length,
      suggestedRefreshActions: toBoundedStringList(asArray(payload.suggestedRefreshActions), 5),
    };
  }

  if (toolName === "screenMarketCandidates") {
    const candidates = asArray(payload.candidates);
    const rejectedCandidates = asArray(payload.rejectedCandidates);
    return {
      screenedCount: asNumber(payload.screenedCount),
      qualifiedCount: asNumber(payload.qualifiedCount) ?? candidates.length,
      rejectedCount: rejectedCandidates.length,
      topCandidates: candidates
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value != null)
        .slice(0, 5)
        .map((candidate) => {
          const ticker = asString(candidate.ticker) ?? "UNKNOWN";
          const totalScore = asNumber(candidate.totalRecommendationScore);
          return totalScore == null ? ticker : `${ticker} (${totalScore.toFixed(1)})`;
        }),
      assumptions: toBoundedStringList(asArray(payload.assumptions), 5),
      clarifyingQuestion: asString(payload.clarifyingQuestion),
      suggestedRefreshActions: toBoundedStringList(asArray(payload.suggestedRefreshActions), 5),
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
      message: asString(payload.message),
      suggestedActions: toBoundedStringList(asArray(payload.suggestedActions), 3),
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

  if (toolName === "refreshTickerResearchData") {
    const sections = asRecord(payload.sections) ?? {};
    const sectionEntries = Object.values(sections)
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value != null);

    const attemptedSections = sectionEntries.filter((section) => section.attempted === true).length;
    const failedSections = sectionEntries.filter((section) => section.success === false).length;

    return {
      plannedOrExecuted: "executed",
      ticker: asString(payload.ticker),
      attemptedSections,
      failedSections,
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
    const failedQueries = asArray(payload.failedQueries)
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => value != null);

    return {
      plannedOrExecuted: "executed",
      queriesProcessed: asNumber(payload.queriesProcessed),
      queriesFailed: asNumber(payload.queriesFailed),
      eventsCreated: asNumber(payload.eventsCreated),
      warningCount: asArray(payload.warnings).length,
      failedQueries: failedQueries
        .slice(0, 3)
        .map((item) => ({
          query: asString(item.query),
          failureCode: asString(item.failureCode),
        })),
    };
  }

  if (toolName === "generateTickerReport") {
    const report = asRecord(payload.report);
    const predictions = asArray(payload.predictions);

    return {
      plannedOrExecuted: "executed",
      reportId: asString(report?.id),
      ticker: asString(report?.ticker),
      recommendation: asString(report?.recommendation),
      reportMode: asString(payload.reportMode),
      fallbackUsed: payload.fallbackUsed === true,
      predictionCount: predictions.length,
      warningCount: asArray(payload.warnings).length,
      dataGapCount: asArray(payload.dataGaps).length,
      modelName: asString(payload.modelName),
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
  const queryProfiles = asArray(payload.queryProfiles);
  const plannedSections = asRecord(payload.plannedSections);
  return {
    plannedOrExecuted: "planned",
    toolName,
    plannedAction: payload.plannedAction === true,
    watchlistId: asString(payload.watchlistId),
    plannedTickers: toBoundedStringList(plannedTickers),
    plannedTickersCount: plannedTickers.length,
    tickersProcessed: asNumber(payload.tickersProcessed),
    tickersSkipped: asNumber(payload.tickersSkipped),
    queryProfilesCount: queryProfiles.length,
    plannedSections,
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
