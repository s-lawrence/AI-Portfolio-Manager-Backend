import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_NAMES,
  AGENT_TOOL_RISK_LEVEL,
  AgentToolExecutionError,
  type AgentToolContext,
  type AgentToolName,
  type AgentToolResult,
} from "./agent-tool.types";
import { env } from "../config/env";
import { agentToolExecutor, agentToolRegistry } from "./index";
import {
  type AgentChatRequest,
  type AgentRecommendationCard,
  type AgentChatResponse,
  type AgentConfidence,
  type AgentOpenAiDiagnostics,
  type AgentSuggestedAction,
  type AgentTickerResolutionResult,
  type AgentToolCallSummary,
  type OpenAiToolCatalogItem,
  openAiToolPlanOutputSchema,
} from "./agent-chat.types";
import {
  OpenAiAgentClientError,
  generateAgentSynthesis,
  generateToolPlan,
  normalizePlannerOutputAliases,
} from "./openai-agent-client";
import {
  checkOpenAiUsageAllowance,
  hasOpenAiUsageLimitsConfigured,
  recordOpenAiUsage,
} from "./openai-usage-limits";
import {
  collectMentionedTickers,
  isFxAmbiguousTickerToken,
  isCommandWordTickerToken,
  isFxSemanticContextMessage,
  resolveTickerFromMessage,
} from "./agent-entity-resolution";

const FULL_REFRESH_DEFAULT_INPUT = {
  refreshMode: "quick",
  includeEconomics: true,
  includeBankOfCanada: true,
  includeFred: true,
  includeAnalystData: true,
  includeGdelt: false,
  runAnalysis: true,
} as const;

const WATCHLIST_REFRESH_DEFAULT_INPUT = {
  historicalLimit: 250,
  newsLimitPerTicker: 10,
  includeMarketData: true,
  includeFundamentals: true,
  includeEarnings: true,
  includeNews: true,
  includeAnalystData: true,
  runReports: false,
} as const;

type PlannedToolExecution = {
  toolName: AgentToolName;
  input: Record<string, unknown>;
  purpose: string;
  confirmed: boolean;
};

type PlannedToolCallCandidate = {
  toolName: string;
  input: Record<string, unknown>;
  purpose: string;
};

type PlanValidationResult = {
  intent: string;
  missingContext: string[];
  clarifyingQuestion: string | null;
  plannedToolCount: number;
  droppedToolCount: number;
  blockedToolCount: number;
  blockedTools: Array<{
    toolName: string;
    reason: string;
  }>;
  warnings: string[];
  suggestedActions: AgentSuggestedAction[];
  executableCalls: PlannedToolExecution[];
};

type ToolExecutionErrorDiagnostic = {
  toolName: string;
  code: string;
  message: string;
};

type ExecutedToolResult = AgentToolResult & {
  errorCode?: string;
};

const PORTFOLIO_SCOPED_TOOL_NAMES: AgentToolName[] = [
  "getPortfolioOverview",
  "getPortfolioRiskSnapshot",
  "getPortfolioDataQuality",
  "rankPortfolioHoldings",
  "runPortfolioFullRefresh",
];

const SAFE_WARNING_PORTFOLIO_CONTEXT_MISSING = "Portfolio context was missing.";
const SAFE_WARNING_PORTFOLIO_ACCESS_DENIED = "Portfolio access was denied.";
const SAFE_WARNING_PORTFOLIO_NO_DATA = "Portfolio tools returned no data.";
const SAFE_WARNING_TOOL_FAILED = "Tool execution failed.";
const SAFE_WARNING_MODEL_FALLBACK_USED =
  "Primary OpenAI model was unavailable; fallback model was used.";

type DeterministicPlan = {
  intent: string;
  missingContext: string[];
  clarifyingQuestion: string | null;
  toolCalls: PlannedToolCallCandidate[];
  warnings: string[];
};

function calculateDurationMs(startedAtDate: Date, finishedAtDate: Date): number {
  return Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item != null)
    : [];
}

function isPortfolioScopedTool(toolName: AgentToolName): boolean {
  return PORTFOLIO_SCOPED_TOOL_NAMES.includes(toolName);
}

