import {
  AIReport,
  HoldingStatus,
  Prediction,
  PredictionDirection,
  PredictionHorizon,
  Recommendation,
  RiskLevel,
  Sentiment,
} from "@prisma/client";

import {
  createAIReport,
  findAIReportByStockHoldingAndReportDateDay,
  getLatestAIReportByStockId,
  listAIReportsByStockId,
  updateAIReport,
} from "../repositories/ai-reports.repository";
import { getHoldingWithStock } from "../repositories/holdings.repository";
import {
  createPrediction,
  findOpenPredictionByStockHoldingHorizonAndDay,
  updatePrediction,
} from "../repositories/predictions.repository";
import { getLatestMarketSnapshotForStock } from "../repositories/price-snapshots.repository";
import {
  endOfUtcDay,
  normalizeListLimit,
  normalizeTickerOrThrow,
  startOfUtcDay,
} from "../types/common";
import { listRecentNewsByTicker } from "../repositories/news-articles.repository";
import { listUpcomingMacroEventsByProvider } from "../repositories/macro-events.repository";
import { getLatestMacroSeriesObservation } from "../repositories/macro-series-observations.repository";
import {
  AIReportWithStockMetadata,
  DailyTickerReportInput,
  TickerReportContext,
  TickerReportContextBuildOptions,
  TickerReportDataQualityConfidence,
  TickerReportGenerationResult,
  TickerReportGenerationOptions,
  TickerReportMode,
} from "../types/services";
import { getNewsSentimentSummary, isDemoNewsArticle } from "./news.service";
import { getLatestFxRate } from "./fx-rates.service";
import {
  ensureStockExists,
  getStockProfile,
  getStockResearchBundle,
} from "./stocks.service";
import { getGeopoliticalSummary } from "./geopolitical-ingestion.service";
import {
  OpenAiAgentClientError,
  type OpenAiTickerReportOutput,
  generateTickerReport as generateOpenAiTickerReport,
} from "../agent/openai-agent-client";
import { env } from "../config/env";
import { getPortfolioOverview } from "./portfolios.service";
import { getWatchlistWithItems } from "../repositories/watchlists.repository";
import { getTickerDataQuality, scoreTickerResearch } from "./research-scoring.service";
import {
  ingestTickerEarnings,
  ingestTickerFundamentals,
  ingestTickerMarketData,
  ingestTickerNews,
} from "./real-data-ingestion.service";
import { ingestTickerAnalystData } from "./analyst-ingestion.service";

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const OPENAI_REPORT_PROMPT_VERSION = "openai-ticker-report-v1";
const OPENAI_AVOID_DB_MAPPING: Recommendation = Recommendation.SELL;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toAgeInDays(value: Date | string | null | undefined): number | null {
  const iso = toIsoOrNull(value);
  if (!iso) {
    return null;
  }

  const parsed = new Date(iso);
  return Math.floor((Date.now() - parsed.getTime()) / MS_PER_DAY);
}

function stringifyNumber(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return String(value);
}

function stringifyBigInt(value: bigint | number | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return stringifyNumber(value);
}

function normalizeTextList(values: Array<string | null | undefined>, limit: number): string[] {
  const deduped = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    deduped.add(trimmed);
    if (deduped.size >= limit) {
      break;
    }
  }

  return [...deduped];
}

function joinNotesOrNull(values: Array<string | null | undefined>): string | null {
  const normalized = normalizeTextList(values, 12);
  if (normalized.length === 0) {
    return null;
  }

  return normalized.join(" ");
}

function mapDataQualityConfidence(
  missingData: string[],
  staleDataWarnings: string[],
): TickerReportDataQualityConfidence {
  if (missingData.length >= 4 || staleDataWarnings.length >= 4) {
    return "LOW";
  }

  if (missingData.length >= 2 || staleDataWarnings.length >= 2) {
    return "MEDIUM";
  }

  return "HIGH";
}

function toWarningMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return "Unexpected error.";
}

function summarizeOpenAiFailure(error: OpenAiAgentClientError): string {
  const stage = error.failure.stage;
  const code = error.failure.errorCode ? ` (${error.failure.errorCode})` : "";
  return `OpenAI report generation failed at ${stage}${code}; deterministic fallback used.`;
}

function mapOpenAiRecommendation(
  recommendation: OpenAiTickerReportOutput["recommendation"],
  warnings: string[],
): Recommendation {
  if (recommendation === "AVOID") {
    warnings.push("OpenAI recommendation 'AVOID' mapped to 'SELL' for persistence compatibility.");
    return OPENAI_AVOID_DB_MAPPING;
  }

  return recommendation;
}

function mapOpenAiSentiment(
  recommendation: Recommendation,
  report: OpenAiTickerReportOutput,
): Sentiment {
  if (recommendation === Recommendation.BUY) {
    return Sentiment.BULLISH;
  }

  if (recommendation === Recommendation.SELL) {
    return Sentiment.BEARISH;
  }

  if (report.bullCase.length > 0 && report.bearCase.length > 0) {
    return Sentiment.MIXED;
  }

  if (report.bullCase.length > 0) {
    return Sentiment.BULLISH;
  }

  if (report.bearCase.length > 0) {
    return Sentiment.BEARISH;
  }

  return Sentiment.NEUTRAL;
}

function mapConvictionToConfidence(
  conviction: OpenAiTickerReportOutput["conviction"],
  dataQualityConfidence: TickerReportDataQualityConfidence,
  dataGapCount: number,
): number {
  const base = conviction === "HIGH" ? 0.82 : conviction === "MEDIUM" ? 0.64 : 0.42;
  const qualityPenalty = dataQualityConfidence === "LOW"
    ? 0.14
    : dataQualityConfidence === "MEDIUM"
      ? 0.06
      : 0;
  const gapPenalty = Math.min(0.12, dataGapCount * 0.02);

  return clamp(base - qualityPenalty - gapPenalty, 0.1, 0.95);
}

function mapOpenAiRiskScore(args: {
  recommendation: Recommendation;
  conviction: OpenAiTickerReportOutput["conviction"];
  dataQualityConfidence: TickerReportDataQualityConfidence;
  dailyChangePercent: number | null;
}): number {
  let score =
    args.recommendation === Recommendation.BUY
      ? 34
      : args.recommendation === Recommendation.HOLD
        ? 45
        : args.recommendation === Recommendation.WATCH
          ? 56
          : 72;

  if (args.conviction === "LOW") {
    score += 8;
  }

  if (args.dataQualityConfidence === "LOW") {
    score += 10;
  } else if (args.dataQualityConfidence === "MEDIUM") {
    score += 4;
  }

  if (args.dailyChangePercent != null && Math.abs(args.dailyChangePercent) >= 5) {
    score += 6;
  }

  return clamp(score, 5, 95);
}

function includeOptionEnabled(value: boolean | undefined): boolean {
  return value !== false;
}

