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
import { getLatestPriceSnapshot } from "../repositories/price-snapshots.repository";
import {
  endOfUtcDay,
  normalizeListLimit,
  normalizeTickerOrThrow,
  startOfUtcDay,
} from "../types/common";
import { listRecentNewsByTicker } from "../repositories/news-articles.repository";
import {
  AIReportWithStockMetadata,
  DailyTickerReportInput,
  TickerReportGenerationResult,
} from "../types/services";
import { getNewsSentimentSummary, isDemoNewsArticle } from "./news.service";
import {
  ensureStockExists,
  getStockProfile,
  getStockResearchBundle,
} from "./stocks.service";

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

  const trendDirection = bundle.latestTechnicalSnapshot?.trendDirection ?? null;
  if (trendDirection) {
    evidenceCount += 1;

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
  } else {
    dataWarnings.push("Missing technical trend snapshot.");
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
    technicalSummary: trendDirection
      ? `Trend classified as ${trendDirection}.`
      : "Technical trend unavailable.",
    fundamentalSummary,
    newsSummary:
      buildNewsSummaryText({
        totalArticles: newsSummary.totalArticles,
        realHeadlines: realNews.map((article) => article.headline),
        demoHeadlines: demoNews.map((article) => article.headline),
      }),
    earningsSummary: buildEarningsSummary(bundle.nextEarningsEvent),
    macroGeopoliticalSummary: "No external macro provider connected in this phase.",
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

  const latestSnapshot = await getLatestPriceSnapshot(stock.id);
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