function asOptionalConfiguredString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatCadCurrency(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function safeWarningForBlockedReason(reason: string): string {
  const normalized = reason.toLowerCase();

  if (normalized.includes("context was missing")) {
    return SAFE_WARNING_PORTFOLIO_CONTEXT_MISSING;
  }

  if (normalized.includes("access was denied") || normalized.includes("ownership")) {
    return SAFE_WARNING_PORTFOLIO_ACCESS_DENIED;
  }

  return SAFE_WARNING_TOOL_FAILED;
}

function safeWarningForExecutionError(error: ToolExecutionErrorDiagnostic): string {
  if (error.code === "FORBIDDEN" || error.code === "AGENT_TOOL_PORTFOLIO_CONTEXT_MISMATCH") {
    return SAFE_WARNING_PORTFOLIO_ACCESS_DENIED;
  }

  if (error.code === "NOT_FOUND" && isPortfolioScopedTool(error.toolName as AgentToolName)) {
    return SAFE_WARNING_PORTFOLIO_NO_DATA;
  }

  return SAFE_WARNING_TOOL_FAILED;
}

type PortfolioRecommendationPresentation = {
  answer: string;
  recommendationCards: AgentRecommendationCard[];
};

function toActionLabelFromStance(input: {
  stance: string;
  missingDataCount: number;
  staleWarningCount: number;
  dataQualityScore: number | null;
}): string {
  const normalizedStance = input.stance.trim().toUpperCase();

  if (
    input.missingDataCount >= 2 ||
    input.staleWarningCount >= 2 ||
    (input.dataQualityScore != null && input.dataQualityScore < 45)
  ) {
    return "Data cleanup needed";
  }

  if (normalizedStance === "STRONG_CANDIDATE" || normalizedStance === "CANDIDATE") {
    return "Review / Candidate";
  }

  if (normalizedStance === "WATCH") {
    return "Hold / Monitor";
  }

  if (
    normalizedStance === "HOLD_OFF" ||
    normalizedStance === "AVOID" ||
    normalizedStance === "REDUCE"
  ) {
    return "Trim / Risk review";
  }

  return "Hold / Monitor";
}

function toConfidenceFromDataQuality(input: {
  dataQualityScore: number | null;
  missingDataCount: number;
  staleWarningCount: number;
}): AgentConfidence | undefined {
  if (input.dataQualityScore == null) {
    return undefined;
  }

  if (
    input.dataQualityScore >= 75 &&
    input.missingDataCount <= 1 &&
    input.staleWarningCount <= 1
  ) {
    return "HIGH";
  }

  if (input.dataQualityScore >= 55) {
    return "MEDIUM";
  }

  return "LOW";
}

function toRecommendationNextStep(input: {
  actionLabel: string;
  ticker: string;
  hasConcentrationRisk: boolean;
}): string {
  if (input.actionLabel === "Data cleanup needed") {
    return `Refresh missing price/FX/fundamental data for ${input.ticker} and rerun ranking before any allocation decision.`;
  }

  if (input.actionLabel === "Trim / Risk review") {
    return `Run a position-risk review for ${input.ticker} and decide whether exposure should be reduced.`;
  }

  if (input.actionLabel === "Hold / Monitor") {
    return `Keep ${input.ticker} on monitor and reassess on the next refreshed snapshot.`;
  }

  if (input.hasConcentrationRisk) {
    return `Treat ${input.ticker} as a potential swap candidate and avoid increasing overall concentration.`;
  }

  return `Validate the thesis for ${input.ticker} and define position-size and risk limits before any change.`;
}

function buildPortfolioRecommendationsPresentation(
  toolResults: AgentToolResult[],
): PortfolioRecommendationPresentation | null {
  const byToolName = new Map<string, AgentToolResult>();
  for (const result of toolResults) {
    byToolName.set(result.toolName, result);
  }

  const rankingPayload = asRecord(byToolName.get("rankPortfolioHoldings")?.data);
  if (!rankingPayload) {
    return null;
  }

  const rankedHoldings = asRecordList(rankingPayload.rankedHoldings);
  const qualityPayload = asRecord(byToolName.get("getPortfolioDataQuality")?.data);
  const riskPayload = asRecord(byToolName.get("getPortfolioRiskSnapshot")?.data);

  if (rankedHoldings.length === 0) {
    const skippedCount = asNumber(rankingPayload.skippedHoldingsCount) ?? 0;
    if (skippedCount > 0) {
      const missingFxCount = asRecordList(qualityPayload?.missingFxIssues).length;
      const missingPriceCount = asRecordList(qualityPayload?.missingPriceIssues).length;
      const missingCurrencyCount = asRecordList(qualityPayload?.missingCurrencyIssues).length;
      const caveatParts: string[] = [];

      if (missingPriceCount > 0) {
        caveatParts.push(`missing prices for ${missingPriceCount} holding(s)`);
      }
      if (missingCurrencyCount > 0) {
        caveatParts.push(`missing currency metadata for ${missingCurrencyCount} holding(s)`);
      }
      if (missingFxCount > 0) {
        caveatParts.push(`missing FX conversion for ${missingFxCount} holding(s)`);
      }

      const caveatSuffix = caveatParts.length > 0
        ? ` Key caveats: ${caveatParts.join(", ")}.`
        : "";

      return {
        answer:
          "Snapshot-based decision support from persisted backend scoring could not rank holdings because metrics are insufficient right now. " +
          "Refresh pricing/fundamental/FX data and rerun this ranking." +
          caveatSuffix +
          " Decision support only, not a buy/sell instruction.",
        recommendationCards: [],
      };
    }

    return null;
  }

  const topThree = rankedHoldings.slice(0, 3);
  const topRisks = asStringList(riskPayload?.topRisks);
  const hasConcentrationRisk =
    asRecordList(riskPayload?.concentrationRisks).length > 0 ||
    topRisks.some((risk) => risk.toLowerCase().includes("concentration"));

  const recommendationCards: AgentRecommendationCard[] = topThree.map((item, index) => {
    const ticker = asString(item.ticker) ?? "UNKNOWN";
    const companyName = asString(item.companyName) ?? undefined;
    const score = asNumber(item.compositeScore) ?? 0;
    const stance = asString(item.suggestedStance) ?? "WATCH";
    const bullishFactors = asStringList(item.bullishFactors);
    const bearishFactors = asStringList(item.bearishFactors);
    const missingData = asStringList(item.missingData);
    const staleDataWarnings = asStringList(item.staleDataWarnings);
    const dataQualityScore = asNumber(asRecord(item.componentScores)?.dataQualityScore);

    const actionLabel = toActionLabelFromStance({
      stance,
      missingDataCount: missingData.length,
      staleWarningCount: staleDataWarnings.length,
      dataQualityScore,
    });

    const why = bullishFactors.slice(0, 2);
    if (why.length === 0) {
      why.push("Composite score reflects relative strength across persisted technical, fundamental, and analyst signals.");
    }

    const cautions: string[] = [];
    if (bearishFactors.length > 0) {
      cautions.push(bearishFactors[0]);
    } else if (missingData.length > 0) {
      cautions.push(`Missing data: ${missingData.slice(0, 2).join(", ")}.`);
    } else if (staleDataWarnings.length > 0) {
      cautions.push(staleDataWarnings[0]);
    } else {
      cautions.push("Risk signals are mixed; validate against latest brokerage-side data before acting.");
    }

    return {
      rank: index + 1,
      ticker,
      companyName,
      actionLabel,
      score: Number(score.toFixed(1)),
      stance,
      confidence: toConfidenceFromDataQuality({
        dataQualityScore,
        missingDataCount: missingData.length,
        staleWarningCount: staleDataWarnings.length,
      }),
      why,
      cautions,
      nextStep: toRecommendationNextStep({
        actionLabel,
        ticker,
        hasConcentrationRisk,
      }),
    };
  });

  const caveats: string[] = [];
  const concentrationRisks = asRecordList(riskPayload?.concentrationRisks);
  const sectorExposure = asRecordList(riskPayload?.sectorExposure)
    .sort((left, right) => (asNumber(right.sharePercent) ?? -1) - (asNumber(left.sharePercent) ?? -1));
  const topSector = sectorExposure[0] ?? null;
  const missingFxCount = asRecordList(qualityPayload?.missingFxIssues).length;
  const missingCurrencyCount = asRecordList(qualityPayload?.missingCurrencyIssues).length;
  const missingPriceCount = asRecordList(qualityPayload?.missingPriceIssues).length;
  const staleCount = asStringList(qualityPayload?.staleDataWarnings).length;

  if (concentrationRisks.length > 0) {
    const topConcentrationMessage = asString(concentrationRisks[0]?.message);
    caveats.push(topConcentrationMessage ?? "Concentration risk is elevated.");
  } else {
    caveats.push("No severe concentration threshold breach detected in current snapshot.");
  }

  if (topSector) {
    const sectorName = asString(topSector.key) ?? "Unknown";
    const sectorShare = asNumber(topSector.sharePercent);
    if (sectorShare != null) {
      caveats.push(`Sector concentration: ${sectorName} at ${formatPercent(sectorShare)} of portfolio market value.`);
    } else {
      caveats.push(`Sector concentration: ${sectorName} is currently the largest sector exposure.`);
    }
  }

  if (missingPriceCount > 0 || staleCount > 0) {
    caveats.push(
      `Missing/stale data: missing prices=${missingPriceCount}, stale warnings=${staleCount}.`,
    );
  } else {
    caveats.push("Missing/stale data: no major price staleness flagged.");
  }

  if (missingFxCount > 0 || missingCurrencyCount > 0) {
    caveats.push(`FX/currency issues: missing FX conversions=${missingFxCount}, missing currency metadata=${missingCurrencyCount}.`);
  } else {
    caveats.push("FX/currency issues: no major conversion gaps flagged.");
  }

  if (hasConcentrationRisk) {
    caveats.push(
      "Reconciliation note: treat Review / Candidate names as replacement/sizing candidates, not automatic net additions.",
    );
  }

  if (topRisks.length > 0) {
    caveats.push(`Additional risk notes: ${topRisks.slice(0, 2).join(" ")}`);
  }

  const scoreValues = topThree
    .map((item) => asNumber(item.compositeScore))
    .filter((value): value is number => value != null);
  const scoreSpread =
    scoreValues.length >= 2
      ? Math.max(...scoreValues) - Math.min(...scoreValues)
      : null;

  const closeRankingsNote =
    scoreSpread != null && scoreSpread <= 3
      ? ` Scores are close (spread ${scoreSpread.toFixed(1)}), so rank order should not be treated as a conviction gap.`
      : "";

  const scoredCount = asNumber(rankingPayload.scoredHoldingsCount) ?? rankedHoldings.length;
  const summaryLine =
    `Snapshot-based decision support from persisted backend scoring across ${scoredCount} scored holding(s).` +
    (closeRankingsNote.length > 0 ? ` ${closeRankingsNote}` : "");

  const lines: string[] = [summaryLine, "", "Top 3 recommendations:"];

  for (const card of recommendationCards) {
    const companyText = card.companyName ? ` (${card.companyName})` : "";
    const confidenceText = card.confidence ? ` | Confidence: ${card.confidence}` : "";

    lines.push(`${card.rank}. ${card.ticker}${companyText}`);
    lines.push(`Action: ${card.actionLabel}`);
    lines.push(`Score: ${card.score.toFixed(1)}${confidenceText}`);
    lines.push("Why it ranks here:");
    for (const reason of card.why.slice(0, 2)) {
      lines.push(`- ${reason}`);
    }
    lines.push("Main caution:");
    lines.push(`- ${card.cautions[0] ?? "Risk profile is mixed and should be reviewed."}`);
    lines.push(`Suggested next step: ${card.nextStep}`);
    lines.push("");
  }

  lines.push("Portfolio-level caveats:");
  for (const caveat of caveats) {
    lines.push(`- ${caveat}`);
  }
  lines.push("");
  lines.push("Decision support only, not a buy/sell instruction.");

  return {
    answer: lines.join("\n").trim(),
    recommendationCards,
  };
}

function buildPortfolioReviewAnswer(
  intent: string,
  toolResults: AgentToolResult[],
): string | null {
  if (intent !== "PORTFOLIO_REVIEW" && intent !== "DAILY_RISK_CHECK") {
    return null;
  }

  const byToolName = new Map<string, AgentToolResult>();
  for (const result of toolResults) {
    byToolName.set(result.toolName, result);
  }

  const overviewPayload = asRecord(byToolName.get("getPortfolioOverview")?.data);
  const riskPayload = asRecord(byToolName.get("getPortfolioRiskSnapshot")?.data);
  const qualityPayload = asRecord(byToolName.get("getPortfolioDataQuality")?.data);

  if (!overviewPayload && !riskPayload && !qualityPayload) {
    return null;
  }

  const holdingCount = asNumber(overviewPayload?.holdingCount)
    ?? (Array.isArray(overviewPayload?.holdings) ? overviewPayload.holdings.length : null);
  const totalValueCad = asNumber(overviewPayload?.totalMarketValueCad);
  const topRisks = asStringList(riskPayload?.topRisks).slice(0, 3);
  const riskMissingData = asStringList(riskPayload?.missingData).slice(0, 2);
  const missingFxIssuesCount = Array.isArray(qualityPayload?.missingFxIssues)
    ? qualityPayload.missingFxIssues.length
    : 0;
  const missingCurrencyIssuesCount = Array.isArray(qualityPayload?.missingCurrencyIssues)
    ? qualityPayload.missingCurrencyIssues.length
    : 0;
  const missingPriceIssuesCount = Array.isArray(qualityPayload?.missingPriceIssues)
    ? qualityPayload.missingPriceIssues.length
    : 0;
  const staleWarnings = asStringList(qualityPayload?.staleDataWarnings).slice(0, 2);
  const suggestedRefreshActions = asStringList(qualityPayload?.suggestedRefreshActions);

  const summaryParts: string[] = [];

  if (holdingCount != null && totalValueCad != null) {
    summaryParts.push(`Portfolio snapshot: ${holdingCount} holding(s), total value ${formatCadCurrency(totalValueCad)}.`);
  } else if (holdingCount != null) {
    summaryParts.push(`Portfolio snapshot: ${holdingCount} holding(s).`);
  }

  if (topRisks.length > 0) {
    summaryParts.push(`Major risks: ${topRisks.join(" ")}`);
  } else if (riskMissingData.length > 0) {
    summaryParts.push(`Risk coverage notes: ${riskMissingData.join(" ")}`);
  } else {
    summaryParts.push("Major risks: no severe concentration thresholds were flagged in the current snapshot.");
  }

  const qualityIssues: string[] = [];
  if (missingFxIssuesCount > 0) {
    qualityIssues.push(`missing FX for ${missingFxIssuesCount} holding(s)`);
  }
  if (missingCurrencyIssuesCount > 0) {
    qualityIssues.push(`missing currency metadata for ${missingCurrencyIssuesCount} holding(s)`);
  }
  if (missingPriceIssuesCount > 0) {
    qualityIssues.push(`missing prices for ${missingPriceIssuesCount} holding(s)`);
  }
  if (staleWarnings.length > 0) {
    qualityIssues.push("stale pricing/FX snapshots detected");
  }

  if (qualityIssues.length > 0) {
    summaryParts.push(`Data quality issues: ${qualityIssues.join(", ")}.`);
  } else if (qualityPayload) {
    summaryParts.push("Data quality: no major FX/currency/price coverage gaps detected.");
  }

  if (suggestedRefreshActions.length > 0) {
    summaryParts.push(`Suggested refresh actions: ${suggestedRefreshActions.join(", ")}.`);
  }

  return summaryParts.join(" ").trim();
}

type DiscoveryCandidatePresentation = {
  answer: string;
  topTickers: string[];
};

function buildDiscoveryCandidatesPresentation(toolResults: AgentToolResult[]): DiscoveryCandidatePresentation | null {
  const byToolName = new Map<string, AgentToolResult>();
  for (const result of toolResults) {
    byToolName.set(result.toolName, result);
  }

  const rankingPayload = asRecord(byToolName.get("rankDiscoveryCandidates")?.data);
  if (!rankingPayload) {
    return null;
  }

  const rankedCandidates = asRecordList(rankingPayload.rankedCandidates);
  const recommendedCandidates = asRecordList(rankingPayload.recommendedCandidates);
  const monitorCandidates = asRecordList(rankingPayload.monitorCandidates);
  const bestAvailableButBelowThreshold = asRecordList(rankingPayload.bestAvailableButBelowThreshold);
  const warnings = asStringList(rankingPayload.warnings);
  const category = asString(rankingPayload.category) ?? "UNKNOWN";
  const noQualifiedCandidates = asBoolean(rankingPayload.noQualifiedCandidates) === true;
  const reasonNoQualifiedCandidates = asString(rankingPayload.reasonNoQualifiedCandidates);
  const minimumRecommendationScore = asNumber(asRecord(rankingPayload.recommendationThreshold)?.minimumRecommendationScore) ?? 60;

  if (rankedCandidates.length === 0) {
    const totalCandidates = asNumber(rankingPayload.totalCandidates) ?? 0;
    const skippedCount = asNumber(rankingPayload.skippedCandidatesCount) ?? 0;

    return {
      answer: [
        `Persisted discovery data exists for ${category} but no candidate could be ranked from current backend coverage.`,
        `Total candidates seen: ${totalCandidates}. Skipped: ${skippedCount}.`,
        warnings.length > 0 ? `Caveats: ${warnings.slice(0, 2).join(" ")}` : "Refresh data and retry ranking to improve coverage.",
        "Decision support only, not a buy/sell instruction.",
      ].join(" "),
      topTickers: [],
    };
  }

  const topQualifiedCandidates = recommendedCandidates.length > 0
    ? recommendedCandidates.slice(0, 5)
    : rankedCandidates.filter((candidate) => asBoolean(candidate.qualifiesForRecommendation) === true).slice(0, 5);
  const screenedButBelowThreshold = bestAvailableButBelowThreshold.length > 0
    ? bestAvailableButBelowThreshold
    : rankedCandidates.filter((candidate) => asBoolean(candidate.qualifiesForRecommendation) !== true).slice(0, 5);

  const topTickers = topQualifiedCandidates
    .map((candidate) => asString(candidate.ticker))
    .filter((ticker): ticker is string => ticker != null);

  const lines: string[] = [];
  if (noQualifiedCandidates) {
    lines.push(
      "I screened the available discovery candidates, but none met the minimum score/quality threshold for a new holding.",
    );
    lines.push(
      reasonNoQualifiedCandidates
        ? `Reason: ${reasonNoQualifiedCandidates}`
        : `Minimum recommendation threshold: composite score >= ${minimumRecommendationScore.toFixed(0)} and non-HOLD_OFF stance.`,
    );
    lines.push("");
    lines.push("Best available but below threshold:");

    for (const candidate of screenedButBelowThreshold.slice(0, 5)) {
      const ticker = asString(candidate.ticker) ?? "UNKNOWN";
      const companyName = asString(candidate.companyName);
      const score = asNumber(candidate.compositeScore);
      const actionLabel = asString(candidate.actionLabel) ?? "Not recommended from current snapshot";
      const caution = asStringList(candidate.cautions)[0]
        ?? asStringList(candidate.bearishFactors)[0]
        ?? asStringList(candidate.staleDataWarnings)[0]
        ?? "Signals are mixed; validate with refreshed data before action.";

      const scoreText = score == null ? "n/a" : score.toFixed(1);
      const companyText = companyName ? ` (${companyName})` : "";
      lines.push(`- ${ticker}${companyText} | Score ${scoreText} | ${actionLabel}`);
      lines.push(`  Caution: ${caution}`);
    }

    if (screenedButBelowThreshold.length === 0) {
      lines.push("- No scored names were available in the current snapshot.");
    }
  } else {
    lines.push(`Qualified new-holding recommendations from persisted ${category} discovery data:`);
    lines.push("");

    for (const candidate of topQualifiedCandidates) {
      const rank = asNumber(candidate.rank) ?? 0;
      const ticker = asString(candidate.ticker) ?? "UNKNOWN";
      const companyName = asString(candidate.companyName);
      const score = asNumber(candidate.compositeScore);
      const stance = asString(candidate.suggestedStance) ?? "WATCH";
      const actionLabel = asString(candidate.actionLabel) ?? "Review candidate";
      const why = asStringList(candidate.why);
      const caution = asStringList(candidate.cautions)[0]
        ?? asStringList(candidate.bearishFactors)[0]
        ?? asStringList(candidate.staleDataWarnings)[0]
        ?? "Signals are mixed; validate with refreshed data before action.";

      const scoreText = score == null ? "n/a" : score.toFixed(1);
      const companyText = companyName ? ` (${companyName})` : "";
      lines.push(`${rank}. ${ticker}${companyText} | Score ${scoreText} | ${stance}`);
      lines.push(`Action: ${actionLabel}`);
      if (why.length > 0) {
        lines.push(`Why: ${why.slice(0, 2).join(" ")}`);
      }
      lines.push(`Caution: ${caution}`);
      lines.push("");
    }

    if (monitorCandidates.length > 0) {
      lines.push("Monitor only:");
      for (const candidate of monitorCandidates.slice(0, 3)) {
        const ticker = asString(candidate.ticker) ?? "UNKNOWN";
        const score = asNumber(candidate.compositeScore);
        const scoreText = score == null ? "n/a" : score.toFixed(1);
        lines.push(`- ${ticker} | Score ${scoreText} | Monitor only`);
      }
      lines.push("");
    }
  }

  if (warnings.length > 0) {
    lines.push(`Additional caveats: ${warnings.slice(0, 2).join(" ")}`);
  }

  if (noQualifiedCandidates) {
    lines.push("Suggested next step: refresh discovery candidates and re-run ranking.");
  }

  lines.push("Decision support only, not a buy/sell instruction.");

  return {
    answer: lines.join("\n").trim(),
    topTickers,
  };
}

function buildFullRefreshInput(portfolioId: string): Record<string, unknown> {
  return {
    portfolioId,
    ...FULL_REFRESH_DEFAULT_INPUT,
  };
}

function buildWatchlistRefreshInput(watchlistId: string): Record<string, unknown> {
  return {
    watchlistId,
    ...WATCHLIST_REFRESH_DEFAULT_INPUT,
  };
}

function redactDiagnosticText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const redacted = value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .trim();

  return redacted.length > 0 ? redacted.slice(0, 200) : undefined;
}