function formatEstimatedRevenue(value: bigint | number | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  }

  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2)}M`;
  }

  return String(Math.round(numeric));
}

function buildEarningsSummary(nextEarningsEvent: {
  earningsDate: Date | null;
  estimatedEps: number | null;
  estimatedRevenue: bigint | null;
} | null): string {
  if (!nextEarningsEvent?.earningsDate) {
    return "Earnings data unavailable.";
  }

  const now = Date.now();
  const earningsDate = nextEarningsEvent.earningsDate;
  const daysUntilEarnings = Math.ceil(
    (earningsDate.getTime() - now) / (1000 * 60 * 60 * 24),
  );

  const details: string[] = [`Next earnings on ${earningsDate.toISOString()}`];

  if (nextEarningsEvent.estimatedEps != null) {
    details.push(`est. EPS ${nextEarningsEvent.estimatedEps.toFixed(2)}`);
  }

  const estimatedRevenue = formatEstimatedRevenue(nextEarningsEvent.estimatedRevenue);
  if (estimatedRevenue) {
    details.push(`est. revenue ${estimatedRevenue}`);
  }

  if (daysUntilEarnings <= 7) {
    details.push("Watch for elevated volatility into the event.");
  } else {
    details.push("Keep earnings timing on the watchlist for setup changes.");
  }

  return `${details.join(". ")}.`;
}

function buildAnalystSummary(args: {
  currentPrice: number;
  snapshot: {
    priceTargetAverage: number | null;
    priceTargetHigh: number | null;
    priceTargetLow: number | null;
    priceTargetConsensus: number | null;
    targetMedian: number | null;
    upsidePercent: number | null;
    ratingConsensus: string | null;
    analystCount: number | null;
    strongBuyCount: number | null;
    buyCount: number | null;
    holdCount: number | null;
    sellCount: number | null;
    strongSellCount: number | null;
  } | null;
  actions: Array<{
    actionType: string;
    firm: string | null;
    newRating: string | null;
    eventDate: Date;
  }>;
  latestAnnualEstimate?: {
    revenueAvg?: number;
    epsAvg?: number;
  } | null;
  latestQuarterEstimate?: {
    revenueAvg?: number;
    epsAvg?: number;
  } | null;
}): string {
  const parts: string[] = [];
  const snapshot = args.snapshot;

  if (snapshot) {
    const targetAverage = snapshot.priceTargetAverage;
    const targetHigh = snapshot.priceTargetHigh;
    const targetLow = snapshot.priceTargetLow;
    const targetConsensus = snapshot.priceTargetConsensus;
    const targetMedian = snapshot.targetMedian;

    if (
      targetAverage != null ||
      targetHigh != null ||
      targetLow != null ||
      targetConsensus != null
    ) {
      parts.push(
        `Targets avg ${targetAverage != null ? targetAverage.toFixed(2) : "n/a"}, high ${targetHigh != null ? targetHigh.toFixed(2) : "n/a"}, low ${targetLow != null ? targetLow.toFixed(2) : "n/a"}, consensus ${targetConsensus != null ? targetConsensus.toFixed(2) : "n/a"}, median ${targetMedian != null ? targetMedian.toFixed(2) : "n/a"}.`,
      );
    }

    if (snapshot.ratingConsensus) {
      parts.push(`Rating consensus: ${snapshot.ratingConsensus}.`);
    }

    if (snapshot.analystCount != null) {
      parts.push(`Analyst count: ${snapshot.analystCount}.`);
    }

    if (
      snapshot.strongBuyCount != null ||
      snapshot.buyCount != null ||
      snapshot.holdCount != null ||
      snapshot.sellCount != null ||
      snapshot.strongSellCount != null
    ) {
      parts.push(
        `Rating mix SB/B/H/S/SS: ${snapshot.strongBuyCount ?? 0}/${snapshot.buyCount ?? 0}/${snapshot.holdCount ?? 0}/${snapshot.sellCount ?? 0}/${snapshot.strongSellCount ?? 0}.`,
      );
    }

    const impliedUpside =
      snapshot.upsidePercent ??
      (targetConsensus != null && args.currentPrice > 0
        ? ((targetConsensus - args.currentPrice) / args.currentPrice) * 100
        : null);

    if (impliedUpside != null) {
      parts.push(`Implied upside/downside: ${impliedUpside.toFixed(1)}%.`);
    }
  }

  if (args.actions.length > 0) {
    const latestAction = args.actions[0];
    if (latestAction) {
      const latestDate = latestAction.eventDate.toISOString().slice(0, 10);
      const latestFirm = latestAction.firm ?? "Unknown firm";
      parts.push(
        `Latest grade action: ${latestAction.actionType} by ${latestFirm}${latestAction.newRating ? ` to ${latestAction.newRating}` : ""} (${latestDate}).`,
      );
    }

    const recent = args.actions.slice(0, 3).map((action) => {
      const date = action.eventDate.toISOString().slice(0, 10);
      const firm = action.firm ?? "Unknown firm";
      return `${action.actionType} by ${firm} (${date})`;
    });

    parts.push(`Recent analyst actions: ${recent.join("; ")}.`);
  }

  if (args.latestAnnualEstimate) {
    const estimateParts: string[] = [];
    if (args.latestAnnualEstimate.revenueAvg != null) {
      estimateParts.push(`revenue avg ${formatEstimatedRevenue(args.latestAnnualEstimate.revenueAvg)}`);
    }
    if (args.latestAnnualEstimate.epsAvg != null) {
      estimateParts.push(`EPS avg ${args.latestAnnualEstimate.epsAvg.toFixed(2)}`);
    }
    if (estimateParts.length > 0) {
      parts.push(`Forward annual estimate: ${estimateParts.join(", ")}.`);
    }
  }

  if (args.latestQuarterEstimate) {
    const estimateParts: string[] = [];
    if (args.latestQuarterEstimate.revenueAvg != null) {
      estimateParts.push(`revenue avg ${formatEstimatedRevenue(args.latestQuarterEstimate.revenueAvg)}`);
    }
    if (args.latestQuarterEstimate.epsAvg != null) {
      estimateParts.push(`EPS avg ${args.latestQuarterEstimate.epsAvg.toFixed(2)}`);
    }
    if (estimateParts.length > 0) {
      parts.push(`Forward quarter estimate: ${estimateParts.join(", ")}.`);
    }
  }

  if (parts.length === 0) {
    return "Analyst context unavailable.";
  }

  return parts.join(" ");
}

function quoteHeadline(headline: string): string {
  return `"${headline.trim()}"`;
}

function buildNewsSummaryText(args: {
  realHeadlines: string[];
  demoHeadlines: string[];
  totalArticles: number;
}): string {
  const realTop = args.realHeadlines.slice(0, 3);
  const demoTop = args.demoHeadlines.slice(0, 3);

  if (realTop.length > 0) {
    const quoted = realTop.map(quoteHeadline).join("; ");
    return `${args.totalArticles} recent articles analyzed. Top headlines: ${quoted}.`;
  }

  if (demoTop.length > 0) {
    const quoted = demoTop.map(quoteHeadline).join("; ");
    return `Only demo/local news is available right now. Demo headlines: ${quoted}.`;
  }

  return "No recent news available.";
}

type TechnicalSnapshotLike = {
  trendDirection?: string | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  rsi14?: number | null;
  rsi?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHistogram?: number | null;
  volatility?: number | null;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeTechnicalSnapshot(
  technical: unknown,
): {
  exists: boolean;
  trendDirection: string | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  volatility: number | null;
} {
  if (!technical || typeof technical !== "object") {
    return {
      exists: false,
      trendDirection: null,
      sma20: null,
      sma50: null,
      sma200: null,
      rsi: null,
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      volatility: null,
    };
  }

  const snapshot = technical as TechnicalSnapshotLike;

  return {
    exists: true,
    trendDirection: typeof snapshot.trendDirection === "string"
      ? snapshot.trendDirection
      : null,
    sma20: toFiniteNumber(snapshot.sma20),
    sma50: toFiniteNumber(snapshot.sma50 ?? snapshot.ma50),
    sma200: toFiniteNumber(snapshot.sma200 ?? snapshot.ma200),
    rsi: toFiniteNumber(snapshot.rsi14 ?? snapshot.rsi),
    macd: toFiniteNumber(snapshot.macd),
    macdSignal: toFiniteNumber(snapshot.macdSignal),
    macdHistogram: toFiniteNumber(snapshot.macdHistogram),
    volatility: toFiniteNumber(snapshot.volatility),
  };
}

function buildTechnicalSummary(args: {
  technicalExists: boolean;
  trendDirection: string | null;
  currentPrice: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  volatility: number | null;
}): string {
  if (!args.technicalExists) {
    return "Technical trend unavailable.";
  }

  const parts: string[] = [];

  if (args.trendDirection) {
    parts.push(`Trend is ${args.trendDirection}.`);
  }

  if (args.rsi != null) {
    parts.push(`RSI is ${args.rsi.toFixed(1)}.`);
  }

  if (args.sma50 != null) {
    const relation = args.currentPrice >= args.sma50 ? "above" : "below";
    parts.push(`Price is ${relation} the 50-day moving average.`);
  }

  if (args.sma200 != null) {
    const relation = args.currentPrice >= args.sma200 ? "above" : "below";
    parts.push(`Price is ${relation} the 200-day moving average.`);
  }

  if (args.macd != null) {
    const macdSign = args.macd >= 0 ? "positive" : "negative";

    if (args.macdSignal != null) {
      const relation = args.macd >= args.macdSignal ? "above" : "below";
      parts.push(
        `MACD is ${macdSign} at ${args.macd.toFixed(2)} and ${relation} signal (${args.macdSignal.toFixed(2)}).`,
      );
    } else {
      parts.push(`MACD is ${macdSign} at ${args.macd.toFixed(2)}.`);
    }
  } else if (args.macdHistogram != null) {
    const histSign = args.macdHistogram >= 0 ? "positive" : "negative";
    parts.push(`MACD histogram is ${histSign} at ${args.macdHistogram.toFixed(2)}.`);
  }

  if (args.volatility != null) {
    parts.push(`Annualized volatility is ${(args.volatility * 100).toFixed(1)}%.`);
  }

  if (parts.length === 0) {
    return "Technical indicators are unavailable.";
  }

  return parts.join(" ");
}

function formatMacroNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : String(value);
}

async function buildMacroSummary(): Promise<string> {
  const [
    usdCad,
    fred10y,
    fred2y,
    fedFunds,
    cpi,
    unemployment,
    oil,
    us10y,
    us2y,
    mrpTotalUs,
    upcomingHighImportance,
    geopoliticalSummary,
  ] = await Promise.all([
    getLatestFxRate("USD", "CAD"),
    getLatestMacroSeriesObservation("FRED", "DGS10"),
    getLatestMacroSeriesObservation("FRED", "DGS2"),
    getLatestMacroSeriesObservation("FRED", "FEDFUNDS"),
    getLatestMacroSeriesObservation("FRED", "CPIAUCSL"),
    getLatestMacroSeriesObservation("FRED", "UNRATE"),
    getLatestMacroSeriesObservation("FRED", "DCOILWTICO"),
    getLatestMacroSeriesObservation("FMP", "FMP_TREASURY_10Y"),
    getLatestMacroSeriesObservation("FMP", "FMP_TREASURY_2Y"),
    getLatestMacroSeriesObservation("FMP", "FMP_MRP_TOTAL_US"),
    listUpcomingMacroEventsByProvider("FMP", {
      from: new Date(),
      importanceLevels: ["HIGH", "VERY HIGH", "CRITICAL"],
      limit: 3,
    }),
    getGeopoliticalSummary({ days: 7, limit: 100 }).catch(() => null),
  ]);

  const parts: string[] = [];

  const hasBocOrFredData =
    usdCad != null ||
    fred10y != null ||
    fred2y != null ||
    fedFunds != null ||
    cpi != null ||
    unemployment != null ||
    oil != null;

  const resolved10y = fred10y ?? us10y;
  const resolved2y = fred2y ?? us2y;

  if (hasBocOrFredData) {
    if (usdCad) {
      parts.push(`USD/CAD latest: ${usdCad.rate.toFixed(4)} CAD per 1 USD.`);
    }

    if (resolved10y && resolved2y) {
      parts.push(
        `US Treasury curve snapshot: 10Y ${formatMacroNumber(resolved10y.value)}% vs 2Y ${formatMacroNumber(resolved2y.value)}%.`,
      );
    } else if (resolved10y) {
      parts.push(`US 10Y Treasury latest: ${formatMacroNumber(resolved10y.value)}%.`);
    } else if (resolved2y) {
      parts.push(`US 2Y Treasury latest: ${formatMacroNumber(resolved2y.value)}%.`);
    }

    if (fedFunds) {
      parts.push(`Fed funds latest: ${formatMacroNumber(fedFunds.value)}%.`);
    }

    if (cpi) {
      parts.push(`US CPI latest index: ${formatMacroNumber(cpi.value)}.`);
    }

    if (unemployment) {
      parts.push(`US unemployment latest: ${formatMacroNumber(unemployment.value)}%.`);
    }

    if (oil) {
      parts.push(`WTI crude latest: ${formatMacroNumber(oil.value)} USD/bbl.`);
    }

    if (mrpTotalUs) {
      parts.push(`US total market risk premium: ${formatMacroNumber(mrpTotalUs.value)}%.`);
    }

    if (upcomingHighImportance.length > 0) {
      const list = upcomingHighImportance
        .map((event) => {
          const when = event.eventDate ? event.eventDate.toISOString().slice(0, 10) : "unknown-date";
          const country = event.country ?? "global";
          return `${event.title} (${country}, ${when})`;
        })
        .join("; ");

      parts.push(`Upcoming high-importance macro events: ${list}.`);
    }

    if (geopoliticalSummary && geopoliticalSummary.totalEvents > 0) {
      const topThemes = geopoliticalSummary.countsByTheme
        .slice(0, 2)
        .map((item) => item.key.toLowerCase())
        .join(" and ");
      const topHeadline = geopoliticalSummary.topHeadlines[0]?.title;

      parts.push(
        `Recent global-risk monitoring found elevated coverage around ${topThemes || "global risk"}.${topHeadline ? ` Top headline: ${topHeadline}.` : ""}`,
      );
    }

    if (parts.length === 0) {
      return "No macro context available from local economics storage in this phase.";
    }

    return parts.join(" ");
  }

  if (us10y && us2y) {
    parts.push(
      `US Treasury curve snapshot: 10Y ${formatMacroNumber(us10y.value)}% vs 2Y ${formatMacroNumber(us2y.value)}%.`,
    );
  } else if (us10y) {
    parts.push(`US 10Y Treasury latest: ${formatMacroNumber(us10y.value)}%.`);
  } else if (us2y) {
    parts.push(`US 2Y Treasury latest: ${formatMacroNumber(us2y.value)}%.`);
  }

  if (mrpTotalUs) {
    parts.push(`US total market risk premium: ${formatMacroNumber(mrpTotalUs.value)}%.`);
  }

  if (upcomingHighImportance.length > 0) {
    const list = upcomingHighImportance
      .map((event) => {
        const when = event.eventDate ? event.eventDate.toISOString().slice(0, 10) : "unknown-date";
        const country = event.country ?? "global";
        return `${event.title} (${country}, ${when})`;
      })
      .join("; ");

    parts.push(`Upcoming high-importance macro events: ${list}.`);
  }

  if (parts.length === 0) {
    if (geopoliticalSummary && geopoliticalSummary.totalEvents > 0) {
      const topThemes = geopoliticalSummary.countsByTheme
        .slice(0, 2)
        .map((item) => item.key.toLowerCase())
        .join(" and ");
      const topHeadline = geopoliticalSummary.topHeadlines[0]?.title;

      return `Recent global-risk monitoring found coverage around ${topThemes || "global risk"}.${topHeadline ? ` Top headline: ${topHeadline}.` : ""}`;
    }

    return "No macro context available from local economics storage in this phase.";
  }

  if (geopoliticalSummary && geopoliticalSummary.totalEvents > 0) {
    const topThemes = geopoliticalSummary.countsByTheme
      .slice(0, 2)
      .map((item) => item.key.toLowerCase())
      .join(" and ");
    const topHeadline = geopoliticalSummary.topHeadlines[0]?.title;

    parts.push(
      `Recent global-risk monitoring found elevated coverage around ${topThemes || "global risk"}.${topHeadline ? ` Top headline: ${topHeadline}.` : ""}`,
    );
  }

  return parts.join(" ");
}

function riskLevelFromScore(riskScore: number): RiskLevel {
  if (riskScore <= 30) {
    return RiskLevel.LOW;
  }

  if (riskScore <= 60) {
    return RiskLevel.MEDIUM;
  }

  if (riskScore <= 80) {
    return RiskLevel.HIGH;
  }

  return RiskLevel.CRITICAL;
}

function directionFromRecommendation(
  recommendation: Recommendation,
  dailyChangePercent?: number | null,
): PredictionDirection {
  if (recommendation === Recommendation.BUY) {
    return PredictionDirection.UP;
  }

  if (recommendation === Recommendation.SELL) {
    return PredictionDirection.DOWN;
  }

  if ((dailyChangePercent ?? 0) > 1) {
    return PredictionDirection.UP;
  }

  if ((dailyChangePercent ?? 0) < -1) {
    return PredictionDirection.DOWN;
  }

  return PredictionDirection.FLAT;
}

function directionFromScore(score: number): PredictionDirection {
  if (score > 1) {
    return PredictionDirection.UP;
  }

  if (score < -1) {
    return PredictionDirection.DOWN;
  }

  return PredictionDirection.FLAT;
}

function attachStockMetadataToReport(
  report: AIReport,
  stock: {
    ticker: string;
    companyName: string | null;
    exchange: string | null;
    currency: string | null;
    sector: string | null;
    industry: string | null;
  },
): AIReportWithStockMetadata {
  return {
    ...report,
    ticker: stock.ticker,
    companyName: stock.companyName,
    exchange: stock.exchange,
    currency: stock.currency,
    sector: stock.sector,
    industry: stock.industry,
  };
}

function horizonMultiplier(horizon: PredictionHorizon): number {
  if (horizon === PredictionHorizon.ONE_DAY) {
    return 1;
  }

  if (horizon === PredictionHorizon.ONE_WEEK) {
    return 2;
  }

  return 4;
}

function predictionTargets(
  startingPrice: number,
  direction: PredictionDirection,
  horizon: PredictionHorizon,
  dailyChangePercent?: number | null,
): { targetLow: number; targetHigh: number } {
  const baseMovePercent = clamp(
    Math.abs(dailyChangePercent ?? 2) / 100 + 0.02,
    0.01,
    0.25,
  );
  const horizonBand = baseMovePercent * horizonMultiplier(horizon);

  if (direction === PredictionDirection.UP) {
    return {
      targetLow: startingPrice * (1 - horizonBand * 0.5),
      targetHigh: startingPrice * (1 + horizonBand),
    };
  }

  if (direction === PredictionDirection.DOWN) {
    return {
      targetLow: startingPrice * (1 - horizonBand),
      targetHigh: startingPrice * (1 + horizonBand * 0.5),
    };
  }

  return {
    targetLow: startingPrice * (1 - horizonBand * 0.4),
    targetHigh: startingPrice * (1 + horizonBand * 0.4),
  };
}

async function createPredictionsForReport(
  report: AIReport,
  startingPrice: number,
  direction: PredictionDirection,
): Promise<Prediction[]> {
  if (startingPrice <= 0) {
    throw new Error("Starting price must be greater than zero to create predictions.");
  }

  const horizons = [
    PredictionHorizon.ONE_DAY,
    PredictionHorizon.ONE_WEEK,
    PredictionHorizon.ONE_MONTH,
  ];

  const dayStartUtc = startOfUtcDay(report.reportDate);
  const dayEndUtc = endOfUtcDay(report.reportDate);

  const createdPredictions: Prediction[] = [];
  for (const horizon of horizons) {
    const existing = await findOpenPredictionByStockHoldingHorizonAndDay(
      report.stockId,
      report.holdingId,
      horizon,
      dayStartUtc,
      dayEndUtc,
    );

    const targets = predictionTargets(
      startingPrice,
      direction,
      horizon,
      report.dailyChangePercent,
    );

    const predictionPayload = {
      stockId: report.stockId,
      holdingId: report.holdingId,
      aiReportId: report.id,
      predictionDate: report.reportDate,
      horizon,
      recommendation: report.recommendation,
      direction,
      confidenceScore: report.confidenceScore,
      startingPrice,
      targetLow: targets.targetLow,
      targetHigh: targets.targetHigh,
      bullishRationale:
        report.bullishFactors.length > 0
          ? report.bullishFactors.join("; ")
          : null,
      bearishRationale:
        report.bearishFactors.length > 0
          ? report.bearishFactors.join("; ")
          : null,
      dataUsed: {
        source: "mock-deterministic-ai-report",
        reportId: report.id,
      },
    };

    if (existing) {
      const updatedPrediction = await updatePrediction(existing.id, predictionPayload);
      createdPredictions.push(updatedPrediction);
      continue;
    }

    const createdPrediction = await createPrediction({
      ...predictionPayload,
    });

    createdPredictions.push(createdPrediction);
  }

  return createdPredictions;
}

async function createOrUpdateDailyReport(
  input: Parameters<typeof createAIReport>[0],
): Promise<AIReport> {
  const dayStartUtc = startOfUtcDay(input.reportDate as Date);
  const dayEndUtc = endOfUtcDay(input.reportDate as Date);

  const existing = await findAIReportByStockHoldingAndReportDateDay(
    input.stockId,
    input.holdingId ?? null,
    dayStartUtc,
    dayEndUtc,
  );

  if (!existing) {
    return createAIReport(input);
  }

  return updateAIReport(existing.id, input);
}

async function refreshTickerResearchData(ticker: string): Promise<string[]> {
  const warnings: string[] = [];

  try {
    const market = await ingestTickerMarketData(ticker);
    warnings.push(...market.warnings);
  } catch (error) {
    warnings.push(`Market refresh failed: ${toWarningMessage(error)}`);
  }

  try {
    const fundamentals = await ingestTickerFundamentals(ticker);
    warnings.push(...fundamentals.warnings);
  } catch (error) {
    warnings.push(`Fundamental refresh failed: ${toWarningMessage(error)}`);
  }

  try {
    const earnings = await ingestTickerEarnings(ticker);
    warnings.push(...earnings.warnings);
  } catch (error) {
    warnings.push(`Earnings refresh failed: ${toWarningMessage(error)}`);
  }

  try {
    const news = await ingestTickerNews(ticker, { limit: 30 });
    warnings.push(...news.warnings);
  } catch (error) {
    warnings.push(`News refresh failed: ${toWarningMessage(error)}`);
  }

  try {
    const analyst = await ingestTickerAnalystData(ticker);
    warnings.push(...analyst.warnings);
  } catch (error) {
    warnings.push(`Analyst refresh failed: ${toWarningMessage(error)}`);
  }

  return normalizeTextList(warnings, 20);
}

function buildPortfolioContext(args: {
  portfolioOverview: Awaited<ReturnType<typeof getPortfolioOverview>>;
  ticker: string;
}): TickerReportContext["portfolioContext"] {
  const overview = args.portfolioOverview;
  if (!overview) {
    return null;
  }

  const matching = overview.holdings.filter((holding) =>
    holding.ticker.toUpperCase() === args.ticker.toUpperCase(),
  );

  const totalMarketValueCad = overview.totalMarketValueCad ?? null;
  const matchingMarketValueCad = matching.reduce<number | null>((sum, holding) => {
    if (holding.marketValueCad == null) {
      return sum;
    }

    return (sum ?? 0) + holding.marketValueCad;
  }, null);

  const matchingWeightPercent =
    matchingMarketValueCad != null &&
    totalMarketValueCad != null &&
    totalMarketValueCad > 0
      ? Number(((matchingMarketValueCad / totalMarketValueCad) * 100).toFixed(2))
      : null;

  return {
    portfolioId: overview.portfolio.id,
    baseCurrency: "CAD",
    holdingCount: overview.holdingCount,
    matchingHoldingsCount: matching.length,
    matchingHoldingIds: matching.map((holding) => holding.id),
    matchingMarketValueCad,
    matchingWeightPercent,
  };
}

function buildWatchlistContext(args: {
  watchlist: Awaited<ReturnType<typeof getWatchlistWithItems>>;
  ticker: string;
}): TickerReportContext["watchlistContext"] {
  const watchlist = args.watchlist;
  if (!watchlist) {
    return null;
  }

  const matchingItems = watchlist.items.filter(
    (item) => item.stock.ticker.toUpperCase() === args.ticker.toUpperCase(),
  );

  return {
    watchlistId: watchlist.id,
    watchlistName: watchlist.name,
    itemCount: watchlist.items.length,
    matchingItemsCount: matchingItems.length,
    matchingStatuses: normalizeTextList(matchingItems.map((item) => item.status), 10),
    matchingPriorities: normalizeTextList(matchingItems.map((item) => item.priority), 10),
    thesisSamples: normalizeTextList(matchingItems.map((item) => item.thesis), 3),
  };
}

function buildDataGaps(args: {
  qualityMissing: string[];
  qualityStale: string[];
  bundle: NonNullable<Awaited<ReturnType<typeof getStockResearchBundle>>>;
  options: TickerReportContextBuildOptions;
}): string[] {
  const gaps: string[] = [];
  gaps.push(...args.qualityMissing.map((item) => `Missing ${item} data.`));
  gaps.push(...args.qualityStale);

  if (includeOptionEnabled(args.options.includeNews) && args.bundle.recentNews.length === 0) {
    gaps.push("No recent news context is available.");
  }

  if (includeOptionEnabled(args.options.includeAnalyst)) {
    if (!args.bundle.latestAnalystSnapshot && args.bundle.recentAnalystActions.length === 0) {
      gaps.push("No analyst snapshot or recent analyst actions are available.");
    }
  }

  if (!args.bundle.latestPriceSnapshot) {
    gaps.push("No price snapshot is available for this ticker.");
  }

  return normalizeTextList(gaps, 20);
}

export async function buildTickerReportContext(
  ticker: string,
  options: TickerReportContextBuildOptions = {},
): Promise<TickerReportContext> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  const [bundle, dataQuality, deterministicScore, newsSummary] = await Promise.all([
    getStockResearchBundle(normalizedTicker),
    getTickerDataQuality(normalizedTicker),
    includeOptionEnabled(options.includeScore)
      ? scoreTickerResearch(normalizedTicker).catch(() => null)
      : Promise.resolve(null),
    includeOptionEnabled(options.includeNews)
      ? getNewsSentimentSummary(normalizedTicker, 30).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!bundle) {
    throw new Error("Unable to build stock research bundle.");
  }

  const [macroSummary, geopoliticalSummary, portfolioOverview, watchlistWithItems] = await Promise.all([
    includeOptionEnabled(options.includeMacro)
      ? buildMacroSummary().catch(() => "Macro context unavailable.")
      : Promise.resolve(null),
    includeOptionEnabled(options.includeGeopolitical)
      ? getGeopoliticalSummary({ days: 7, limit: 100 }).catch(() => null)
      : Promise.resolve(null),
    options.portfolioId ? getPortfolioOverview(options.portfolioId) : Promise.resolve(null),
    options.watchlistId ? getWatchlistWithItems(options.watchlistId) : Promise.resolve(null),
  ]);

  const topHeadlines = includeOptionEnabled(options.includeNews)
    ? bundle.recentNews
      .slice(0, 5)
      .map((article) => ({
        headline: article.headline,
        publishedAt: article.publishedAt.toISOString(),
        source: article.source ?? null,
        sentiment: article.sentiment ?? null,
        sentimentScore: article.sentimentScore ?? null,
        materialityScore: article.materialityScore ?? null,
      }))
    : [];

  const dataQualityConfidence = mapDataQualityConfidence(
    dataQuality.missingData,
    dataQuality.staleDataWarnings,
  );

  const dataGaps = buildDataGaps({
    qualityMissing: dataQuality.missingData,
    qualityStale: dataQuality.staleDataWarnings,
    bundle,
    options,
  });

  return {
    ticker: normalizedTicker,
    companyName: stock.companyName ?? null,
    exchange: stock.exchange ?? null,
    currency: stock.currency ?? null,
    asOf: new Date().toISOString(),
    dataQuality: {
      missingData: dataQuality.missingData,
      staleDataWarnings: dataQuality.staleDataWarnings,
      confidence: dataQualityConfidence,
    },
    marketSnapshot: bundle.latestPriceSnapshot
      ? {
          price: bundle.latestPriceSnapshot.price ?? null,
          previousClose: bundle.latestPriceSnapshot.previousClose ?? null,
          changePercent:
            bundle.latestPriceSnapshot.changePercent ??
            (bundle.latestPriceSnapshot.previousClose
              ? ((bundle.latestPriceSnapshot.price - bundle.latestPriceSnapshot.previousClose) /
                  bundle.latestPriceSnapshot.previousClose) *
                100
              : null),
          open: bundle.latestPriceSnapshot.open ?? null,
          high: bundle.latestPriceSnapshot.high ?? null,
          low: bundle.latestPriceSnapshot.low ?? null,
          volume: stringifyBigInt(bundle.latestPriceSnapshot.volume),
          marketCap: stringifyBigInt(bundle.latestPriceSnapshot.marketCap),
          capturedAt: toIsoOrNull(bundle.latestPriceSnapshot.capturedAt),
          source: bundle.latestPriceSnapshot.source ?? null,
        }
      : null,
    technicalSnapshot: bundle.latestTechnicalSnapshot
      ? {
          trendDirection: bundle.latestTechnicalSnapshot.trendDirection ?? null,
          sma20: bundle.latestTechnicalSnapshot.sma20 ?? null,
          sma50: bundle.latestTechnicalSnapshot.sma50 ?? null,
          sma200: bundle.latestTechnicalSnapshot.sma200 ?? null,
          rsi14: bundle.latestTechnicalSnapshot.rsi14 ?? null,
          macd: bundle.latestTechnicalSnapshot.macd ?? null,
          macdSignal: bundle.latestTechnicalSnapshot.macdSignal ?? null,
          macdHistogram: bundle.latestTechnicalSnapshot.macdHistogram ?? null,
          volatility: null,
          capturedAt: toIsoOrNull(bundle.latestTechnicalSnapshot.capturedAt),
        }
      : null,
    fundamentalSnapshot: bundle.latestFundamentalSnapshot
      ? {
          peRatio: bundle.latestFundamentalSnapshot.peRatio ?? null,
          forwardPeRatio: bundle.latestFundamentalSnapshot.forwardPeRatio ?? null,
          pegRatio: bundle.latestFundamentalSnapshot.pegRatio ?? null,
          priceToSales: bundle.latestFundamentalSnapshot.priceToSales ?? null,
          priceToBook: bundle.latestFundamentalSnapshot.priceToBook ?? null,
          evToEbitda: bundle.latestFundamentalSnapshot.evToEbitda ?? null,
          eps: bundle.latestFundamentalSnapshot.eps ?? null,
          revenueGrowth: bundle.latestFundamentalSnapshot.revenueGrowth ?? null,
          grossMargin: bundle.latestFundamentalSnapshot.grossMargin ?? null,
          operatingMargin: bundle.latestFundamentalSnapshot.operatingMargin ?? null,
          netMargin: bundle.latestFundamentalSnapshot.netMargin ?? null,
          debtToEquity: bundle.latestFundamentalSnapshot.debtToEquity ?? null,
          currentRatio: bundle.latestFundamentalSnapshot.currentRatio ?? null,
          freeCashFlow: stringifyBigInt(bundle.latestFundamentalSnapshot.freeCashFlow),
          dividendYield: bundle.latestFundamentalSnapshot.dividendYield ?? null,
          analystConsensus: bundle.latestFundamentalSnapshot.analystConsensus ?? null,
          capturedAt: toIsoOrNull(bundle.latestFundamentalSnapshot.capturedAt),
          source: bundle.latestFundamentalSnapshot.source ?? null,
        }
      : null,
    analystContext: includeOptionEnabled(options.includeAnalyst) && bundle.latestAnalystSnapshot
      ? {
          ratingConsensus: bundle.latestAnalystSnapshot.ratingConsensus ?? null,
          analystCount: bundle.latestAnalystSnapshot.analystCount ?? null,
          priceTargetAverage: bundle.latestAnalystSnapshot.priceTargetAverage ?? null,
          priceTargetHigh: bundle.latestAnalystSnapshot.priceTargetHigh ?? null,
          priceTargetLow: bundle.latestAnalystSnapshot.priceTargetLow ?? null,
          priceTargetConsensus: bundle.latestAnalystSnapshot.priceTargetConsensus ?? null,
          targetMedian: bundle.latestAnalystSnapshot.targetMedian ?? null,
          upsidePercent: bundle.latestAnalystSnapshot.upsidePercent ?? null,
          strongBuyCount: bundle.latestAnalystSnapshot.strongBuyCount ?? null,
          buyCount: bundle.latestAnalystSnapshot.buyCount ?? null,
          holdCount: bundle.latestAnalystSnapshot.holdCount ?? null,
          sellCount: bundle.latestAnalystSnapshot.sellCount ?? null,
          strongSellCount: bundle.latestAnalystSnapshot.strongSellCount ?? null,
          capturedAt: toIsoOrNull(bundle.latestAnalystSnapshot.capturedAt),
          source: bundle.latestAnalystSnapshot.source ?? null,
        }
      : null,
    recentAnalystActions: includeOptionEnabled(options.includeAnalyst)
      ? bundle.recentAnalystActions
        .slice(0, 10)
        .map((action) => ({
          actionType: action.actionType,
          firm: action.firm ?? null,
          newRating: action.newRating ?? null,
          previousRating: action.previousRating ?? null,
          newPriceTarget: action.newPriceTarget ?? null,
          previousPriceTarget: action.previousPriceTarget ?? null,
          eventDate: action.eventDate.toISOString(),
        }))
      : [],
    analystEstimates: {
      latestAnnual: includeOptionEnabled(options.includeAnalyst)
        ? bundle.latestAnnualAnalystEstimate ?? null
        : null,
      latestQuarter: includeOptionEnabled(options.includeAnalyst)
        ? bundle.latestQuarterAnalystEstimate ?? null
        : null,
    },
    fmpFinancialRating: includeOptionEnabled(options.includeAnalyst)
      ? bundle.fmpFinancialRating ?? null
      : null,
    newsContext: includeOptionEnabled(options.includeNews)
      ? {
          totalArticles: newsSummary?.totalArticles ?? bundle.recentNews.length,
          bullishCount: newsSummary?.bullishCount ?? 0,
          bearishCount: newsSummary?.bearishCount ?? 0,
          neutralCount: newsSummary?.neutralCount ?? 0,
          mixedCount: newsSummary?.mixedCount ?? 0,
          averageSentimentScore: newsSummary?.averageSentimentScore ?? null,
          averageMaterialityScore: newsSummary?.averageMaterialityScore ?? null,
          topHeadlines,
        }
      : null,
    earningsContext: bundle.nextEarningsEvent
      ? {
          nextEarningsDate: toIsoOrNull(bundle.nextEarningsEvent.earningsDate),
          earningsTime: bundle.nextEarningsEvent.earningsTime ?? null,
          estimatedEps: bundle.nextEarningsEvent.estimatedEps ?? null,
          estimatedRevenue: stringifyBigInt(bundle.nextEarningsEvent.estimatedRevenue),
          fiscalQuarter: bundle.nextEarningsEvent.fiscalQuarter ?? null,
          fiscalYear: bundle.nextEarningsEvent.fiscalYear ?? null,
          isDateConfirmed: bundle.nextEarningsEvent.isDateConfirmed ?? null,
        }
      : null,
    macroContext: includeOptionEnabled(options.includeMacro)
      ? {
          summary: macroSummary ?? "Macro context unavailable.",
        }
      : null,
    geopoliticalContext: includeOptionEnabled(options.includeGeopolitical)
      ? geopoliticalSummary
      : null,
    portfolioContext: options.portfolioId
      ? buildPortfolioContext({ portfolioOverview, ticker: normalizedTicker })
      : undefined,
    watchlistContext: options.watchlistId
      ? buildWatchlistContext({ watchlist: watchlistWithItems, ticker: normalizedTicker })
      : undefined,
    deterministicScore,
  } satisfies TickerReportContext;
}

function mapOpenAiReportToPersistence(args: {
  modelReport: OpenAiTickerReportOutput;
  context: TickerReportContext;
  stockId: string;
  holdingId: string | null;
  modelName: string;
  warnings: string[];
  fallbackUsed: boolean;
}): Parameters<typeof createOrUpdateDailyReport>[0] {
  const recommendation = mapOpenAiRecommendation(args.modelReport.recommendation, args.warnings);
  const sentiment = mapOpenAiSentiment(recommendation, args.modelReport);
  const confidenceScore = mapConvictionToConfidence(
    args.modelReport.conviction,
    args.context.dataQuality.confidence,
    args.modelReport.dataGaps.length,
  );
  const currentPrice = args.context.marketSnapshot?.price ?? null;
  const dailyChangePercent = args.context.marketSnapshot?.changePercent ?? null;
  const riskScore = mapOpenAiRiskScore({
    recommendation,
    conviction: args.modelReport.conviction,
    dataQualityConfidence: args.context.dataQuality.confidence,
    dailyChangePercent,
  });

  const scoreSummary = args.modelReport.scoreSummary;
  const shortTermOutlook = joinNotesOrNull([
    ...args.modelReport.watchItems,
    ...args.modelReport.keyCatalysts,
  ]);
  const mediumTermOutlook = joinNotesOrNull([
    ...args.modelReport.bullCase,
    ...args.modelReport.bearCase,
  ]);
  const longTermOutlook = joinNotesOrNull([
    ...args.modelReport.valuationNotes,
    ...args.modelReport.macroGeopoliticalNotes,
  ]);

  const technicalSummary = joinNotesOrNull(args.modelReport.technicalNotes);
  const fundamentalSummary = joinNotesOrNull(args.modelReport.valuationNotes);
  const newsSummary = joinNotesOrNull(args.modelReport.newsSentimentNotes);
  const earningsSummary = joinNotesOrNull(args.modelReport.earningsNotes);
  const macroGeopoliticalSummary = joinNotesOrNull(args.modelReport.macroGeopoliticalNotes);

  return {
    stockId: args.stockId,
    holdingId: args.holdingId,
    reportDate: new Date(),
    recommendation,
    sentiment,
    confidenceScore,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    currentPrice,
    dailyChangePercent,
    shortTermOutlook,
    mediumTermOutlook,
    longTermOutlook,
    keyTakeaway: args.modelReport.executiveSummary,
    bullishFactors: args.modelReport.bullCase,
    bearishFactors: args.modelReport.bearCase,
    technicalSummary,
    fundamentalSummary,
    newsSummary,
    earningsSummary,
    macroGeopoliticalSummary,
    whatChanged: joinNotesOrNull([
      ...args.modelReport.keyCatalysts,
      ...args.modelReport.analystNotes,
      ...args.modelReport.watchItems,
    ]),
    whatWouldChangeRecommendation: joinNotesOrNull(args.modelReport.suggestedNextActions),
    sourceReferences: {
      reportMode: "OPENAI_STRUCTURED",
      fallbackUsed: args.fallbackUsed,
      dataQualityConfidence: args.context.dataQuality.confidence,
      dataQualityMissingData: args.context.dataQuality.missingData,
      dataQualityStaleDataWarnings: args.context.dataQuality.staleDataWarnings,
      disclaimer: args.modelReport.disclaimer,
      generatedAsOf: args.modelReport.asOf,
    },
    modelName: args.modelName,
    promptVersion: OPENAI_REPORT_PROMPT_VERSION,
    rawModelOutput: {
      reportMode: "OPENAI_STRUCTURED",
      mappedRecommendation: recommendation,
      openAiOutput: args.modelReport,
      scoreSummary: {
        compositeScore: scoreSummary.compositeScore,
        technicalScore: scoreSummary.technicalScore,
        fundamentalScore: scoreSummary.fundamentalScore,
        valuationScore: scoreSummary.valuationScore,
        analystScore: scoreSummary.analystScore,
        newsScore: scoreSummary.newsScore,
        dataQualityScore: scoreSummary.dataQualityScore,
      },
      contextSummary: {
        asOf: args.context.asOf,
        marketSnapshotCapturedAt: args.context.marketSnapshot?.capturedAt ?? null,
        technicalSnapshotCapturedAt: args.context.technicalSnapshot?.capturedAt ?? null,
        fundamentalSnapshotCapturedAt: args.context.fundamentalSnapshot?.capturedAt ?? null,
      },
    },
  };
}

async function attemptOpenAiReport(args: {
  context: TickerReportContext;
  stockId: string;
  holdingId: string | null;
}): Promise<{
  report: AIReport;
  reportMode: TickerReportMode;
  fallbackUsed: boolean;
  warnings: string[];
  dataGaps: string[];
  modelName?: string;
} | null> {
  try {
    const generated = await generateOpenAiTickerReport({
      context: args.context,
    });

    const warnings: string[] = [];
    const payload = mapOpenAiReportToPersistence({
      modelReport: generated.report,
      context: args.context,
      stockId: args.stockId,
      holdingId: args.holdingId,
      modelName: generated.modelName,
      warnings,
      fallbackUsed: generated.usedFallbackModel,
    });

    const report = await createOrUpdateDailyReport(payload);
    return {
      report,
      reportMode: "OPENAI_STRUCTURED",
      fallbackUsed: generated.usedFallbackModel,
      warnings,
      dataGaps: normalizeTextList(
        [...args.context.dataQuality.missingData, ...generated.report.dataGaps],
        20,
      ),
      modelName: generated.modelName,
    };
  } catch (error) {
    if (error instanceof OpenAiAgentClientError) {
      return {
        report: null as never,
        reportMode: "DETERMINISTIC_FALLBACK",
        fallbackUsed: true,
        warnings: [summarizeOpenAiFailure(error)],
        dataGaps: normalizeTextList(args.context.dataQuality.missingData, 20),
        modelName: undefined,
      };
    }

    return {
      report: null as never,
      reportMode: "DETERMINISTIC_FALLBACK",
      fallbackUsed: true,
      warnings: [
        `OpenAI report generation failed unexpectedly: ${toWarningMessage(error)}. Deterministic fallback used.`,
      ],
      dataGaps: normalizeTextList(args.context.dataQuality.missingData, 20),
      modelName: undefined,
    };
  }
}

export async function generateTickerReport(
  ticker: string,
  options: TickerReportGenerationOptions = {},
): Promise<TickerReportGenerationResult> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  const holding = options.holdingId ? await getHoldingWithStock(options.holdingId) : null;
  if (options.holdingId && !holding) {
    throw new Error("Holding not found.");
  }

  if (holding && holding.stockId !== stock.id) {
    throw new Error("Holding does not match ticker.");
  }

  const refreshWarnings = options.refreshBeforeGenerate
    ? await refreshTickerResearchData(normalizedTicker)
    : [];

  const context = await buildTickerReportContext(normalizedTicker, {
    portfolioId: options.portfolioId,
    watchlistId: options.watchlistId,
    includeMacro: options.includeMacro,
    includeGeopolitical: options.includeGeopolitical,
    includeNews: options.includeNews,
    includeAnalyst: options.includeAnalyst,
    includeScore: options.includeScore,
  });

  const useOpenAi = options.useOpenAi === true && Boolean(env.OPENAI_API_KEY);
  const warnings = [...refreshWarnings];

  let reportMode: TickerReportMode = "DETERMINISTIC_FALLBACK";
  let fallbackUsed = false;
  let modelName: string | undefined;
  let report: AIReport | null = null;

  if (options.useOpenAi === true && !env.OPENAI_API_KEY) {
    warnings.push("OpenAI requested but OPENAI_API_KEY is not configured; deterministic fallback used.");
    fallbackUsed = true;
  }

  if (useOpenAi) {
    const openAiResult = await attemptOpenAiReport({
      context,
      stockId: stock.id,
      holdingId: holding?.id ?? null,
    });

    if (openAiResult?.report) {
      report = openAiResult.report;
      reportMode = openAiResult.reportMode;
      fallbackUsed = openAiResult.fallbackUsed;
      modelName = openAiResult.modelName;
      warnings.push(...openAiResult.warnings);
    } else {
      fallbackUsed = true;
      warnings.push(...(openAiResult?.warnings ?? []));
    }
  }

  if (!report) {
    const fallbackResult = await generateMockTickerReport(normalizedTicker, holding?.id);
    report = fallbackResult.report;
    reportMode = "DETERMINISTIC_FALLBACK";
    modelName = report.modelName ?? "deterministic-mock-service";
  }

  let predictions: Prediction[] = [];
  if (options.createPredictions !== false) {
    const startingPrice =
      report.currentPrice ?? context.marketSnapshot?.price ?? null;

    if (startingPrice != null && startingPrice > 0) {
      predictions = await createPredictionsForReport(
        report,
        startingPrice,
        directionFromRecommendation(report.recommendation, report.dailyChangePercent),
      );
    } else {
      warnings.push("Predictions were skipped because no positive starting price was available.");
    }
  }

  return {
    report,
    predictions,
    reportMode,
    fallbackUsed,
    warnings: normalizeTextList(warnings, 20),
    dataGaps: normalizeTextList(
      [...context.dataQuality.missingData, ...context.dataQuality.staleDataWarnings],
      20,
    ),
    modelName,
  };
}

export async function generateMockTickerReport(
  ticker: string,
  holdingId?: string,
): Promise<TickerReportGenerationResult> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  const holding = holdingId ? await getHoldingWithStock(holdingId) : null;
  if (holdingId && !holding) {
    throw new Error("Holding not found.");
  }

  if (holding && holding.stockId !== stock.id) {
    throw new Error("Holding does not match ticker.");
  }

  const bundle = await getStockResearchBundle(normalizedTicker);
  if (!bundle) {
    throw new Error("Unable to build stock research bundle.");
  }

  if (!bundle.latestPriceSnapshot) {
    throw new Error(
      "Cannot generate report without at least one price snapshot for this ticker.",
    );
  }

  const newsSummary = await getNewsSentimentSummary(normalizedTicker, 30);
  const recentNews = await listRecentNewsByTicker(normalizedTicker, 30);
  const realNews = recentNews.filter((article) => !isDemoNewsArticle(article));
  const demoNews = recentNews.filter((article) => isDemoNewsArticle(article));

  const realNewsSummary = {
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    mixedCount: 0,
  };

  if (realNews.length > 0) {
    for (const article of realNews) {
      if (article.sentiment === Sentiment.BULLISH) {
        realNewsSummary.bullishCount += 1;
      } else if (article.sentiment === Sentiment.BEARISH) {
        realNewsSummary.bearishCount += 1;
      } else if (article.sentiment === Sentiment.MIXED) {
        realNewsSummary.mixedCount += 1;
      } else {
        realNewsSummary.neutralCount += 1;
      }
    }
  }

  const bullishNewsCount =
    realNews.length > 0 ? realNewsSummary.bullishCount : newsSummary.bullishCount;
  const bearishNewsCount =
    realNews.length > 0 ? realNewsSummary.bearishCount : newsSummary.bearishCount;

  let score = 0;
  const bullishFactors: string[] = [];
  const bearishFactors: string[] = [];
  const dataWarnings: string[] = [];
  let evidenceCount = 0;
  let fundamentalSummary = "Fundamental snapshot missing.";

  const dailyChange =
    bundle.latestPriceSnapshot.changePercent ??
    (bundle.latestPriceSnapshot.previousClose
      ? ((bundle.latestPriceSnapshot.price -
          bundle.latestPriceSnapshot.previousClose) /
          bundle.latestPriceSnapshot.previousClose) *
        100
      : null);

  const technical = normalizeTechnicalSnapshot(bundle.latestTechnicalSnapshot);
  const trendDirection = technical.trendDirection;
  const currentPrice = bundle.latestPriceSnapshot.price;

  if (dailyChange != null) {
    evidenceCount += 1;

    if (dailyChange >= 1) {
      score += 2;
      bullishFactors.push("Positive recent price momentum.");
    } else if (dailyChange <= -1) {
      score -= 2;
      bearishFactors.push("Negative recent price momentum.");
    }
  } else {
    dataWarnings.push("Missing daily price-change context.");
  }

  let hasTechnicalSignal = false;

  if (trendDirection) {
    hasTechnicalSignal = true;

    if (trendDirection === "STRONG_UPTREND") {
      score += 3;
      bullishFactors.push("Trend structure indicates strong uptrend.");
    } else if (trendDirection === "UPTREND") {
      score += 2;
      bullishFactors.push("Trend structure indicates uptrend.");
    } else if (trendDirection === "DOWNTREND") {
      score -= 2;
      bearishFactors.push("Trend structure indicates downtrend.");
    } else if (trendDirection === "STRONG_DOWNTREND") {
      score -= 3;
      bearishFactors.push("Trend structure indicates strong downtrend.");
    }
  }

  if (!technical.exists) {
    dataWarnings.push("Missing technical trend snapshot.");
  }

  if (technical.sma50 != null) {
    hasTechnicalSignal = true;
    if (currentPrice > technical.sma50) {
      score += 1;
      bullishFactors.push("Price is trading above the 50-day moving average.");
    } else if (currentPrice < technical.sma50) {
      score -= 1;
      bearishFactors.push("Price is trading below the 50-day moving average.");
    }
  }

  if (technical.sma200 != null) {
    hasTechnicalSignal = true;
    if (currentPrice > technical.sma200) {
      score += 1;
      bullishFactors.push("Price is trading above the 200-day moving average.");
    } else if (currentPrice < technical.sma200) {
      score -= 1;
      bearishFactors.push("Price is trading below the 200-day moving average.");
    }
  }

  if (technical.rsi != null) {
    hasTechnicalSignal = true;

    if (technical.rsi > 70) {
      score -= 1;
      bearishFactors.push("RSI indicates overbought conditions.");
    } else if (technical.rsi < 30) {
      score -= 1;
      bearishFactors.push("RSI indicates oversold conditions and weak momentum.");
    } else if (technical.rsi >= 45 && technical.rsi <= 65) {
      score += 1;
      bullishFactors.push("RSI is in a balanced momentum range.");
    }
  }

  if (technical.macd != null && technical.macdSignal != null) {
    hasTechnicalSignal = true;

    if (technical.macd > technical.macdSignal) {
      score += 1;
      bullishFactors.push("MACD is above its signal line.");
    } else if (technical.macd < technical.macdSignal) {
      score -= 1;
      bearishFactors.push("MACD is below its signal line.");
    }
  } else if (technical.macdHistogram != null) {
    hasTechnicalSignal = true;

    if (technical.macdHistogram > 0) {
      score += 1;
      bullishFactors.push("MACD histogram is positive.");
    } else if (technical.macdHistogram < 0) {
      score -= 1;
      bearishFactors.push("MACD histogram is negative.");
    }
  }

  if (hasTechnicalSignal) {
    evidenceCount += 1;
  }

  const fundamentals = bundle.latestFundamentalSnapshot;
  if (fundamentals) {
    evidenceCount += 1;

    const valuationNotes: string[] = [];
    const profitabilityNotes: string[] = [];
    const healthNotes: string[] = [];

    if (fundamentals.revenueGrowth != null) {
      profitabilityNotes.push(
        `Revenue growth ${(fundamentals.revenueGrowth * 100).toFixed(1)}%`,
      );

      if (fundamentals.revenueGrowth > 0) {
        score += 1;
        bullishFactors.push("Positive revenue growth supports the business trajectory.");
      } else if (fundamentals.revenueGrowth < 0) {
        score -= 1;
        bearishFactors.push("Revenue growth is negative.");
      }
    }

    if (fundamentals.peRatio != null) {
      valuationNotes.push(`P/E ${fundamentals.peRatio.toFixed(1)}`);

      if (fundamentals.peRatio > 45 && (fundamentals.revenueGrowth ?? 0) <= 0.05) {
        score -= 1;
        bearishFactors.push("Valuation looks stretched relative to weak growth.");
      } else if (
        fundamentals.peRatio > 0 &&
        fundamentals.peRatio < 30 &&
        (fundamentals.revenueGrowth ?? 0) > 0
      ) {
        score += 1;
        bullishFactors.push("Valuation appears reasonable for the growth profile.");
      }
    }

    if (fundamentals.pegRatio != null) {
      valuationNotes.push(`PEG ${fundamentals.pegRatio.toFixed(2)}`);
    }

    if (fundamentals.evToEbitda != null) {
      valuationNotes.push(`EV/EBITDA ${fundamentals.evToEbitda.toFixed(2)}`);
    }

    if (fundamentals.grossMargin != null) {
      profitabilityNotes.push(`Gross margin ${(fundamentals.grossMargin * 100).toFixed(1)}%`);

      if (fundamentals.grossMargin >= 0.4) {
        score += 1;
        bullishFactors.push("Gross margin profile is healthy.");
      } else if (fundamentals.grossMargin < 0.2) {
        score -= 1;
        bearishFactors.push("Gross margin profile appears weak.");
      }
    }

    if (fundamentals.operatingMargin != null) {
      profitabilityNotes.push(
        `Operating margin ${(fundamentals.operatingMargin * 100).toFixed(1)}%`,
      );
    }

    if (fundamentals.netMargin != null) {
      profitabilityNotes.push(`Net margin ${(fundamentals.netMargin * 100).toFixed(1)}%`);

      if (fundamentals.netMargin >= 0.1) {
        score += 1;
        bullishFactors.push("Net margin indicates solid profitability.");
      } else if (fundamentals.netMargin < 0) {
        score -= 1;
        bearishFactors.push("Net margin is currently negative.");
      }
    }

    if (fundamentals.debtToEquity != null) {
      healthNotes.push(`Debt/Equity ${fundamentals.debtToEquity.toFixed(2)}`);

      if (fundamentals.debtToEquity <= 1) {
        score += 1;
        bullishFactors.push("Debt-to-equity appears manageable.");
      } else if (fundamentals.debtToEquity > 2) {
        score -= 1;
        bearishFactors.push("Leverage is relatively high (debt-to-equity).");
      }
    }

    if (fundamentals.freeCashFlow != null) {
      const freeCashFlowState =
        fundamentals.freeCashFlow > 0
          ? "positive"
          : fundamentals.freeCashFlow < 0
            ? "negative"
            : "flat";

      healthNotes.push(`Free cash flow ${freeCashFlowState}`);

      if (fundamentals.freeCashFlow > 0) {
        score += 1;
        bullishFactors.push("Free cash flow remains positive.");
      } else if (fundamentals.freeCashFlow < 0) {
        score -= 1;
        bearishFactors.push("Free cash flow is negative.");
      }
    }

    if (fundamentals.currentRatio != null) {
      healthNotes.push(`Current ratio ${fundamentals.currentRatio.toFixed(2)}`);
    }

    if (fundamentals.dividendYield != null) {
      healthNotes.push(`Dividend yield ${(fundamentals.dividendYield * 100).toFixed(2)}%`);
    }

    if (fundamentals.priceToSales != null) {
      valuationNotes.push(`P/S ${fundamentals.priceToSales.toFixed(2)}`);
    }

    if (fundamentals.priceToBook != null) {
      valuationNotes.push(`P/B ${fundamentals.priceToBook.toFixed(2)}`);
    }

    if (fundamentals.analystConsensus) {
      valuationNotes.push(`Analyst consensus ${fundamentals.analystConsensus}`);
    }

    fundamentalSummary = `Valuation: ${
      valuationNotes.length > 0 ? valuationNotes.join(", ") : "limited valuation data"
    }. Profitability: ${
      profitabilityNotes.length > 0
        ? profitabilityNotes.join(", ")
        : "limited profitability data"
    }. Financial health: ${
      healthNotes.length > 0 ? healthNotes.join(", ") : "limited balance-sheet and cash-flow data"
    }.`;
  } else {
    dataWarnings.push("Missing fundamental snapshot.");
    fundamentalSummary =
      "Fundamental snapshot missing, reducing confidence in valuation/profitability/health assessment.";
  }

  if (newsSummary.totalArticles > 0) {
    evidenceCount += 1;

    if (bullishNewsCount > bearishNewsCount) {
      score += 1;
      bullishFactors.push("Recent news sentiment skews bullish.");
    } else if (bearishNewsCount > bullishNewsCount) {
      score -= 1;
      bearishFactors.push("Recent news sentiment skews bearish.");
    }
  } else {
    dataWarnings.push("No recent news articles were found.");
  }

  if (bundle.nextEarningsEvent?.earningsDate) {
    evidenceCount += 1;

    const daysUntilEarnings = Math.ceil(
      (bundle.nextEarningsEvent.earningsDate.getTime() - Date.now()) /
        (1000 * 60 * 60 * 24),
    );

    if (daysUntilEarnings <= 7) {
      bearishFactors.push("Upcoming earnings event may increase volatility.");
    }
  }

  const analystSummary = buildAnalystSummary({
    currentPrice,
    snapshot: bundle.latestAnalystSnapshot,
    actions: bundle.recentAnalystActions,
    latestAnnualEstimate: bundle.latestAnnualAnalystEstimate,
    latestQuarterEstimate: bundle.latestQuarterAnalystEstimate,
  });

  if (bundle.latestAnalystSnapshot || bundle.recentAnalystActions.length > 0) {
    evidenceCount += 1;

    const targetConsensus =
      bundle.latestAnalystSnapshot?.priceTargetConsensus ??
      bundle.latestAnalystSnapshot?.priceTargetAverage;
    const impliedUpside =
      bundle.latestAnalystSnapshot?.upsidePercent ??
      (targetConsensus != null && currentPrice > 0
        ? ((targetConsensus - currentPrice) / currentPrice) * 100
        : null);

    if (impliedUpside != null) {
      if (impliedUpside >= 10) {
        score += 1;
        bullishFactors.push("Analyst price targets imply meaningful upside.");
      } else if (impliedUpside <= -10) {
        score -= 1;
        bearishFactors.push("Analyst price targets imply downside risk.");
      }
    }

    const ratingConsensus = bundle.latestAnalystSnapshot?.ratingConsensus?.toLowerCase() ?? "";
    if (
      ratingConsensus.includes("strong buy") ||
      ratingConsensus.includes("buy") ||
      ratingConsensus.includes("outperform") ||
      ratingConsensus.includes("overweight")
    ) {
      score += 1;
      bullishFactors.push("Analyst rating consensus is constructive.");
    } else if (
      ratingConsensus.includes("strong sell") ||
      ratingConsensus.includes("sell") ||
      ratingConsensus.includes("underperform") ||
      ratingConsensus.includes("underweight")
    ) {
      score -= 1;
      bearishFactors.push("Analyst rating consensus is cautious.");
    }

    if (bundle.recentAnalystActions.length > 0) {
      const recentAnalystActions = bundle.recentAnalystActions.slice(0, 10);
      const upgrades = recentAnalystActions.filter((action) =>
        action.actionType.toUpperCase().includes("UPGRADE"),
      ).length;
      const downgrades = recentAnalystActions.filter((action) =>
        action.actionType.toUpperCase().includes("DOWNGRADE"),
      ).length;

      if (upgrades > downgrades) {
        score += 1;
        bullishFactors.push("Recent analyst actions tilt toward upgrades.");
      } else if (downgrades > upgrades) {
        score -= 1;
        bearishFactors.push("Recent analyst actions tilt toward downgrades.");
      }
    }
  } else {
    dataWarnings.push("No analyst snapshot/actions available.");
  }

  fundamentalSummary = `${fundamentalSummary} Analyst context: ${analystSummary}`;

  const sparseData = evidenceCount < 3;
  if (sparseData) {
    bearishFactors.push("Limited data coverage lowers conviction.");
    score -= 1;
  }

  let sentiment: Sentiment;
  if (score >= 3) {
    sentiment = Sentiment.BULLISH;
  } else if (score <= -3) {
    sentiment = Sentiment.BEARISH;
  } else if (bullishFactors.length > 0 && bearishFactors.length > 0) {
    sentiment = Sentiment.MIXED;
  } else {
    sentiment = Sentiment.NEUTRAL;
  }

  let recommendation: Recommendation;
  if (sparseData || (holding?.status !== HoldingStatus.OWNED && Math.abs(score) < 3)) {
    recommendation = Recommendation.WATCH;
  } else if (score >= 4) {
    recommendation = Recommendation.BUY;
  } else if (score <= -4) {
    recommendation = Recommendation.SELL;
  } else if (holding?.status === HoldingStatus.OWNED) {
    recommendation = Recommendation.HOLD;
  } else {
    recommendation = Recommendation.WATCH;
  }

  let riskScore = 40;

  if (trendDirection === "DOWNTREND") {
    riskScore += 12;
  } else if (trendDirection === "STRONG_DOWNTREND") {
    riskScore += 18;
  } else if (trendDirection === "UPTREND") {
    riskScore -= 5;
  } else if (trendDirection === "STRONG_UPTREND") {
    riskScore -= 8;
  }

  if (bearishNewsCount > bullishNewsCount) {
    riskScore += 8;
  } else if (bullishNewsCount > bearishNewsCount) {
    riskScore -= 4;
  }

  if (dailyChange != null && Math.abs(dailyChange) >= 5) {
    riskScore += 10;
  }

  if (fundamentals?.debtToEquity != null && fundamentals.debtToEquity > 2) {
    riskScore += 8;
  }

  riskScore += dataWarnings.length * 6;
  riskScore = clamp(riskScore, 5, 95);

  let confidenceScore =
    0.35 + evidenceCount * 0.1 + Math.min(Math.abs(score), 8) * 0.03;
  confidenceScore -= dataWarnings.length * 0.05;
  if (!fundamentals) {
    confidenceScore -= 0.08;
  }
  confidenceScore = clamp(confidenceScore, 0.1, 0.95);

  const riskLevel = riskLevelFromScore(riskScore);
  const shortTermOutlook =
    score > 0 ? "Constructive short-term setup." : "Cautious short-term setup.";
  const mediumTermOutlook =
    recommendation === Recommendation.BUY
      ? "Momentum and trend support medium-term upside bias."
      : recommendation === Recommendation.SELL
        ? "Risk profile suggests defensive medium-term posture."
        : "Medium-term setup remains mixed with selective conviction.";
  const longTermOutlook =
    fundamentals?.revenueGrowth != null && fundamentals.revenueGrowth > 0
      ? "Long-term outlook supported by growth trajectory."
      : "Long-term outlook remains uncertain pending stronger fundamentals.";

  const keyTakeaway =
    recommendation === Recommendation.BUY
      ? "Deterministic mock model indicates positive setup with manageable risk."
      : recommendation === Recommendation.SELL
        ? "Deterministic mock model indicates downside risk outweighs upside potential."
        : recommendation === Recommendation.HOLD
          ? "Deterministic mock model supports holding while monitoring risk changes."
          : "Deterministic mock model indicates watchlist stance due to mixed or limited data.";

    const newsSummaryJson = {
      ticker: newsSummary.ticker,
      totalArticles: newsSummary.totalArticles,
      bullishCount: newsSummary.bullishCount,
      bearishCount: newsSummary.bearishCount,
      neutralCount: newsSummary.neutralCount,
      mixedCount: newsSummary.mixedCount,
      averageSentimentScore: newsSummary.averageSentimentScore,
      averageMaterialityScore: newsSummary.averageMaterialityScore,
    };

  const reportDate = new Date();
  const macroSummary = await buildMacroSummary();

  const report = await createOrUpdateDailyReport({
    stockId: stock.id,
    holdingId: holding?.id ?? null,
    reportDate,
    recommendation,
    sentiment,
    confidenceScore,
    riskScore,
    riskLevel,
    currentPrice: bundle.latestPriceSnapshot.price,
    dailyChangePercent: dailyChange,
    shortTermOutlook,
    mediumTermOutlook,
    longTermOutlook,
    keyTakeaway,
    bullishFactors,
    bearishFactors: [...bearishFactors, ...dataWarnings],
    technicalSummary: buildTechnicalSummary({
      technicalExists: technical.exists,
      trendDirection,
      currentPrice,
      sma20: technical.sma20,
      sma50: technical.sma50,
      sma200: technical.sma200,
      rsi: technical.rsi,
      macd: technical.macd,
      macdSignal: technical.macdSignal,
      macdHistogram: technical.macdHistogram,
      volatility: technical.volatility,
    }),
    fundamentalSummary,
    newsSummary:
      buildNewsSummaryText({
        totalArticles: newsSummary.totalArticles,
        realHeadlines: realNews.map((article) => article.headline),
        demoHeadlines: demoNews.map((article) => article.headline),
      }),
    earningsSummary: buildEarningsSummary(bundle.nextEarningsEvent),
    macroGeopoliticalSummary: macroSummary,
    whatChanged: "Generated from deterministic local-data heuristic scoring.",
    whatWouldChangeRecommendation:
      "New price/technical/fundamental/news data may change this deterministic result.",
    sourceReferences: {
      deterministicMock: true,
      source: "local-repository-data-only",
    },
    modelName: "deterministic-mock-service",
    promptVersion: "mock-v1",
    rawModelOutput: {
      score,
      evidenceCount,
      dataWarnings,
      analystSummary,
      newsSummary: newsSummaryJson,
    },
  });

  const predictions = await createPredictionsForReport(
    report,
    bundle.latestPriceSnapshot.price,
    directionFromScore(score),
  );

  return {
    report,
    predictions,
  };
}

export async function getLatestTickerReport(
  ticker: string,
): Promise<AIReportWithStockMetadata | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  const report = await getLatestAIReportByStockId(stock.id);
  if (!report) {
    return null;
  }

  return attachStockMetadataToReport(report, stock);
}

export async function listTickerReports(
  ticker: string,
  limit?: number,
): Promise<AIReportWithStockMetadata[]> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return [];
  }

  const reports = await listAIReportsByStockId(stock.id, normalizeListLimit(limit));
  return reports.map((report) => attachStockMetadataToReport(report, stock));
}

export async function createTickerReportFromInput(
  input: DailyTickerReportInput,
): Promise<TickerReportGenerationResult> {
  const normalizedTicker = normalizeTickerOrThrow(input.ticker);
  const stock = await ensureStockExists(normalizedTicker);

  const holding = input.holdingId ? await getHoldingWithStock(input.holdingId) : null;
  if (input.holdingId && !holding) {
    throw new Error("Holding not found.");
  }

  if (holding && holding.stockId !== stock.id) {
    throw new Error("Holding does not match ticker.");
  }

  const keyTakeaway = assertNonBlank(input.keyTakeaway, "keyTakeaway");

  const report = await createOrUpdateDailyReport({
    stockId: stock.id,
    holdingId: input.holdingId ?? null,
    reportDate: input.reportDate ?? new Date(),
    recommendation: input.recommendation,
    sentiment: input.sentiment,
    confidenceScore: input.confidenceScore,
    riskScore: input.riskScore,
    riskLevel: input.riskLevel,
    currentPrice: input.currentPrice ?? null,
    dailyChangePercent: input.dailyChangePercent ?? null,
    shortTermOutlook: input.shortTermOutlook ?? null,
    mediumTermOutlook: input.mediumTermOutlook ?? null,
    longTermOutlook: input.longTermOutlook ?? null,
    keyTakeaway,
    bullishFactors: input.bullishFactors ?? [],
    bearishFactors: input.bearishFactors ?? [],
    technicalSummary: input.technicalSummary ?? null,
    fundamentalSummary: input.fundamentalSummary ?? null,
    newsSummary: input.newsSummary ?? null,
    earningsSummary: input.earningsSummary ?? null,
    macroGeopoliticalSummary: input.macroGeopoliticalSummary ?? null,
    whatChanged: input.whatChanged ?? "Manual deterministic report input.",
    whatWouldChangeRecommendation:
      input.whatWouldChangeRecommendation ??
      "New data or assumptions may change recommendation.",
    sourceReferences: input.sourceReferences,
    modelName: input.modelName ?? "deterministic-manual-input",
    promptVersion: input.promptVersion ?? "manual-v1",
    rawModelOutput: input.rawModelOutput,
  });

  if (input.createPredictions === false) {
    return {
      report,
      predictions: [],
    };
  }

  const latestSnapshot = await getLatestMarketSnapshotForStock(stock.id);
  const startingPrice = input.currentPrice ?? latestSnapshot?.price ?? null;

  if (startingPrice == null || startingPrice <= 0) {
    throw new Error(
      "Cannot create associated predictions without a positive current or latest market price.",
    );
  }

  const predictions = await createPredictionsForReport(
    report,
    startingPrice,
    directionFromRecommendation(input.recommendation, input.dailyChangePercent),
  );

  return {
    report,
    predictions,
  };
}