function toPrimaryFailureReason(input: {
  stage?: string;
  errorCode?: string;
  status?: number;
} | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const normalizedErrorCode = input.errorCode?.trim().toLowerCase();
  if (normalizedErrorCode) {
    return normalizedErrorCode;
  }

  const normalizedStage = input.stage?.trim().toLowerCase();
  if (normalizedStage && normalizedStage.length > 0) {
    return normalizedStage;
  }

  if (typeof input.status === "number") {
    return `http_${input.status}`;
  }

  return undefined;
}

function previewPlannerPayload(value: unknown): string | undefined {
  try {
    return redactDiagnosticText(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function inferCanadianTickerPreference(request: AgentChatRequest): boolean | undefined {
  const message = request.message.toLowerCase();
  const contextTicker = request.context.ticker?.trim().toUpperCase();

  if (contextTicker?.endsWith(".TO")) {
    return true;
  }

  if (message.includes("tsx") || message.includes("canada") || message.includes("toronto")) {
    return true;
  }

  if (message.includes("nyse") || message.includes("us listing") || message.includes("new york")) {
    return false;
  }

  return undefined;
}

function buildTickerClarifyingQuestion(resolution: AgentTickerResolutionResult): string | null {
  if (resolution.source !== "AMBIGUOUS") {
    return null;
  }

  const candidates = (resolution.candidates ?? []).slice(0, 4);
  if (candidates.length === 0) {
    return "I found multiple ticker candidates. Which ticker should I use?";
  }

  const options = candidates
    .map((candidate) => {
      const company = candidate.companyName ? ` (${candidate.companyName})` : "";
      return `${candidate.ticker}${company}`;
    })
    .join(", ");

  return `I found multiple ticker candidates: ${options}. Which ticker should I use?`;
}

function hasConfiguredContextString(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function collectReceivedContextKeys(
  context: AgentChatRequest["context"],
): NonNullable<AgentChatResponse["metadata"]["receivedContextKeys"]> {
  const keys: NonNullable<AgentChatResponse["metadata"]["receivedContextKeys"]> = [];

  if (hasConfiguredContextString(context.source)) {
    keys.push("source");
  }
  if (hasConfiguredContextString(context.userId)) {
    keys.push("userId");
  }
  if (hasConfiguredContextString(context.portfolioId)) {
    keys.push("portfolioId");
  }
  if (hasConfiguredContextString(context.watchlistId)) {
    keys.push("watchlistId");
  }
  if (hasConfiguredContextString(context.ticker)) {
    keys.push("ticker");
  }
  if (hasConfiguredContextString(context.requestId)) {
    keys.push("requestId");
  }

  return keys;
}

function isPortfolioContextIntent(intent: string): boolean {
  return (
    intent === "DAILY_RISK_CHECK" ||
    intent === "PORTFOLIO_REVIEW" ||
    intent === "PORTFOLIO_RISK_SNAPSHOT" ||
    intent === "PORTFOLIO_RECOMMENDATIONS"
  );
}

function isPortfolioRecommendationRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  const recommendationSignals = [
    "top three recommendation",
    "top 3 recommendation",
    "top recommendations",
    "best holdings",
    "buy/sell/trim",
    "buy sell trim",
    "which positions look strongest",
    "strongest positions",
    "rank my portfolio",
    "recommendation for my portfolio",
    "based on current metrics",
  ];

  const hasRecommendationSignal = recommendationSignals.some((signal) => normalized.includes(signal));
  if (hasRecommendationSignal) {
    return true;
  }

  const hasTopThree =
    (normalized.includes("top 3") || normalized.includes("top three")) &&
    (normalized.includes("portfolio") || normalized.includes("holding") || normalized.includes("position"));

  if (hasTopThree) {
    return true;
  }

  return (
    normalized.includes("rank") &&
    (normalized.includes("portfolio") || normalized.includes("holding") || normalized.includes("position"))
  );
}

function isGeopoliticalContextMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("geopolit") ||
    normalized.includes("gdelt") ||
    normalized.includes("sanction") ||
    normalized.includes("war") ||
    normalized.includes("conflict") ||
    normalized.includes("headline risk") ||
    normalized.includes("global risk")
  );
}

function shouldBlockFxTickerRefresh(input: {
  toolName: AgentToolName;
  toolInput: Record<string, unknown>;
  userMessage: string;
}): boolean {
  if (input.toolName !== "refreshTickerAnalystData") {
    return false;
  }

  if (!isFxSemanticContextMessage(input.userMessage)) {
    return false;
  }

  const ticker = typeof input.toolInput.ticker === "string"
    ? input.toolInput.ticker
    : undefined;

  return isFxAmbiguousTickerToken(ticker);
}

function hasMissingFxSignals(result: AgentToolResult): boolean {
  if (!result.success || !result.data || typeof result.data !== "object") {
    return false;
  }

  const payload = result.data as Record<string, unknown>;

  if (result.toolName === "getPortfolioOverview") {
    return Array.isArray(payload.holdingsMissingFx) && payload.holdingsMissingFx.length > 0;
  }

  if (result.toolName !== "getPortfolioRiskSnapshot") {
    return false;
  }

  if (!Array.isArray(payload.holdingsMissingFx)) {
    return false;
  }

  return payload.holdingsMissingFx.length > 0;
}

function hasLowWatchlistCoverageSignals(result: AgentToolResult): boolean {
  if (!result.success || !result.data || typeof result.data !== "object") {
    return false;
  }

  const payload = result.data as Record<string, unknown>;

  if (result.toolName === "scoreWatchlist") {
    const activeItemsCount = typeof payload.activeItemsCount === "number"
      ? payload.activeItemsCount
      : null;
    const scoredItemsCount = typeof payload.scoredItemsCount === "number"
      ? payload.scoredItemsCount
      : null;
    const skippedItemsCount = typeof payload.skippedItemsCount === "number"
      ? payload.skippedItemsCount
      : null;

    if (activeItemsCount != null && scoredItemsCount != null && activeItemsCount > scoredItemsCount) {
      return true;
    }

    return (skippedItemsCount ?? 0) > 0;
  }

  if (result.toolName !== "getWatchlistDataQuality") {
    return false;
  }

  const partialItemsCount = typeof payload.partialItemsCount === "number"
    ? payload.partialItemsCount
    : 0;
  const emptyItemsCount = typeof payload.emptyItemsCount === "number"
    ? payload.emptyItemsCount
    : 0;

  return partialItemsCount > 0 || emptyItemsCount > 0;
}

function hasLowTickerCoverageSignals(result: AgentToolResult): boolean {
  if (!result.success || !result.data || typeof result.data !== "object") {
    return false;
  }

  if (result.toolName !== "getTickerDataQuality") {
    return false;
  }

  const payload = result.data as Record<string, unknown>;
  const missingData = Array.isArray(payload.missingData) ? payload.missingData : [];
  const staleDataWarnings = Array.isArray(payload.staleDataWarnings) ? payload.staleDataWarnings : [];

  return missingData.length > 0 || staleDataWarnings.length > 0;
}

function normalizeCoverageFieldName(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes("price")) {
    return "price";
  }
  if (normalized.includes("technical")) {
    return "technical";
  }
  if (normalized.includes("fundamental")) {
    return "fundamental";
  }
  if (normalized.includes("analyst")) {
    return "analyst";
  }
  if (normalized.includes("news") || normalized.includes("headline")) {
    return "news";
  }
  if (normalized.includes("earnings")) {
    return "earnings";
  }
  if (normalized.includes("report")) {
    return "report";
  }

  return null;
}

function collectWatchlistCoverageWarnings(toolResults: AgentToolResult[]): string[] {
  const scoreWatchlistResult = toolResults.find((result) => result.success && result.toolName === "scoreWatchlist");
  if (!scoreWatchlistResult) {
    return [];
  }

  const warnings: string[] = [
    "Scores are relative across current watchlist items and are not absolute buy/sell signals.",
    "Based on persisted backend snapshots, not live brokerage quotes.",
  ];

  let hasAnyPriceSnapshot = false;
  let hasAnyFundamentalSnapshot = false;
  const missingOrStaleFields = new Set<string>();

  for (const result of toolResults) {
    if (!result.success || !result.data || typeof result.data !== "object") {
      continue;
    }

    const payload = result.data as Record<string, unknown>;

    if (result.toolName === "getWatchlistResearchBundle") {
      const items = Array.isArray(payload.items)
        ? payload.items.filter((item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null)
        : [];

      for (const item of items) {
        if (typeof item.latestPriceSnapshot === "object" && item.latestPriceSnapshot !== null) {
          hasAnyPriceSnapshot = true;
        }

        if (typeof item.latestFundamentalSnapshot === "object" && item.latestFundamentalSnapshot !== null) {
          hasAnyFundamentalSnapshot = true;
        }

        const missingResearchData = Array.isArray(item.missingResearchData)
          ? item.missingResearchData
          : [];
        for (const missingField of missingResearchData) {
          if (typeof missingField !== "string") {
            continue;
          }

          const normalizedField = normalizeCoverageFieldName(missingField);
          if (normalizedField) {
            missingOrStaleFields.add(normalizedField);
          }
        }
      }
    }

    if (result.toolName === "getWatchlistDataQuality") {
      const perTickerQuality = Array.isArray(payload.perTickerQuality)
        ? payload.perTickerQuality.filter((item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null)
        : [];

      for (const item of perTickerQuality) {
        if (item.hasPrice === true) {
          hasAnyPriceSnapshot = true;
        }

        if (item.hasFundamental === true) {
          hasAnyFundamentalSnapshot = true;
        }

        const missingData = Array.isArray(item.missingData) ? item.missingData : [];
        for (const missingField of missingData) {
          if (typeof missingField !== "string") {
            continue;
          }

          const normalizedField = normalizeCoverageFieldName(missingField);
          if (normalizedField) {
            missingOrStaleFields.add(normalizedField);
          }
        }

        const staleDataWarnings = Array.isArray(item.staleDataWarnings) ? item.staleDataWarnings : [];
        for (const staleWarning of staleDataWarnings) {
          if (typeof staleWarning !== "string") {
            continue;
          }

          const normalizedField = normalizeCoverageFieldName(staleWarning);
          if (normalizedField) {
            missingOrStaleFields.add(normalizedField);
          }
        }
      }
    }
  }

  if (missingOrStaleFields.size > 0) {
    warnings.push(
      `Data may be delayed or incomplete; missing/stale fields detected: ${[...missingOrStaleFields].sort().join(", ")}. Verify against your brokerage before acting.`,
    );
    return warnings;
  }

  if (!hasAnyPriceSnapshot && !hasAnyFundamentalSnapshot) {
    warnings.push(
      "Watchlist data currently lacks persisted price and fundamental snapshots for ranked items; verify against your brokerage before acting.",
    );
  } else if (!hasAnyPriceSnapshot) {
    warnings.push(
      "Watchlist data currently lacks persisted price snapshots for ranked items; verify against your brokerage before acting.",
    );
  } else if (!hasAnyFundamentalSnapshot) {
    warnings.push(
      "Watchlist data currently lacks persisted fundamental snapshots for ranked items; verify against your brokerage before acting.",
    );
  } else {
    warnings.push("Data may be delayed or incomplete; verify against your brokerage before acting.");
  }

  return warnings;
}

function deriveSuggestedActionsFromToolResults(toolResults: AgentToolResult[]): AgentSuggestedAction[] {
  const suggestedActions: AgentSuggestedAction[] = [];

  const watchlistRefreshTarget = toolResults
    .filter((result) => hasLowWatchlistCoverageSignals(result))
    .map((result) => {
      if (!result.data || typeof result.data !== "object") {
        return null;
      }

      const payload = result.data as Record<string, unknown>;
      return typeof payload.watchlistId === "string" && payload.watchlistId.trim().length > 0
        ? payload.watchlistId
        : null;
    })
    .find((value): value is string => value != null);

  if (watchlistRefreshTarget) {
    suggestedActions.push({
      label: "Refresh watchlist research data",
      toolName: "refreshWatchlistResearchData",
      input: { watchlistId: watchlistRefreshTarget },
      requiresConfirmation: true,
    });
  }

  const tickerRefreshTarget = toolResults
    .filter((result) => hasLowTickerCoverageSignals(result))
    .map((result) => {
      if (!result.data || typeof result.data !== "object") {
        return null;
      }

      const payload = result.data as Record<string, unknown>;
      return typeof payload.ticker === "string" && payload.ticker.trim().length > 0
        ? payload.ticker
        : null;
    })
    .find((value): value is string => value != null);

  if (tickerRefreshTarget) {
    suggestedActions.push({
      label: `Refresh analyst data for ${tickerRefreshTarget}`,
      toolName: "refreshTickerAnalystData",
      input: { ticker: tickerRefreshTarget },
      requiresConfirmation: true,
    });
  }

  if (toolResults.some((result) => hasMissingFxSignals(result))) {
    suggestedActions.push({
      label: "Refresh USD/CAD FX rate",
      toolName: "refreshUsdCadFxRate",
      input: {},
      requiresConfirmation: true,
    });
  }

  const discoveryRankingResult = toolResults.find(
    (result) => result.success && result.toolName === "rankDiscoveryCandidates" && result.data,
  );

  if (discoveryRankingResult?.data && typeof discoveryRankingResult.data === "object") {
    const payload = discoveryRankingResult.data as Record<string, unknown>;
    const refreshActions = asStringList(payload.suggestedRefreshActions);
    const rankedCandidates = asRecordList(payload.rankedCandidates);
    const recommendedCandidates = asRecordList(payload.recommendedCandidates);
    const monitorCandidates = asRecordList(payload.monitorCandidates);

    if (refreshActions.includes("refreshDiscoveryCategory")) {
      const category = asString(payload.category);
      suggestedActions.push({
        label: "Refresh discovery candidates",
        toolName: "refreshDiscoveryCategory",
        input: { category: category ?? "GAINERS" },
        requiresConfirmation: true,
      });
    }

    if (refreshActions.includes("refreshTickerAnalystData")) {
      const targeted = [...recommendedCandidates, ...monitorCandidates, ...rankedCandidates]
        .find((candidate) =>
          (asString(candidate.suggestedStance)?.toUpperCase() ?? "") !== "HOLD_OFF" &&
          asStringList(candidate.missingData)
            .map((value) => value.toLowerCase())
            .some((value) => value.includes("analyst")),
        )
        ?? null;
      const ticker = asString(targeted?.ticker);

      if (ticker) {
        suggestedActions.push({
          label: `Refresh analyst data for ${ticker}`,
          toolName: "refreshTickerAnalystData",
          input: { ticker },
          requiresConfirmation: true,
        });
      }
    }
  }

  return suggestedActions;
}

function deriveWarningsFromToolResults(toolResults: AgentToolResult[]): string[] {
  return collectWatchlistCoverageWarnings(toolResults);
}

function reconcilePlannerMissingContext(input: {
  intent: string;
  missingContext: string[];
  request: AgentChatRequest;
}): string[] {
  const reconciled = new Set(dedupe(input.missingContext));

  if (hasConfiguredContextString(input.request.context.userId)) {
    reconciled.delete("userId");
  }

  if (hasConfiguredContextString(input.request.context.portfolioId)) {
    reconciled.delete("portfolioId");
  }

  if (hasConfiguredContextString(input.request.context.watchlistId)) {
    reconciled.delete("watchlistId");
  }

  const hasTicker = hasConfiguredContextString(input.request.context.ticker);
  if (hasTicker) {
    reconciled.delete("ticker");
  }

  // Portfolio risk/overview intents should not require ticker if portfolio context exists.
  if (isPortfolioContextIntent(input.intent) && hasConfiguredContextString(input.request.context.portfolioId)) {
    reconciled.delete("ticker");
  }

  return [...reconciled];
}

function determineIntent(message: string, tickers: string[]): string {
  const normalized = message.toLowerCase();

  if (normalized.startsWith("confirm:")) {
    return "CONFIRM_TOOL_EXECUTION";
  }

  if (
    normalized.includes("refresh") &&
    normalized.includes("watchlist")
  ) {
    return "WATCHLIST_REFRESH_REQUEST";
  }

  if (
    normalized.includes("run full refresh") ||
    normalized.includes("refresh data") ||
    normalized.includes("update portfolio data") ||
    normalized.includes("refresh my portfolio")
  ) {
    return "REFRESH_REQUEST";
  }

  if (normalized.includes("add") && normalized.includes("watchlist")) {
    return "WATCHLIST_ADD";
  }

  const newHoldingSignals =
    (normalized.includes("new holding") || normalized.includes("new position") || normalized.includes("candidate ticker") || normalized.includes("candidate stock")) &&
    (normalized.includes("find") || normalized.includes("suggest") || normalized.includes("recommend") || normalized.includes("rank"));

  const discoverySignals =
    (normalized.includes("discovery") || normalized.includes("gainers") || normalized.includes("losers") || normalized.includes("analyst upgrades") || normalized.includes("market movers")) &&
    (normalized.includes("candidate") || normalized.includes("holding") || normalized.includes("rank") || normalized.includes("best"));

  if (newHoldingSignals || discoverySignals) {
    return "MARKET_CANDIDATE_DISCOVERY";
  }

  if (
    normalized.includes("watchlist") &&
    (
      normalized.includes("look best") ||
      normalized.includes("best") ||
      normalized.includes("look good") ||
      normalized.includes("good time to buy") ||
      normalized.includes("time to buy") ||
      normalized.includes("good to buy") ||
      normalized.includes("which items") ||
      normalized.includes("any of the items")
    )
  ) {
    return "WATCHLIST_SCORE";
  }

  if (normalized.includes("worried") || (normalized.includes("risk") && normalized.includes("today"))) {
    return "DAILY_RISK_CHECK";
  }

  if (isPortfolioRecommendationRequest(message)) {
    return "PORTFOLIO_RECOMMENDATIONS";
  }

  if (normalized.includes("review") && normalized.includes("portfolio")) {
    return "PORTFOLIO_REVIEW";
  }

  if (normalized.includes("risk") && normalized.includes("portfolio")) {
    return "PORTFOLIO_RISK_SNAPSHOT";
  }

  if (normalized.includes("compare") && tickers.length >= 2) {
    return "COMPARE_TICKERS";
  }

  if (
    normalized.includes("research") ||
    normalized.includes("analy") ||
    normalized.includes("report") ||
    normalized.includes("take a look") ||
    normalized.includes("look at")
  ) {
    return "RESEARCH_TICKER";
  }

  if (tickers.length === 1) {
    return "RESEARCH_TICKER";
  }

  return "GENERAL_QA";
}

function summarizeToolOutput(toolName: string, data: unknown): string {
  if (!data || typeof data !== "object") {
    return "No data returned.";
  }

  const payload = data as Record<string, unknown>;

  if (toolName === "scoreTickerResearch") {
    const ticker = String(payload.ticker ?? "UNKNOWN");
    const compositeScore = typeof payload.compositeScore === "number"
      ? payload.compositeScore.toFixed(2)
      : "n/a";
    const suggestedStance = String(payload.suggestedStance ?? "UNKNOWN");
    return `${ticker} scored ${compositeScore} with stance ${suggestedStance}.`;
  }

  if (toolName === "compareTickers") {
    const requested = Array.isArray(payload.requestedTickers)
      ? (payload.requestedTickers as unknown[]).length
      : 0;
    const scores = Array.isArray(payload.scores)
      ? (payload.scores as unknown[]).length
      : 0;
    return `Compared ${scores} ticker scorecards out of ${requested} requested tickers.`;
  }

  if (toolName === "scoreWatchlist") {
    const totalItems = typeof payload.totalItems === "number"
      ? payload.totalItems
      : typeof payload.itemCount === "number"
        ? payload.itemCount
        : Array.isArray(payload.rankedItems)
          ? (payload.rankedItems as unknown[]).length
          : 0;
    const activeItemsCount = typeof payload.activeItemsCount === "number"
      ? payload.activeItemsCount
      : totalItems;
    const scoredItemsCount = typeof payload.scoredItemsCount === "number"
      ? payload.scoredItemsCount
      : Array.isArray(payload.rankedItems)
        ? (payload.rankedItems as unknown[]).length
        : typeof payload.itemCount === "number"
          ? payload.itemCount
          : 0;
    const skippedItemsCount = typeof payload.skippedItemsCount === "number"
      ? payload.skippedItemsCount
      : Math.max(0, activeItemsCount - scoredItemsCount);
    const topTickers = Array.isArray(payload.rankedItems)
      ? (payload.rankedItems as Array<Record<string, unknown>>)
        .slice(0, 3)
        .map((item) => {
          const ticker = typeof item.ticker === "string" ? item.ticker : "?";
          const score = typeof item.compositeScore === "number"
            ? item.compositeScore.toFixed(1)
            : "n/a";
          return `${ticker} (${score})`;
        })
      : [];

    const topSummary = topTickers.length > 0
      ? ` Top: ${topTickers.join(", ")}.`
      : "";

    return `Watchlist scoring processed total=${totalItems}, active=${activeItemsCount}, scored=${scoredItemsCount}, skipped=${skippedItemsCount}.${topSummary}`.trim();
  }

  if (toolName === "rankPortfolioHoldings") {
    const rankedHoldings = asRecordList(payload.rankedHoldings);
    const topThree = rankedHoldings.slice(0, 3).map((item) => {
      const ticker = asString(item.ticker) ?? "?";
      const score = asNumber(item.compositeScore);
      const stance = asString(item.suggestedStance) ?? "WATCH";
      const dataQualityScore = asNumber(asRecord(item.componentScores)?.dataQualityScore);
      const actionLabel = toActionLabelFromStance({
        stance,
        missingDataCount: asStringList(item.missingData).length,
        staleWarningCount: asStringList(item.staleDataWarnings).length,
        dataQualityScore,
      });
      const scoreText = score == null ? "n/a" : score.toFixed(1);
      return `${ticker} (${scoreText}) ${actionLabel}`;
    });

    const scoredCount = typeof payload.scoredHoldingsCount === "number"
      ? payload.scoredHoldingsCount
      : rankedHoldings.length;
    const skippedCount = typeof payload.skippedHoldingsCount === "number"
      ? payload.skippedHoldingsCount
      : 0;

    return `Portfolio ranking scored=${scoredCount}, skipped=${skippedCount}. Top recommendations: ${topThree.join("; ")}`.trim();
  }

  if (toolName === "rankDiscoveryCandidates") {
    const rankedCandidates = asRecordList(payload.rankedCandidates);
    const recommendedCandidates = asRecordList(payload.recommendedCandidates);
    const noQualifiedCandidates = asBoolean(payload.noQualifiedCandidates) === true;
    const top = rankedCandidates.slice(0, 3).map((item) => {
      const ticker = asString(item.ticker) ?? "?";
      const score = asNumber(item.compositeScore);
      const stance = asString(item.suggestedStance) ?? "WATCH";
      const scoreText = score == null ? "n/a" : score.toFixed(1);
      return `${ticker} (${scoreText}) ${stance}`;
    });

    const scoredCount = asNumber(payload.scoredCandidatesCount) ?? rankedCandidates.length;
    const qualifiedCount = recommendedCandidates.length;
    const skippedCount = asNumber(payload.skippedCandidatesCount) ?? 0;
    if (noQualifiedCandidates) {
      return `Discovery ranking scored=${scoredCount}, skipped=${skippedCount}. No candidates met recommendation threshold. Best available: ${top.join("; ")}`.trim();
    }

    return `Discovery ranking scored=${scoredCount}, qualified=${qualifiedCount}, skipped=${skippedCount}. Top recommendations: ${top.join("; ")}`.trim();
  }

  if (toolName === "getPortfolioOverview") {
    const holdings = Array.isArray(payload.holdings)
      ? (payload.holdings as unknown[]).length
      : 0;
    return `Portfolio overview returned ${holdings} holdings.`;
  }

  if (toolName === "getPortfolioRiskSnapshot") {
    const topRisks = Array.isArray(payload.topRisks)
      ? (payload.topRisks as unknown[]).slice(0, 2).map((value) => String(value)).join(" ")
      : "";
    return `Portfolio risk snapshot generated. ${topRisks}`.trim();
  }

  if (toolName === "refreshWatchlistResearchData") {
    const processed = typeof payload.tickersProcessed === "number" ? payload.tickersProcessed : 0;
    const failed = typeof payload.tickersFailed === "number" ? payload.tickersFailed : 0;
    const skipped = typeof payload.tickersSkipped === "number" ? payload.tickersSkipped : 0;
    return `Watchlist refresh processed ${processed} ticker(s), failed ${failed}, skipped ${skipped}.`;
  }

  if (toolName === "runPortfolioFullRefresh") {
    return "Portfolio refresh executed successfully.";
  }

  if (toolName === "refreshUsdCadFxRate") {
    return "USD/CAD FX rate refresh executed successfully.";
  }

  if (toolName === "addTickerToWatchlist") {
    const ticker = typeof payload.ticker === "string" ? payload.ticker : "ticker";
    return `Added ${ticker} to watchlist.`;
  }

  if (toolName === "getGeopoliticalSummary") {
    return "Geopolitical summary returned.";
  }

  return "Tool executed successfully.";
}

function toToolCallSummary(result: {
  toolName: string;
  success: boolean;
  warnings: string[];
  errors: string[];
  metadata: {
    riskLevel: AgentToolCallSummary["riskLevel"];
    executionMode: AgentToolCallSummary["executionMode"];
    durationMs: number;
  };
  data?: unknown;
}): AgentToolCallSummary {
  return {
    toolName: result.toolName,
    success: result.success,
    warnings: result.warnings,
    errors: result.errors,
    riskLevel: result.metadata.riskLevel,
    executionMode: result.metadata.executionMode,
    durationMs: result.metadata.durationMs,
    summary: summarizeToolOutput(result.toolName, result.data),
  };
}

function deterministicConfidence(
  toolCalls: AgentToolCallSummary[],
  warnings: string[],
  missingContext: string[],
): AgentConfidence {
  if (missingContext.length > 0) {
    return "LOW";
  }

  if (toolCalls.some((call) => !call.success || call.errors.length > 0)) {
    return "LOW";
  }

  if (warnings.length > 0) {
    return "MEDIUM";
  }

  return toolCalls.length > 0 ? "HIGH" : "MEDIUM";
}

function addConfirmationPolicy(actions: AgentSuggestedAction[]): AgentSuggestedAction[] {
  return actions
    .map((action) => {
      if (!action.toolName) {
        return action;
      }

      const tool = agentToolRegistry.getTool(action.toolName);
      if (!tool) {
        return action;
      }

      const requiresConfirmation =
        tool.executionMode === AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED ||
        tool.riskLevel === AGENT_TOOL_RISK_LEVEL.REFRESH ||
        tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION ||
        tool.riskLevel === AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT;

      return {
        ...action,
        requiresConfirmation,
      };
    })
    .filter((action) => action.label.trim().length > 0);
}

function sanitizeSuggestedActions(
  actions: AgentSuggestedAction[],
  userMessage: string,
): { actions: AgentSuggestedAction[]; warnings: string[] } {
  const warnings: string[] = [];
  const sanitized: AgentSuggestedAction[] = [];

  for (const action of actions) {
    if (action.toolName && !AGENT_TOOL_NAMES.includes(action.toolName as (typeof AGENT_TOOL_NAMES)[number])) {
      warnings.push(`Dropped unapproved suggested tool '${action.toolName}'.`);
      continue;
    }

    if (action.toolName === "refreshGdeltRiskContext" && !isGeopoliticalContextMessage(userMessage)) {
      warnings.push("Dropped non-geopolitical GDELT refresh suggestion.");
      continue;
    }

    if (
      action.toolName === "refreshTickerAnalystData" &&
      shouldBlockFxTickerRefresh({
        toolName: "refreshTickerAnalystData",
        toolInput: action.input ?? {},
        userMessage,
      })
    ) {
      warnings.push("Dropped ticker refresh suggestion for FX/risk context; use USD/CAD FX refresh instead.");
      sanitized.push({
        label: "Refresh USD/CAD FX rate",
        toolName: "refreshUsdCadFxRate",
        input: {},
        requiresConfirmation: true,
      });
      continue;
    }

    sanitized.push(action);
  }

  return {
    actions: addConfirmationPolicy(sanitized),
    warnings,
  };
}

function mergeRequiredActions(
  requiredActions: AgentSuggestedAction[],
  candidateActions: AgentSuggestedAction[],
): AgentSuggestedAction[] {
  const merged = [...candidateActions];

  for (const action of requiredActions) {
    const exists = merged.some((candidate) =>
      action.toolName
        ? candidate.toolName === action.toolName
        : candidate.label === action.label,
    );

    if (!exists) {
      merged.push(action);
    }
  }

  return addConfirmationPolicy(merged);
}

function deterministicAnswer(input: {
  intent: string;
  toolCalls: AgentToolCallSummary[];
  toolResults: AgentToolResult[];
  recommendationPresentation: PortfolioRecommendationPresentation | null;
  discoveryPresentation: DiscoveryCandidatePresentation | null;
  missingContext: string[];
  clarifyingQuestion: string | null;
  warnings: string[];
  suggestedActions: AgentSuggestedAction[];
  isProduction: boolean;
}): string {
  if (input.clarifyingQuestion) {
    return input.clarifyingQuestion;
  }

  if (input.missingContext.length > 0) {
    return `I need additional context before I can continue: ${input.missingContext.join(", ")}.`;
  }

  if (input.intent === "REFRESH_REQUEST") {
    return "I prepared a full portfolio refresh action. Confirmation is required before execution.";
  }

  if (input.intent === "WATCHLIST_REFRESH_REQUEST") {
    return "I prepared a watchlist research refresh action. Confirmation is required before execution.";
  }

  if (input.intent === "WATCHLIST_ADD" && input.suggestedActions.some((action) => action.toolName === "addTickerToWatchlist")) {
    return "I prepared the watchlist update action. Please confirm before I execute it.";
  }

  if (input.intent === "CONFIRM_TOOL_EXECUTION" && input.toolCalls.length === 0) {
    const actionableWarning = input.warnings.find((warning) =>
      warning.toLowerCase().includes("missing") ||
      warning.toLowerCase().includes("invalid") ||
      warning.toLowerCase().includes("confirm"),
    );

    return actionableWarning
      ?? "I could not execute the confirmed action because required input was missing or invalid.";
  }

  if (input.toolCalls.length === 0) {
    return "I can help with portfolio risk, watchlist scoring, ticker research, and refresh planning. Tell me what you want to review.";
  }

  if (input.intent === "PORTFOLIO_RECOMMENDATIONS") {
    if (input.recommendationPresentation) {
      return input.recommendationPresentation.answer;
    }
  }

  if (input.intent === "MARKET_CANDIDATE_DISCOVERY") {
    if (input.discoveryPresentation) {
      return input.discoveryPresentation.answer;
    }
  }

  const portfolioAnswer = buildPortfolioReviewAnswer(input.intent, input.toolResults);
  if (portfolioAnswer) {
    return portfolioAnswer;
  }

  const firstFailure = input.toolCalls.find((call) => !call.success);
  if (firstFailure) {
    if (input.intent === "CONFIRM_TOOL_EXECUTION") {
      const failureMessage = firstFailure.errors[0] ?? "Tool execution failed.";
      return `I could not execute the confirmed action '${firstFailure.toolName}': ${failureMessage}`;
    }

    if (input.isProduction) {
      return "I ran part of the plan, but tool execution failed.";
    }

    return `I ran part of the plan, but '${firstFailure.toolName}' failed: ${firstFailure.errors.join(" ")}`;
  }

  if (input.intent === "PORTFOLIO_REVIEW" || input.intent === "DAILY_RISK_CHECK") {
    return "I reviewed your portfolio context and risk signals.";
  }

  if (input.intent === "WATCHLIST_SCORE") {
    return "I reviewed your watchlist and generated ranking signals.";
  }

  if (input.intent === "MARKET_CANDIDATE_DISCOVERY") {
    return "I reviewed persisted discovery snapshots and ranked candidate tickers for potential new holdings.";
  }

  if (input.intent === "RESEARCH_TICKER") {
    return "I reviewed the ticker research context and score.";
  }

  return `Deterministic summary: ${input.toolCalls[0]?.summary ?? "No summary available."}`;
}

function summaryFromFieldErrors(fieldErrors: Record<string, string[] | undefined>): string {
  const pairs = Object.entries(fieldErrors)
    .filter(([, errors]) => Array.isArray(errors) && errors.length > 0)
    .slice(0, 6)
    .map(([field, errors]) => `${field}: ${(errors ?? []).join("; ")}`);

  return pairs.length > 0 ? pairs.join(" | ") : "Input must match the registered schema.";
}

function summarizeInputSchema(toolName: AgentToolName): string {
  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return "Tool schema unavailable.";
  }

  const parseWithEmpty = tool.inputSchema.safeParse({});
  if (parseWithEmpty.success) {
    return "No required input fields.";
  }

  return summaryFromFieldErrors(parseWithEmpty.error.flatten().fieldErrors);
}

function buildToolCatalog(): OpenAiToolCatalogItem[] {
  return agentToolRegistry
    .listToolDescriptors()
    .filter((tool) => AGENT_TOOL_NAMES.includes(tool.name as AgentToolName))
    .map((tool) => ({
      name: tool.name as AgentToolName,
      description: tool.description,
      riskLevel: tool.riskLevel,
      executionMode: tool.executionMode,
      inputSchemaSummary: summarizeInputSchema(tool.name as AgentToolName),
    }));
}

function requiresConfirmation(toolName: AgentToolName): boolean {
  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return true;
  }

  return (
    tool.executionMode === AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED ||
    tool.riskLevel === AGENT_TOOL_RISK_LEVEL.REFRESH ||
    tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION ||
    tool.riskLevel === AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT
  );
}

function labelForTool(toolName: AgentToolName, purpose: string): string {
  if (toolName === "runPortfolioFullRefresh") {
    return "Run full portfolio refresh";
  }

  if (toolName === "refreshWatchlistResearchData") {
    return "Refresh watchlist research data";
  }

  if (toolName === "refreshUsdCadFxRate") {
    return "Refresh USD/CAD FX rate";
  }

  if (toolName === "addTickerToWatchlist") {
    return "Add ticker to watchlist";
  }

  if (purpose.trim().length > 0) {
    return `Confirm: ${purpose.trim()}`;
  }

  return `Confirm tool execution: ${toolName}`;
}

function canExecuteConfirmedTool(toolName: AgentToolName, request: AgentChatRequest): boolean {
  const confirmed = request.confirmedToolExecutions?.includes(toolName) === true;
  if (!confirmed) {
    return false;
  }

  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return false;
  }

  if (tool.riskLevel === AGENT_TOOL_RISK_LEVEL.REFRESH && request.allowRefresh !== true) {
    return false;
  }

  if (
    (tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION || tool.riskLevel === AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT) &&
    request.allowMutation !== true
  ) {
    return false;
  }

  return true;
}

function toNormalizedConfirmedToolInputs(
  rawInputs: unknown,
): Partial<Record<AgentToolName, Record<string, unknown>>> {
  if (!rawInputs || typeof rawInputs !== "object") {
    return {};
  }

  const normalized: Partial<Record<AgentToolName, Record<string, unknown>>> = {};

  if (Array.isArray(rawInputs)) {
    for (const item of rawInputs) {
      const entry = asRecord(item);
      const toolName = asString(entry?.toolName);
      const input = asRecord(entry?.input);
      if (!toolName || !input) {
        continue;
      }

      if (AGENT_TOOL_NAMES.includes(toolName as AgentToolName)) {
        normalized[toolName as AgentToolName] = input;
      }
    }

    return normalized;
  }

  const record = asRecord(rawInputs) ?? {};
  const directToolName = asString(record.toolName);
  const directInput = asRecord(record.input);
  if (directToolName && directInput && AGENT_TOOL_NAMES.includes(directToolName as AgentToolName)) {
    normalized[directToolName as AgentToolName] = directInput;
  }

  for (const [key, value] of Object.entries(record)) {
    if (!AGENT_TOOL_NAMES.includes(key as AgentToolName)) {
      continue;
    }

    const input = asRecord(value);
    if (input) {
      normalized[key as AgentToolName] = input;
    }
  }

  return normalized;
}

function inferDiscoveryCategoryFromMessage(message: string): string | undefined {
  const upper = message.toUpperCase();

  if (upper.includes("ANALYST_UPGRADES") || upper.includes("ANALYST UPGRADES")) {
    return "ANALYST_UPGRADES";
  }
  if (upper.includes("ANALYST_DOWNGRADES") || upper.includes("ANALYST DOWNGRADES")) {
    return "ANALYST_DOWNGRADES";
  }
  if (upper.includes("LOSERS")) {
    return "LOSERS";
  }
  if (upper.includes("ACTIVE")) {
    return "ACTIVE";
  }
  if (upper.includes("GAINERS")) {
    return "GAINERS";
  }

  return undefined;
}

function resolveConfirmedToolInput(
  toolName: AgentToolName,
  request: AgentChatRequest,
  tickers: string[],
): Record<string, unknown> | undefined {
  const normalizedInputs = toNormalizedConfirmedToolInputs(request.confirmedToolInputs);
  const explicitInput = normalizedInputs[toolName];
  if (explicitInput && typeof explicitInput === "object") {
    if (toolName === "refreshDiscoveryCategory") {
      const explicitCategory = asString(explicitInput.category);
      return {
        ...explicitInput,
        category:
          explicitCategory ??
          inferDiscoveryCategoryFromMessage(request.message) ??
          "GAINERS",
      };
    }

    if (toolName === "refreshTickerAnalystData") {
      const explicitTicker = asString(explicitInput.ticker);
      if (explicitTicker) {
        return explicitInput;
      }

      const fallbackTicker = request.context.ticker?.toUpperCase() ?? tickers[0];
      if (!fallbackTicker) {
        return undefined;
      }

      return {
        ...explicitInput,
        ticker: fallbackTicker,
      };
    }

    return explicitInput;
  }

  if (toolName === "runPortfolioFullRefresh") {
    if (!request.context.portfolioId) {
      return undefined;
    }

    return buildFullRefreshInput(request.context.portfolioId);
  }

  if (toolName === "addTickerToWatchlist") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];
    if (!request.context.watchlistId || !ticker) {
      return undefined;
    }

    return {
      watchlistId: request.context.watchlistId,
      ticker,
      status: "WATCHING",
    };
  }

  if (toolName === "refreshUsdCadFxRate") {
    return {};
  }

  if (toolName === "refreshWatchlistResearchData") {
    if (!request.context.watchlistId) {
      return undefined;
    }

    return buildWatchlistRefreshInput(request.context.watchlistId);
  }

  if (toolName === "refreshDiscoveryCategory") {
    return {
      category: inferDiscoveryCategoryFromMessage(request.message) ?? "GAINERS",
    };
  }

  if (toolName === "refreshTickerAnalystData") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];
    if (!ticker) {
      return undefined;
    }

    return { ticker };
  }

  if (toolName === "refreshWatchlistAnalystData") {
    if (!request.context.watchlistId) {
      return undefined;
    }

    return { watchlistId: request.context.watchlistId };
  }

  return {};
}

function isContextFreeReadOnly(toolName: AgentToolName): boolean {
  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return false;
  }

  if (tool.riskLevel !== AGENT_TOOL_RISK_LEVEL.READ_ONLY || tool.executionMode !== AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED) {
    return false;
  }

  return tool.inputSchema.safeParse({}).success;
}

function validateAndPrepareToolCalls(input: {
  intent: string;
  toolCalls: PlannedToolCallCandidate[];
  missingContext: string[];
  clarifyingQuestion: string | null;
  request: AgentChatRequest;
  maxToolCalls: number;
}): PlanValidationResult {
  const cappedToolCalls = input.toolCalls.slice(0, input.maxToolCalls);
  const missingContext = dedupe(input.missingContext);
  const executableCalls: PlannedToolExecution[] = [];
  const warnings: string[] = [];
  const suggestedActions: AgentSuggestedAction[] = [];
  const blockedTools: Array<{ toolName: string; reason: string }> = [];
  let blockedToolCount = 0;
  let droppedToolCount = Math.max(0, input.toolCalls.length - cappedToolCalls.length);

  for (const planned of cappedToolCalls) {
    if (!AGENT_TOOL_NAMES.includes(planned.toolName as AgentToolName)) {
      droppedToolCount += 1;
      warnings.push(`Dropped unknown planned tool '${planned.toolName}'.`);
      continue;
    }

    const toolName = planned.toolName as AgentToolName;
    const tool = agentToolRegistry.getTool(toolName);
    if (!tool) {
      droppedToolCount += 1;
      warnings.push(`Dropped unavailable planned tool '${toolName}'.`);
      continue;
    }

    if (tool.executionMode === AGENT_TOOL_EXECUTION_MODE.DISABLED) {
      droppedToolCount += 1;
      warnings.push(`Dropped disabled tool '${toolName}'.`);
      continue;
    }

    let normalizedInput: Record<string, unknown>;
    try {
      normalizedInput = agentToolRegistry.validateToolInput(toolName, planned.input ?? {}) as Record<string, unknown>;
    } catch (error) {
      droppedToolCount += 1;
      const message = error instanceof AgentToolExecutionError
        ? error.message
        : "Invalid planner tool input.";

      if (error instanceof AgentToolExecutionError && error.code === "AGENT_TOOL_INVALID_INPUT") {
        const flattened = asRecord(error.details);
        const fieldErrors = asRecord(flattened?.fieldErrors) ?? {};
        const normalizedFieldErrors: Record<string, string[] | undefined> = {};

        for (const [field, value] of Object.entries(fieldErrors)) {
          normalizedFieldErrors[field] = Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : undefined;
        }

        if (toolName === "refreshDiscoveryCategory") {
          warnings.push("The refresh action was missing category input. Try again with category GAINERS.");
        } else {
          warnings.push(
            `Dropped invalid planned input for '${toolName}': ${summaryFromFieldErrors(normalizedFieldErrors)}`,
          );
        }
      } else {
        warnings.push(`Dropped invalid planned input for '${toolName}': ${message}`);
      }

      continue;
    }

    if (isPortfolioScopedTool(toolName)) {
      const canonicalPortfolioId = asOptionalConfiguredString(input.request.context.portfolioId);
      const plannedPortfolioId = asOptionalConfiguredString(normalizedInput.portfolioId);

      if (!canonicalPortfolioId) {
        blockedToolCount += 1;
        blockedTools.push({
          toolName,
          reason: "Portfolio context was missing; portfolio-scoped tool cannot run.",
        });
        missingContext.push("portfolioId");
        warnings.push(`Blocked tool '${toolName}' because portfolio context was missing.`);
        continue;
      }

      if (plannedPortfolioId && plannedPortfolioId !== canonicalPortfolioId) {
        blockedToolCount += 1;
        blockedTools.push({
          toolName,
          reason: "Portfolio access was denied because planned portfolioId did not match canonical context.",
        });
        warnings.push(`Blocked tool '${toolName}' because planned portfolioId did not match canonical context.`);
        continue;
      }

      normalizedInput = {
        ...normalizedInput,
        portfolioId: canonicalPortfolioId,
      };
    }

    if (toolName === "refreshGdeltRiskContext" && !isGeopoliticalContextMessage(input.request.message)) {
      droppedToolCount += 1;
      warnings.push("Dropped non-geopolitical GDELT refresh request.");
      continue;
    }

    if (shouldBlockFxTickerRefresh({
      toolName,
      toolInput: normalizedInput,
      userMessage: input.request.message,
    })) {
      droppedToolCount += 1;
      warnings.push("Dropped ticker refresh for FX/risk context; suggest USD/CAD FX refresh instead.");
      suggestedActions.push({
        label: "Refresh USD/CAD FX rate",
        toolName: "refreshUsdCadFxRate",
        input: {},
        requiresConfirmation: true,
      });
      continue;
    }

    if (requiresConfirmation(toolName)) {
      if (canExecuteConfirmedTool(toolName, input.request)) {
        executableCalls.push({
          toolName,
          input: normalizedInput,
          purpose: planned.purpose,
          confirmed: true,
        });
      } else {
        suggestedActions.push({
          label: labelForTool(toolName, planned.purpose),
          toolName,
          input: normalizedInput,
          requiresConfirmation: true,
        });
      }

      continue;
    }

    executableCalls.push({
      toolName,
      input: normalizedInput,
      purpose: planned.purpose,
      confirmed: false,
    });
  }

  if (input.intent === "PORTFOLIO_RECOMMENDATIONS") {
    const canonicalPortfolioId = asOptionalConfiguredString(input.request.context.portfolioId);

    if (!canonicalPortfolioId) {
      missingContext.push("portfolioId");
      warnings.push("Portfolio recommendation request requires portfolio context.");
    } else {
      const requiredToolCalls: PlannedToolExecution[] = [
        {
          toolName: "rankPortfolioHoldings",
          input: {
            portfolioId: canonicalPortfolioId,
            limit: 3,
            includeWatchlist: false,
          },
          purpose: "Rank top portfolio holdings using persisted scoring metrics",
          confirmed: false,
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: canonicalPortfolioId },
          purpose: "Assess concentration and risk caveats for ranked holdings",
          confirmed: false,
        },
        {
          toolName: "getPortfolioDataQuality",
          input: { portfolioId: canonicalPortfolioId },
          purpose: "Assess data quality caveats for recommendation confidence",
          confirmed: false,
        },
      ];

      for (const requiredCall of requiredToolCalls) {
        const alreadyPlanned = executableCalls.some((call) => call.toolName === requiredCall.toolName);
        if (alreadyPlanned) {
          continue;
        }

        executableCalls.push(requiredCall);
        warnings.push(`Planner under-tooled recommendation intent; auto-added '${requiredCall.toolName}'.`);
      }

      const hasOverview = executableCalls.some((call) => call.toolName === "getPortfolioOverview");
      if (!hasOverview) {
        executableCalls.push({
          toolName: "getPortfolioOverview",
          input: { portfolioId: canonicalPortfolioId },
          purpose: "Provide holdings context for ranked recommendation response",
          confirmed: false,
        });
      }
    }
  }

  if (input.intent === "MARKET_CANDIDATE_DISCOVERY") {
    const canonicalPortfolioId = asOptionalConfiguredString(input.request.context.portfolioId);
    const canonicalWatchlistId = asOptionalConfiguredString(input.request.context.watchlistId);

    if (!canonicalPortfolioId) {
      missingContext.push("portfolioId");
      warnings.push("Market candidate discovery request requires portfolio context.");
    } else {
      const requiredToolCalls: PlannedToolExecution[] = [
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: canonicalPortfolioId },
          purpose: "Provide portfolio context for candidate-fit analysis",
          confirmed: false,
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: canonicalPortfolioId },
          purpose: "Provide portfolio risk caveats for candidate selection",
          confirmed: false,
        },
        {
          toolName: "getPortfolioDataQuality",
          input: { portfolioId: canonicalPortfolioId },
          purpose: "Provide data quality caveats for candidate confidence",
          confirmed: false,
        },
        {
          toolName: "rankDiscoveryCandidates",
          input: {
            portfolioId: canonicalPortfolioId,
            watchlistId: canonicalWatchlistId,
            limit: 5,
            excludeExistingHoldings: true,
            excludeExistingWatchlistItems: true,
          },
          purpose: "Rank new-holding discovery candidates using persisted data",
          confirmed: false,
        },
      ];

      for (const requiredCall of requiredToolCalls) {
        const alreadyPlanned = executableCalls.some((call) => call.toolName === requiredCall.toolName);
        if (alreadyPlanned) {
          continue;
        }

        executableCalls.push(requiredCall);
        warnings.push(`Planner under-tooled discovery intent; auto-added '${requiredCall.toolName}'.`);
      }
    }
  }

  const normalizedMissingContext = dedupe(missingContext);
  const hasOpenQuestions = normalizedMissingContext.length > 0 || Boolean(input.clarifyingQuestion);

  if (hasOpenQuestions) {
    const contextFreeCalls = executableCalls.filter((call) => isContextFreeReadOnly(call.toolName));
    const skippedCount = executableCalls.length - contextFreeCalls.length;

    if (skippedCount > 0) {
      warnings.push("Planner requested context-dependent tools before required context was provided.");
      droppedToolCount += skippedCount;
    }

    return {
      intent: input.intent,
      missingContext: normalizedMissingContext,
      clarifyingQuestion: input.clarifyingQuestion,
      plannedToolCount: cappedToolCalls.length,
      droppedToolCount,
      blockedToolCount,
      blockedTools,
      warnings,
      suggestedActions: addConfirmationPolicy(suggestedActions),
      executableCalls: contextFreeCalls,
    };
  }

  return {
    intent: input.intent,
    missingContext: normalizedMissingContext,
    clarifyingQuestion: input.clarifyingQuestion,
    plannedToolCount: cappedToolCalls.length,
    droppedToolCount,
    blockedToolCount,
    blockedTools,
    warnings,
    suggestedActions: addConfirmationPolicy(suggestedActions),
    executableCalls,
  };
}

function buildDeterministicPlan(
  request: AgentChatRequest,
  tickers: string[],
  tickerResolution: AgentTickerResolutionResult,
): DeterministicPlan {
  const missingContext: string[] = [];
  const warnings: string[] = [];
  const toolCalls: PlannedToolCallCandidate[] = [];
  let clarifyingQuestion: string | null = null;

  if ((request.confirmedToolExecutions?.length ?? 0) > 0) {
    for (const toolName of request.confirmedToolExecutions ?? []) {
      const resolvedInput = resolveConfirmedToolInput(toolName, request, tickers);
      if (!resolvedInput) {
        warnings.push(`Missing context for confirmed tool '${toolName}'.`);
        if (toolName === "runPortfolioFullRefresh") {
          missingContext.push("portfolioId");
        }
        if (toolName === "addTickerToWatchlist") {
          if (!request.context.watchlistId) {
            missingContext.push("watchlistId");
          }
          if (!request.context.ticker && tickers.length === 0) {
            missingContext.push("ticker");
          }
        }
        continue;
      }

      toolCalls.push({
        toolName,
        input: resolvedInput,
        purpose: "Confirmed tool execution",
      });
    }

    return {
      intent: "CONFIRM_TOOL_EXECUTION",
      missingContext,
      clarifyingQuestion,
      toolCalls,
      warnings,
    };
  }

  const intent = determineIntent(request.message, tickers);

  if (intent === "DAILY_RISK_CHECK") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push(
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Inspect portfolio composition",
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Evaluate concentration and risk profile",
        },
        {
          toolName: "getGeopoliticalSummary",
          input: {},
          purpose: "Check global risk backdrop",
        },
      );
    }
  }

  if (intent === "PORTFOLIO_REVIEW") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push(
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Review portfolio holdings overview",
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Review portfolio risk summary",
        },
        {
          toolName: "getPortfolioDataQuality",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Review portfolio data quality and staleness",
        },
      );

      if (isGeopoliticalContextMessage(request.message)) {
        toolCalls.push({
          toolName: "getGeopoliticalSummary",
          input: {},
          purpose: "Review geopolitical risk backdrop",
        });
      }
    }
  }

  if (intent === "PORTFOLIO_RECOMMENDATIONS") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push(
        {
          toolName: "rankPortfolioHoldings",
          input: {
            portfolioId: request.context.portfolioId,
            limit: 3,
            includeWatchlist: false,
          },
          purpose: "Rank top portfolio holdings using persisted metrics",
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Assess concentration and risk caveats for recommendations",
        },
        {
          toolName: "getPortfolioDataQuality",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Assess data quality caveats for recommendation confidence",
        },
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Provide portfolio context for ranked recommendations",
        },
      );
    }
  }

  if (intent === "PORTFOLIO_RISK_SNAPSHOT") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push({
        toolName: "getPortfolioRiskSnapshot",
        input: { portfolioId: request.context.portfolioId },
        purpose: "Evaluate portfolio risk",
      });
    }
  }

  if (intent === "WATCHLIST_SCORE") {
    if (!request.context.watchlistId) {
      missingContext.push("watchlistId");
    } else {
      toolCalls.push({
        toolName: "scoreWatchlist",
        input: { watchlistId: request.context.watchlistId },
        purpose: "Score watchlist holdings",
      });
    }
  }

  if (intent === "WATCHLIST_REFRESH_REQUEST") {
    if (!request.context.watchlistId) {
      missingContext.push("watchlistId");
    } else {
      toolCalls.push({
        toolName: "refreshWatchlistResearchData",
        input: buildWatchlistRefreshInput(request.context.watchlistId),
        purpose: "Refresh watchlist research data",
      });
    }
  }

  if (intent === "WATCHLIST_ADD") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];

    if (!request.context.watchlistId) {
      missingContext.push("watchlistId");
    }

    if (!ticker) {
      missingContext.push("ticker");
      clarifyingQuestion = clarifyingQuestion ?? buildTickerClarifyingQuestion(tickerResolution);
    }

    if (request.context.watchlistId && ticker) {
      toolCalls.push({
        toolName: "addTickerToWatchlist",
        input: {
          watchlistId: request.context.watchlistId,
          ticker,
          status: "WATCHING",
        },
        purpose: "Add ticker to watchlist",
      });
    }
  }

  if (intent === "MARKET_CANDIDATE_DISCOVERY") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push(
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Load portfolio context for candidate fit",
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Load concentration/risk caveats for new holdings",
        },
        {
          toolName: "getPortfolioDataQuality",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Load portfolio data quality caveats",
        },
        {
          toolName: "rankDiscoveryCandidates",
          input: {
            portfolioId: request.context.portfolioId,
            watchlistId: request.context.watchlistId,
            limit: 5,
            excludeExistingHoldings: true,
            excludeExistingWatchlistItems: true,
          },
          purpose: "Rank persisted discovery candidates for potential new holdings",
        },
      );
    }
  }

  if (intent === "RESEARCH_TICKER") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];

    if (!ticker) {
      missingContext.push("ticker");
      clarifyingQuestion = clarifyingQuestion ?? buildTickerClarifyingQuestion(tickerResolution);
    } else {
      toolCalls.push(
        {
          toolName: "getTickerResearchBundle",
          input: { ticker },
          purpose: "Load full ticker research context",
        },
        {
          toolName: "scoreTickerResearch",
          input: { ticker },
          purpose: "Score ticker deterministically",
        },
      );
    }
  }

  if (intent === "COMPARE_TICKERS") {
    if (tickers.length < 2) {
      missingContext.push("tickers");
    } else {
      toolCalls.push({
        toolName: "compareTickers",
        input: { tickers: tickers.slice(0, 10) },
        purpose: "Compare ticker scorecards",
      });
    }
  }

  if (intent === "REFRESH_REQUEST") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push({
        toolName: "runPortfolioFullRefresh",
        input: buildFullRefreshInput(request.context.portfolioId),
        purpose: "Run full portfolio refresh",
      });
    }
  }

  return {
    intent,
    missingContext,
    clarifyingQuestion,
    toolCalls,
    warnings,
  };
}

function toExecutionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Tool execution failed.";
}

function toExecutionErrorCode(error: unknown): string {
  if (error instanceof AgentToolExecutionError) {
    return error.code;
  }

  return "TOOL_EXECUTION_FAILED";
}

async function executePlannedTool(
  planned: PlannedToolExecution,
  context: AgentToolContext,
): Promise<ExecutedToolResult> {
  const startedAtDate = new Date();

  try {
    return await agentToolExecutor.executeByName({
      toolName: planned.toolName,
      input: planned.input,
      context,
      confirmed: planned.confirmed,
    });
  } catch (error) {
    const finishedAtDate = new Date();
    const tool = agentToolRegistry.getTool(planned.toolName);
    const message = toExecutionErrorMessage(error);
    const errorCode = toExecutionErrorCode(error);
    const warnings =
      error instanceof AgentToolExecutionError && error.statusCode === 404
        ? [message]
        : [];

    return {
      toolName: planned.toolName,
      success: false,
      warnings,
      errors: [message],
      errorCode,
      metadata: {
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
        riskLevel: tool?.riskLevel ?? AGENT_TOOL_RISK_LEVEL.READ_ONLY,
        executionMode: tool?.executionMode ?? AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
        dryRun: Boolean(context.dryRun),
      },
    };
  }
}

export async function runAgentChat(request: AgentChatRequest): Promise<AgentChatResponse> {
  const startedAtDate = new Date();
  const message = request.message.trim();
  const requestedMaxToolCalls = request.maxToolCalls ?? env.OPENAI_AGENT_MAX_TOOL_CALLS;
  const effectiveMaxToolCalls = Math.max(
    1,
    Math.min(requestedMaxToolCalls, env.OPENAI_AGENT_MAX_TOOL_CALLS),
  );
  const receivedContextKeys = collectReceivedContextKeys(request.context);
  const receivedPortfolioIdConfigured = hasConfiguredContextString(request.context.portfolioId);
  const receivedWatchlistIdConfigured = hasConfiguredContextString(request.context.watchlistId);
  const receivedTickerConfigured = hasConfiguredContextString(request.context.ticker);
  const preferCanadianTicker = inferCanadianTickerPreference(request);
  const tickerResolution = await resolveTickerFromMessage(message, request.context.ticker, {
    preferCanadianTicker,
  });

  const resolvedTickerForContext = tickerResolution.confidence === "HIGH"
    ? tickerResolution.ticker
    : undefined;
  const shouldDropExplicitCommandWordTicker =
    tickerResolution.confidence !== "HIGH" &&
    isCommandWordTickerToken(request.context.ticker);

  const effectiveRequest: AgentChatRequest = {
    ...request,
    message,
    context: {
      ...request.context,
      ticker: resolvedTickerForContext ?? (shouldDropExplicitCommandWordTicker ? undefined : request.context.ticker),
    },
  };

  const tickers = dedupe([
    ...collectMentionedTickers(message, effectiveRequest.context.ticker, {
      preferCanadianTicker,
    }),
    ...(tickerResolution.ticker ? [tickerResolution.ticker] : []),
  ]);

  const resolvedEntities = tickerResolution.source !== "NONE"
    ? { ticker: tickerResolution }
    : undefined;

  const executionContext: AgentToolContext = {
    source: effectiveRequest.context.source,
    userId: effectiveRequest.context.userId,
    portfolioId: effectiveRequest.context.portfolioId,
    requestId: effectiveRequest.context.requestId,
    dryRun: effectiveRequest.dryRun ?? false,
  };

  let modelName: string | undefined;
  const primaryModelName = env.OPENAI_AGENT_MODEL;
  const fallbackModelName = env.OPENAI_AGENT_MODEL_FALLBACK || undefined;
  let modelUsedForPlanning: string | undefined;
  let modelUsedForSynthesis: string | undefined;
  let primaryFailureReason: string | undefined;
  let openAiDiagnostics: AgentOpenAiDiagnostics | undefined;
  let plannerUsed = false;
  let plannerFallbackUsed = false;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let plannerSkipReason: "PROVIDER_DISABLED" | "API_KEY_MISSING" | "REQUEST_LIMIT_REACHED" | undefined;
  const openAiUsageLimitsConfigured = hasOpenAiUsageLimitsConfigured();
  const openAiUsageAllowance = checkOpenAiUsageAllowance({
    userId: effectiveRequest.context.userId,
  });
  let openAiUsageLimitReason: "DAILY_USER_LIMIT" | "MONTHLY_GLOBAL_LIMIT" | undefined;

  let planningIntent = "GENERAL_QA";
  let planningMissingContext: string[] = [];
  let planningClarifyingQuestion: string | null = null;
  let planningWarnings: string[] = [];
  let plannedToolCount = 0;
  let droppedToolCount = 0;
  let blockedToolCount = 0;
  let blockedTools: Array<{ toolName: string; reason: string }> = [];
  let suggestedActions: AgentSuggestedAction[] = [];
  let executableCalls: PlannedToolExecution[] = [];

  const openAiProviderEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const openAiKeyConfigured = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim().length > 0);
  const shouldAttemptPlanner =
    openAiProviderEnabled && openAiKeyConfigured && openAiUsageAllowance.allowed;

  if (!shouldAttemptPlanner) {
    if (!openAiProviderEnabled) {
      plannerSkipReason = "PROVIDER_DISABLED";
    } else if (!openAiKeyConfigured) {
      plannerSkipReason = "API_KEY_MISSING";
    } else {
      plannerSkipReason = "REQUEST_LIMIT_REACHED";
      openAiUsageLimitReason = openAiUsageAllowance.reason;
      fallbackUsed = true;
      fallbackReason = "OPENAI_REQUEST_LIMIT_REACHED";
      planningWarnings.push("OpenAI request limit reached; deterministic fallback was used.");
    }
  }

  if (shouldAttemptPlanner) {
    plannerUsed = true;
    recordOpenAiUsage({
      userId: effectiveRequest.context.userId,
    });

    try {
      const planResult = await generateToolPlan({
        userMessage: message,
        availableTools: buildToolCatalog(),
        context: {
          userId: effectiveRequest.context.userId,
          portfolioId: effectiveRequest.context.portfolioId,
          watchlistId: effectiveRequest.context.watchlistId,
          ticker: effectiveRequest.context.ticker,
          allowRefresh: effectiveRequest.allowRefresh === true,
          allowMutation: effectiveRequest.allowMutation === true,
          dryRun: effectiveRequest.dryRun === true,
        },
        resolvedEntities,
      });

      modelName = planResult.modelName;
      modelUsedForPlanning = planResult.modelName;

      if (planResult.primaryModelFailure) {
        primaryFailureReason = toPrimaryFailureReason(planResult.primaryModelFailure) ?? primaryFailureReason;
      }

      const parsedPlan = openAiToolPlanOutputSchema.safeParse(
        normalizePlannerOutputAliases(planResult.plan),
      );
      if (!parsedPlan.success) {
        const validationIssues = parsedPlan.error.issues
          .slice(0, 20)
          .map((issue) => ({
            path: issue.path.length > 0 ? issue.path.join(".") : "$",
            code: issue.code,
            message: issue.message.slice(0, 300),
          }));

        throw new OpenAiAgentClientError(
          {
            stage: "VALIDATION_FAILED",
            modelName: planResult.modelName,
            responsePreview: previewPlannerPayload(planResult.plan),
            validationIssues,
            validationIssueCount: parsedPlan.error.issues.length,
          },
          "OpenAI planner JSON did not match schema.",
        );
      }

      if (planResult.usedFallbackModel) {
        planningWarnings.push("Primary OpenAI model was unavailable; fallback model was used for planning.");
      }

      const normalizedPlannerIntent =
        isPortfolioRecommendationRequest(message) &&
        (parsedPlan.data.intent === "PORTFOLIO_REVIEW" ||
          parsedPlan.data.intent === "PORTFOLIO_RISK_SNAPSHOT")
          ? "PORTFOLIO_RECOMMENDATIONS"
          : parsedPlan.data.intent;

      const reconciledMissingContext = reconcilePlannerMissingContext({
        intent: normalizedPlannerIntent,
        missingContext: parsedPlan.data.missingContext,
        request: effectiveRequest,
      });

      const reconciledClarifyingQuestion = reconciledMissingContext.length === 0
        ? null
        : parsedPlan.data.clarifyingQuestion;

      if (reconciledMissingContext.length < parsedPlan.data.missingContext.length) {
        planningWarnings.push("Planner requested context that was already provided; missing-context list was reconciled.");
      }

      const validatedPlan = validateAndPrepareToolCalls({
        intent: normalizedPlannerIntent,
        toolCalls: parsedPlan.data.toolCalls,
        missingContext: reconciledMissingContext,
        clarifyingQuestion: reconciledClarifyingQuestion,
        request: effectiveRequest,
        maxToolCalls: effectiveMaxToolCalls,
      });

      planningIntent = validatedPlan.intent;
      planningMissingContext = validatedPlan.missingContext;
      planningClarifyingQuestion = validatedPlan.clarifyingQuestion;
      planningWarnings = dedupe([...planningWarnings, ...validatedPlan.warnings]);
      plannedToolCount = validatedPlan.plannedToolCount;
      droppedToolCount = validatedPlan.droppedToolCount;
      blockedToolCount = validatedPlan.blockedToolCount;
      blockedTools = validatedPlan.blockedTools;
      suggestedActions = validatedPlan.suggestedActions;
      executableCalls = validatedPlan.executableCalls;
    } catch (error) {
      plannerFallbackUsed = true;
      fallbackUsed = true;
      fallbackReason = "PLANNER_FAILED";
      planningWarnings.push("OpenAI planner failed; deterministic router fallback used.");

      if (env.NODE_ENV !== "production") {
        if (error instanceof OpenAiAgentClientError) {
          primaryFailureReason = toPrimaryFailureReason(error.failure) ?? primaryFailureReason;
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: error.failure.stage,
            openAiErrorCode: error.failure.errorCode,
            openAiStatus: error.failure.status,
            openAiResponsePreview: redactDiagnosticText(error.failure.responsePreview),
            openAiModelName: error.failure.modelName ?? modelName,
            validationIssues: error.failure.validationIssues,
            validationIssueCount: error.failure.validationIssueCount,
          };
        } else {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: "UNKNOWN",
            openAiModelName: modelName,
          };
        }
      }
    }
  }

  if (!shouldAttemptPlanner || plannerFallbackUsed) {
    const deterministicPlan = buildDeterministicPlan(
      effectiveRequest,
      tickers,
      tickerResolution,
    );

    const validatedPlan = validateAndPrepareToolCalls({
      intent: deterministicPlan.intent,
      toolCalls: deterministicPlan.toolCalls,
      missingContext: deterministicPlan.missingContext,
      clarifyingQuestion: deterministicPlan.clarifyingQuestion,
      request: effectiveRequest,
      maxToolCalls: effectiveMaxToolCalls,
    });

    planningIntent = validatedPlan.intent;
    planningMissingContext = validatedPlan.missingContext;
    planningClarifyingQuestion = validatedPlan.clarifyingQuestion;
    planningWarnings = dedupe([
      ...planningWarnings,
      ...deterministicPlan.warnings,
      ...validatedPlan.warnings,
    ]);
    plannedToolCount = validatedPlan.plannedToolCount;
    droppedToolCount = validatedPlan.droppedToolCount;
    blockedToolCount = validatedPlan.blockedToolCount;
    blockedTools = validatedPlan.blockedTools;
    suggestedActions = mergeRequiredActions(validatedPlan.suggestedActions, suggestedActions);
    executableCalls = validatedPlan.executableCalls;
  }

  const cappedExecutableCalls = executableCalls.slice(0, effectiveMaxToolCalls);
  if (executableCalls.length > cappedExecutableCalls.length) {
    droppedToolCount += executableCalls.length - cappedExecutableCalls.length;
  }

  const toolResults: ExecutedToolResult[] = await Promise.all(
    cappedExecutableCalls.map((planned) => executePlannedTool(planned, executionContext)),
  );

  const toolCalls = toolResults.map((result) => toToolCallSummary(result));
  const executedToolCount = toolCalls.length;

  const toolExecutionErrors: ToolExecutionErrorDiagnostic[] = toolResults
    .filter((result) => !result.success)
    .map((result) => ({
      toolName: result.toolName,
      code: result.errorCode ?? "TOOL_EXECUTION_FAILED",
      message: result.errors[0] ?? SAFE_WARNING_TOOL_FAILED,
    }));

  let warnings = dedupe([
    ...planningWarnings,
    ...toolCalls.flatMap((call) => [...call.warnings, ...call.errors]),
  ]);

  const dataDerivedSuggestedActions = deriveSuggestedActionsFromToolResults(toolResults);
  suggestedActions = mergeRequiredActions(dataDerivedSuggestedActions, suggestedActions);

  const dataDerivedWarnings = deriveWarningsFromToolResults(toolResults);
  warnings = dedupe([...warnings, ...dataDerivedWarnings]);

  const recommendationPresentation =
    planningIntent === "PORTFOLIO_RECOMMENDATIONS"
      ? buildPortfolioRecommendationsPresentation(toolResults)
      : null;

  const discoveryPresentation =
    planningIntent === "MARKET_CANDIDATE_DISCOVERY"
      ? buildDiscoveryCandidatesPresentation(toolResults)
      : null;

  if (planningIntent === "MARKET_CANDIDATE_DISCOVERY" && discoveryPresentation) {
    const watchlistId = asOptionalConfiguredString(effectiveRequest.context.watchlistId);
    if (watchlistId) {
      const rankPayload = asRecord(
        toolResults.find((result) => result.success && result.toolName === "rankDiscoveryCandidates")?.data,
      );

      const rankedCandidates = asRecordList(rankPayload?.rankedCandidates);
      const recommendedCandidates = asRecordList(rankPayload?.recommendedCandidates);
      const actionableCandidates =
        recommendedCandidates.length > 0
          ? recommendedCandidates
          : rankedCandidates.filter((candidate) => asBoolean(candidate.qualifiesForRecommendation) === true);

      const candidatesToSuggest = actionableCandidates
        .filter((candidate) => candidate.alreadyInWatchlist !== true)
        .slice(0, 3);

      for (const candidate of candidatesToSuggest) {
        const ticker = asString(candidate.ticker);
        if (!ticker) {
          continue;
        }

        const actionExists = suggestedActions.some((action) =>
          action.toolName === "addTickerToWatchlist" &&
          asString(action.input?.ticker)?.toUpperCase() === ticker.toUpperCase(),
        );

        if (actionExists) {
          continue;
        }

        suggestedActions.push({
          label: `Add ${ticker} to watchlist`,
          toolName: "addTickerToWatchlist",
          input: {
            watchlistId,
            ticker,
            status: "CANDIDATE",
            source: "AGENT",
          },
          requiresConfirmation: true,
        });
      }
    }
  }

  let answer = deterministicAnswer({
    intent: planningIntent,
    toolCalls,
    toolResults,
    recommendationPresentation,
    discoveryPresentation,
    missingContext: planningMissingContext,
    clarifyingQuestion: planningClarifyingQuestion,
    warnings,
    suggestedActions,
    isProduction: env.NODE_ENV === "production",
  });

  let confidence = deterministicConfidence(toolCalls, warnings, planningMissingContext);
  let mode: AgentChatResponse["metadata"]["mode"] = "DETERMINISTIC_ROUTER";

  if (shouldAttemptPlanner && !plannerFallbackUsed) {
    try {
      const synthesis = await generateAgentSynthesis({
        userMessage: message,
        intent: planningIntent,
        toolResultSummaries: toolCalls.map((call) => ({
          toolName: call.toolName,
          summary: call.summary,
          success: call.success,
          warnings: call.warnings,
          errors: call.errors,
        })),
        warnings,
        missingContext: planningMissingContext,
        suggestedActions,
      });

      const sanitized = sanitizeSuggestedActions(synthesis.synthesis.suggestedActions, message);

      answer = synthesis.synthesis.answer;
      if (planningIntent === "PORTFOLIO_RECOMMENDATIONS" && recommendationPresentation) {
        answer = recommendationPresentation.answer;
      }
      if (planningIntent === "MARKET_CANDIDATE_DISCOVERY" && discoveryPresentation) {
        answer = discoveryPresentation.answer;
      }
      confidence = synthesis.synthesis.confidence;
      warnings = dedupe([...warnings, ...synthesis.synthesis.warnings, ...sanitized.warnings]);
      suggestedActions = mergeRequiredActions(suggestedActions, sanitized.actions);
      mode = "OPENAI_PLANNED_SYNTHESIS";
      modelName = synthesis.modelName;
      modelUsedForSynthesis = synthesis.modelName;

      if (synthesis.primaryModelFailure) {
        primaryFailureReason = toPrimaryFailureReason(synthesis.primaryModelFailure) ?? primaryFailureReason;
      }

      if (synthesis.usedFallbackModel) {
        warnings = dedupe([
          ...warnings,
          "Primary OpenAI model was unavailable; fallback model was used for synthesis.",
        ]);

        if (env.NODE_ENV !== "production" && synthesis.primaryModelFailure) {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: synthesis.primaryModelFailure.stage,
            openAiErrorCode: synthesis.primaryModelFailure.errorCode,
            openAiStatus: synthesis.primaryModelFailure.status,
            openAiResponsePreview: redactDiagnosticText(
              synthesis.primaryModelFailure.responsePreview,
            ),
            openAiModelName: synthesis.modelName,
            validationIssues: synthesis.primaryModelFailure.validationIssues,
            validationIssueCount: synthesis.primaryModelFailure.validationIssueCount,
          };
        }
      }
    } catch (error) {
      fallbackUsed = true;
      fallbackReason = fallbackReason ?? "SYNTHESIS_FAILED";
      warnings = dedupe([...warnings, "OpenAI synthesis failed; deterministic fallback used."]);
      mode = "DETERMINISTIC_ROUTER";

      if (env.NODE_ENV !== "production") {
        if (error instanceof OpenAiAgentClientError) {
          primaryFailureReason = toPrimaryFailureReason(error.failure) ?? primaryFailureReason;
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: error.failure.stage,
            openAiErrorCode: error.failure.errorCode,
            openAiStatus: error.failure.status,
            openAiResponsePreview: redactDiagnosticText(error.failure.responsePreview),
            openAiModelName: error.failure.modelName ?? modelName,
            validationIssues: error.failure.validationIssues,
            validationIssueCount: error.failure.validationIssueCount,
          };
        } else {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: "UNKNOWN",
            openAiModelName: modelName,
          };
        }
      }
    }
  }

  let responseWarnings = warnings;

  if (env.NODE_ENV === "production") {
    const safeWarnings = new Set<string>();

    if (planningMissingContext.includes("portfolioId")) {
      safeWarnings.add(SAFE_WARNING_PORTFOLIO_CONTEXT_MISSING);
    }

    for (const blockedTool of blockedTools) {
      safeWarnings.add(safeWarningForBlockedReason(blockedTool.reason));
    }

    for (const executionError of toolExecutionErrors) {
      safeWarnings.add(safeWarningForExecutionError(executionError));
    }

    const portfolioToolResults = toolResults
      .filter((result) => isPortfolioScopedTool(result.toolName as AgentToolName));

    const hasPortfolioToolNoData =
      isPortfolioContextIntent(planningIntent) &&
      planningMissingContext.length === 0 &&
      portfolioToolResults.length > 0 &&
      portfolioToolResults.every((result) => !result.success || result.data == null);

    if (hasPortfolioToolNoData) {
      safeWarnings.add(SAFE_WARNING_PORTFOLIO_NO_DATA);
    }

    if (warnings.some((warning) =>
      warning.toLowerCase().includes("openai planner failed") ||
      warning.toLowerCase().includes("openai synthesis failed") ||
      warning.toLowerCase().includes("tool execution failed"),
    )) {
      safeWarnings.add(SAFE_WARNING_TOOL_FAILED);
    }

    if (warnings.some((warning) => warning.toLowerCase().includes("fallback model was used"))) {
      safeWarnings.add(SAFE_WARNING_MODEL_FALLBACK_USED);
    }

    responseWarnings = [...safeWarnings];
  }

  const finishedAtDate = new Date();

  return {
    answer,
    intent: planningIntent,
    toolCalls,
    suggestedActions: addConfirmationPolicy(suggestedActions),
    recommendationCards: recommendationPresentation?.recommendationCards,
    warnings: responseWarnings,
    missingContext: planningMissingContext,
    confidence,
    metadata: {
      mode,
      modelName,
      primaryModelName,
      fallbackModelName,
      modelUsedForPlanning,
      modelUsedForSynthesis,
      primaryFailureReason: env.NODE_ENV !== "production" ? primaryFailureReason : undefined,
      fallbackUsed,
      plannerUsed,
      plannerFallbackUsed,
      plannedToolCount,
      executedToolCount,
      droppedToolCount,
      effectiveMaxToolCalls,
      fallbackReason,
      openAiProviderEnabled: env.NODE_ENV !== "production" ? openAiProviderEnabled : undefined,
      openAiKeyConfigured: env.NODE_ENV !== "production" ? openAiKeyConfigured : undefined,
      plannerSkipReason: env.NODE_ENV !== "production" ? plannerSkipReason : undefined,
      openAiRequestLimitsConfigured:
        env.NODE_ENV !== "production" ? openAiUsageLimitsConfigured : undefined,
      openAiRequestLimitReason:
        env.NODE_ENV !== "production" ? openAiUsageLimitReason : undefined,
      blockedToolCount: env.NODE_ENV !== "production" ? blockedToolCount : undefined,
      blockedTools: env.NODE_ENV !== "production" ? blockedTools : undefined,
      toolExecutionErrors: env.NODE_ENV !== "production" ? toolExecutionErrors : undefined,
      receivedContextKeys: env.NODE_ENV !== "production" ? receivedContextKeys : undefined,
      receivedPortfolioIdConfigured: env.NODE_ENV !== "production" ? receivedPortfolioIdConfigured : undefined,
      receivedWatchlistIdConfigured: env.NODE_ENV !== "production" ? receivedWatchlistIdConfigured : undefined,
      receivedTickerConfigured: env.NODE_ENV !== "production" ? receivedTickerConfigured : undefined,
      startedAt: startedAtDate.toISOString(),
      finishedAt: finishedAtDate.toISOString(),
      durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
      openAiDiagnostics,
    },
  };
}
