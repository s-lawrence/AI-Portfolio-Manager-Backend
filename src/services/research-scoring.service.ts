import { HoldingStatus, Sentiment, WatchlistItemStatus } from "@prisma/client";

import {
  type CompareTickersResult,
  type PortfolioDataQualityResult,
  type PortfolioFxIssue,
  type PortfolioConcentrationRisk,
  type PortfolioRiskExposure,
  type PortfolioRiskConversionStatus,
  type PortfolioRiskSnapshotResult,
  type PortfolioOverviewHoldingSummary,
  type SuggestedResearchStance,
  type TickerResearchComponentScores,
  type TickerDataQualityResult,
  type TickerResearchScoreResult,
  type WatchlistDataQualityResult,
  type WatchlistResearchScoreResult,
  type WatchlistResearchItemSummary,
  type WatchlistTickerDataQualityResult,
  type WatchlistSkippedItem,
  type WatchlistScoredItem,
} from "../types/services";
import {
  convertMoneyToCad,
  type ConvertMoneyToCadResult,
} from "./fx-rates.service";
import { getGeopoliticalSummary } from "./geopolitical-ingestion.service";
import { getLatestMacroObservation } from "./macro-series.service";
import { getPortfolioOverview } from "./portfolios.service";
import { getStockResearchBundle } from "./stocks.service";
import { getWatchlistResearchBundle } from "./watchlists.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WATCHLIST_STATUSES = new Set<WatchlistItemStatus>([
  WatchlistItemStatus.WATCHING,
  WatchlistItemStatus.RESEARCHING,
  WatchlistItemStatus.CANDIDATE,
]);

type StockResearchBundle = NonNullable<Awaited<ReturnType<typeof getStockResearchBundle>>>;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function normalizeTicker(ticker: string): string {
  const normalized = assertNonBlank(ticker, "ticker").toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(normalized)) {
    throw new Error("ticker is invalid.");
  }

  return normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ageInDays(value: Date | string | null | undefined, now: Date): number | null {
  const parsed = toDate(value);
  if (!parsed) {
    return null;
  }

  return Math.floor((now.getTime() - parsed.getTime()) / DAY_MS);
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stanceFromComposite(compositeScore: number): SuggestedResearchStance {
  if (compositeScore >= 75) {
    return "STRONG_CANDIDATE";
  }

  if (compositeScore >= 63) {
    return "CANDIDATE";
  }

  if (compositeScore >= 50) {
    return "WATCH";
  }

  if (compositeScore >= 38) {
    return "HOLD_OFF";
  }

  return "AVOID";
}

interface MacroRiskContext {
  score: number;
  bullishFactors: string[];
  bearishFactors: string[];
  missingData: string[];
  staleDataWarnings: string[];
}

async function buildMacroRiskContext(now: Date): Promise<MacroRiskContext> {
  const [geopoliticalSummary, tenYearYield, twoYearYield, fedFunds, cpi] = await Promise.all([
    getGeopoliticalSummary({ days: 7, limit: 100 }).catch(() => null),
    getLatestMacroObservation("FRED", "DGS10").catch(() => null),
    getLatestMacroObservation("FRED", "DGS2").catch(() => null),
    getLatestMacroObservation("FRED", "FEDFUNDS").catch(() => null),
    getLatestMacroObservation("FRED", "CPIAUCSL").catch(() => null),
  ]);

  let score = 60;
  const bullishFactors: string[] = [];
  const bearishFactors: string[] = [];
  const missingData: string[] = [];
  const staleDataWarnings: string[] = [];

  if (!geopoliticalSummary) {
    missingData.push("Missing geopolitical summary.");
  } else {
    if (geopoliticalSummary.totalEvents >= 200) {
      score -= 12;
      bearishFactors.push("Elevated geopolitical event volume raises macro risk.");
    } else if (geopoliticalSummary.totalEvents >= 80) {
      score -= 6;
      bearishFactors.push("Geopolitical event flow is above normal.");
    } else if (geopoliticalSummary.totalEvents <= 20) {
      score += 2;
      bullishFactors.push("Geopolitical event flow is currently moderate.");
    }

    if (geopoliticalSummary.sentimentMix.negative > geopoliticalSummary.sentimentMix.positive) {
      score -= 4;
      bearishFactors.push("Geopolitical sentiment skews negative.");
    }
  }

  const macroPoints = [tenYearYield, twoYearYield, fedFunds, cpi].filter(
    (value): value is NonNullable<typeof value> => value != null,
  );

  if (macroPoints.length === 0) {
    missingData.push("Missing macro observations.");
  }

  const tenYearAgeDays = ageInDays(tenYearYield?.observedAt, now);
  const twoYearAgeDays = ageInDays(twoYearYield?.observedAt, now);
  const fedFundsAgeDays = ageInDays(fedFunds?.observedAt, now);
  const cpiAgeDays = ageInDays(cpi?.observedAt, now);

  if (tenYearAgeDays != null && tenYearAgeDays > 45) {
    staleDataWarnings.push("10Y Treasury observation is stale.");
  }

  if (twoYearAgeDays != null && twoYearAgeDays > 45) {
    staleDataWarnings.push("2Y Treasury observation is stale.");
  }

  if (fedFundsAgeDays != null && fedFundsAgeDays > 60) {
    staleDataWarnings.push("Fed funds observation is stale.");
  }

  if (cpiAgeDays != null && cpiAgeDays > 60) {
    staleDataWarnings.push("Inflation observation is stale.");
  }

  if (tenYearYield && twoYearYield) {
    if (twoYearYield.value >= tenYearYield.value) {
      score -= 8;
      bearishFactors.push("Yield curve inversion adds macro caution.");
    } else {
      score += 2;
    }
  }

  if (fedFunds?.value != null && fedFunds.value >= 5) {
    score -= 5;
    bearishFactors.push("High policy rates can pressure valuations.");
  }

  if (cpi?.value != null) {
    if (cpi.value >= 4) {
      score -= 6;
      bearishFactors.push("Elevated inflation can compress real returns.");
    } else if (cpi.value <= 2.5) {
      score += 2;
      bullishFactors.push("Contained inflation supports risk assets.");
    }
  }

  return {
    score: clamp(round(score), 25, 85),
    bullishFactors,
    bearishFactors,
    missingData,
    staleDataWarnings,
  };
}

function scoreTechnical(bundle: StockResearchBundle, now: Date): {
  score: number;
  bullish: string[];
  bearish: string[];
  missing: string[];
  stale: string[];
} {
  const bullish: string[] = [];
  const bearish: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  const technical = bundle.latestTechnicalSnapshot;
  const currentPrice = bundle.latestPriceSnapshot?.price ?? null;

  let score = 50;
  if (!technical) {
    return {
      score: 40,
      bullish,
      bearish: ["Technical snapshot unavailable."],
      missing: ["Missing technical snapshot."],
      stale,
    };
  }

  const technicalAgeDays = ageInDays(technical.capturedAt, now);
  if (technicalAgeDays != null && technicalAgeDays > 10) {
    stale.push("Technical snapshot is stale.");
  }

  if (currentPrice != null && technical.sma50 != null) {
    if (currentPrice > technical.sma50) {
      score += 8;
      bullish.push("Price is above SMA50.");
    } else {
      score -= 8;
      bearish.push("Price is below SMA50.");
    }
  }

  if (currentPrice != null && technical.sma200 != null) {
    if (currentPrice > technical.sma200) {
      score += 10;
      bullish.push("Price is above SMA200.");
    } else {
      score -= 10;
      bearish.push("Price is below SMA200.");
    }
  }

  const trendDirection = technical.trendDirection ?? "";
  if (trendDirection.includes("UPTREND")) {
    score += trendDirection.includes("STRONG") ? 12 : 8;
    bullish.push("Trend direction is positive.");
  } else if (trendDirection.includes("DOWNTREND")) {
    score -= trendDirection.includes("STRONG") ? 12 : 8;
    bearish.push("Trend direction is negative.");
  }

  if (technical.macd != null) {
    if (technical.macd > 0) {
      score += 4;
    } else {
      score -= 4;
    }
  }

  if (technical.rsi14 != null) {
    if (technical.rsi14 >= 80) {
      score -= 10;
      bearish.push("RSI indicates overbought conditions.");
    } else if (technical.rsi14 >= 70) {
      score -= 6;
      bearish.push("RSI is elevated and may signal short-term exhaustion.");
    } else if (technical.rsi14 <= 20) {
      score -= 8;
      bearish.push("RSI indicates oversold stress and elevated volatility risk.");
    } else if (technical.rsi14 <= 30) {
      score -= 4;
      bearish.push("RSI is low and can imply unstable momentum.");
    }
  }

  return {
    score: clamp(round(score), 0, 100),
    bullish,
    bearish,
    missing,
    stale,
  };
}

function scoreFundamentalAndValuation(bundle: StockResearchBundle, now: Date): {
  fundamentalScore: number;
  valuationScore: number;
  bullish: string[];
  bearish: string[];
  missing: string[];
  stale: string[];
} {
  const bullish: string[] = [];
  const bearish: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  const fundamentals = bundle.latestFundamentalSnapshot;
  if (!fundamentals) {
    return {
      fundamentalScore: 35,
      valuationScore: 45,
      bullish,
      bearish: ["Fundamental snapshot unavailable."],
      missing: ["Missing fundamental snapshot."],
      stale,
    };
  }

  const fundamentalAgeDays = ageInDays(fundamentals.capturedAt, now);
  if (fundamentalAgeDays != null && fundamentalAgeDays > 120) {
    stale.push("Fundamental snapshot is stale.");
  }

  let fundamentalScore = 50;
  let valuationScore = 55;

  if (fundamentals.revenueGrowth != null) {
    if (fundamentals.revenueGrowth > 0.08) {
      fundamentalScore += 10;
      bullish.push("Revenue growth is positive.");
    } else if (fundamentals.revenueGrowth > 0) {
      fundamentalScore += 5;
    } else {
      fundamentalScore -= 10;
      bearish.push("Revenue growth is negative.");
    }
  }

  const margins = [fundamentals.grossMargin, fundamentals.operatingMargin, fundamentals.netMargin].filter(
    (value): value is number => value != null,
  );
  const marginAverage = average(margins);
  if (marginAverage != null) {
    if (marginAverage >= 0.2) {
      fundamentalScore += 8;
      bullish.push("Margins are healthy.");
    } else if (marginAverage < 0.05) {
      fundamentalScore -= 8;
      bearish.push("Margins are thin.");
    }
  }

  if (fundamentals.debtToEquity != null) {
    if (fundamentals.debtToEquity <= 1.5) {
      fundamentalScore += 8;
      bullish.push("Debt-to-equity appears manageable.");
    } else if (fundamentals.debtToEquity >= 2.5) {
      fundamentalScore -= 10;
      bearish.push("Debt-to-equity is elevated.");
    }
  }

  if (fundamentals.currentRatio != null) {
    if (fundamentals.currentRatio >= 1 && fundamentals.currentRatio <= 3) {
      fundamentalScore += 5;
    } else if (fundamentals.currentRatio < 1) {
      fundamentalScore -= 7;
      bearish.push("Current ratio suggests tighter liquidity.");
    }
  }

  if (bundle.fmpFinancialRating?.returnOnEquityScore != null) {
    if (bundle.fmpFinancialRating.returnOnEquityScore >= 65) {
      fundamentalScore += 4;
    } else if (bundle.fmpFinancialRating.returnOnEquityScore <= 35) {
      fundamentalScore -= 4;
    }
  }

  if (bundle.fmpFinancialRating?.returnOnAssetsScore != null) {
    if (bundle.fmpFinancialRating.returnOnAssetsScore >= 65) {
      fundamentalScore += 4;
    } else if (bundle.fmpFinancialRating.returnOnAssetsScore <= 35) {
      fundamentalScore -= 4;
    }
  }

  const valuationMetrics = [
    fundamentals.peRatio,
    fundamentals.forwardPeRatio,
    fundamentals.priceToSales,
    fundamentals.priceToBook,
    fundamentals.evToEbitda,
  ].filter((value): value is number => value != null);

  if (valuationMetrics.length === 0) {
    missing.push("Valuation ratios are mostly unavailable.");
    valuationScore -= 8;
  }

  if (fundamentals.peRatio != null) {
    if (fundamentals.peRatio > 45) {
      valuationScore -= 10;
    } else if (fundamentals.peRatio < 8) {
      valuationScore += 3;
    }
  }

  if (fundamentals.forwardPeRatio != null) {
    if (fundamentals.forwardPeRatio > 40) {
      valuationScore -= 8;
    } else if (fundamentals.forwardPeRatio < 10) {
      valuationScore += 3;
    }
  }

  if (fundamentals.priceToSales != null) {
    if (fundamentals.priceToSales > 12) {
      valuationScore -= 7;
    } else if (fundamentals.priceToSales < 2) {
      valuationScore += 3;
    }
  }

  if (fundamentals.priceToBook != null) {
    if (fundamentals.priceToBook > 8) {
      valuationScore -= 6;
    } else if (fundamentals.priceToBook < 1.5) {
      valuationScore += 2;
    }
  }

  if (fundamentals.evToEbitda != null) {
    if (fundamentals.evToEbitda > 25) {
      valuationScore -= 8;
    } else if (fundamentals.evToEbitda < 8) {
      valuationScore += 3;
    }
  }

  return {
    fundamentalScore: clamp(round(fundamentalScore), 0, 100),
    valuationScore: clamp(round(valuationScore), 0, 100),
    bullish,
    bearish,
    missing,
    stale,
  };
}

function scoreAnalyst(bundle: StockResearchBundle, now: Date): {
  score: number;
  bullish: string[];
  bearish: string[];
  missing: string[];
  stale: string[];
} {
  const bullish: string[] = [];
  const bearish: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  const analystSnapshot = bundle.latestAnalystSnapshot;
  const analystActions = bundle.recentAnalystActions;

  let score = 50;
  if (!analystSnapshot && analystActions.length === 0) {
    return {
      score: 40,
      bullish,
      bearish,
      missing: ["Missing analyst snapshot and actions."],
      stale,
    };
  }

  if (analystSnapshot) {
    const analystAgeDays = ageInDays(analystSnapshot.capturedAt, now);
    if (analystAgeDays != null && analystAgeDays > 45) {
      stale.push("Analyst snapshot is stale.");
    }

    if (analystSnapshot.upsidePercent != null) {
      if (analystSnapshot.upsidePercent >= 15) {
        score += 12;
        bullish.push("Analyst targets imply meaningful upside.");
      } else if (analystSnapshot.upsidePercent >= 5) {
        score += 6;
      } else if (analystSnapshot.upsidePercent <= -15) {
        score -= 12;
        bearish.push("Analyst targets imply downside risk.");
      } else if (analystSnapshot.upsidePercent <= -5) {
        score -= 6;
      }
    }

    const ratingConsensus = analystSnapshot.ratingConsensus?.toLowerCase() ?? "";
    if (
      ratingConsensus.includes("strong buy") ||
      ratingConsensus.includes("buy") ||
      ratingConsensus.includes("overweight") ||
      ratingConsensus.includes("outperform")
    ) {
      score += 8;
      bullish.push("Analyst consensus is constructive.");
    } else if (
      ratingConsensus.includes("strong sell") ||
      ratingConsensus.includes("sell") ||
      ratingConsensus.includes("underweight") ||
      ratingConsensus.includes("underperform")
    ) {
      score -= 8;
      bearish.push("Analyst consensus is cautious.");
    }

    const bullishVotes = (analystSnapshot.strongBuyCount ?? 0) + (analystSnapshot.buyCount ?? 0);
    const bearishVotes = (analystSnapshot.strongSellCount ?? 0) + (analystSnapshot.sellCount ?? 0);
    const totalVotes = bullishVotes + bearishVotes + (analystSnapshot.holdCount ?? 0);

    if (totalVotes >= 5) {
      const bullishShare = bullishVotes / totalVotes;
      const bearishShare = bearishVotes / totalVotes;

      if (bullishShare >= 0.6) {
        score += 6;
      } else if (bearishShare >= 0.45) {
        score -= 6;
      }
    }
  }

  if (analystActions.length > 0) {
    const recentActions = analystActions.filter((action) => {
      const days = ageInDays(action.eventDate, now);
      return days != null && days <= 120;
    });

    const upgrades = recentActions.filter((action) =>
      action.actionType.toUpperCase().includes("UPGRADE"),
    ).length;
    const downgrades = recentActions.filter((action) =>
      action.actionType.toUpperCase().includes("DOWNGRADE"),
    ).length;

    if (upgrades > downgrades) {
      score += 5;
      bullish.push("Recent analyst actions include more upgrades than downgrades.");
    } else if (downgrades > upgrades) {
      score -= 5;
      bearish.push("Recent analyst actions include more downgrades than upgrades.");
    }
  }

  return {
    score: clamp(round(score), 0, 100),
    bullish,
    bearish,
    missing,
    stale,
  };
}

function scoreNews(bundle: StockResearchBundle, now: Date): {
  score: number;
  bullish: string[];
  bearish: string[];
  missing: string[];
  stale: string[];
} {
  const bullish: string[] = [];
  const bearish: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  const recentNews = bundle.recentNews;
  let score = 50;

  if (recentNews.length === 0) {
    return {
      score: 45,
      bullish,
      bearish,
      missing: ["No recent news articles."],
      stale,
    };
  }

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let mixedCount = 0;

  for (const article of recentNews) {
    if (article.sentiment === Sentiment.BULLISH) {
      bullishCount += 1;
    } else if (article.sentiment === Sentiment.BEARISH) {
      bearishCount += 1;
    } else if (article.sentiment === Sentiment.NEUTRAL) {
      neutralCount += 1;
    } else if (article.sentiment === Sentiment.MIXED) {
      mixedCount += 1;
    }
  }

  if (bullishCount > bearishCount) {
    score += 6;
    bullish.push("Recent news sentiment skews positive.");
  } else if (bearishCount > bullishCount) {
    score -= 6;
    bearish.push("Recent news sentiment skews negative.");
  }

  const materialityValues = recentNews
    .map((article) => article.materialityScore)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const averageMateriality = average(materialityValues) ?? 0;

  if (bearishCount >= bullishCount + 3 && averageMateriality >= 0.6) {
    score -= 4;
    bearish.push("Bearish news appears materially relevant.");
  }

  if (bullishCount >= bearishCount + 3 && averageMateriality >= 0.6) {
    score += 3;
  }

  const latestNewsDate = recentNews
    .map((article) => toDate(article.publishedAt))
    .filter((value): value is Date => value != null)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  const newsAgeDays = ageInDays(latestNewsDate ?? null, now);
  if (newsAgeDays != null && newsAgeDays > 7) {
    stale.push("Recent news set is stale.");
  }

  if (neutralCount + mixedCount === recentNews.length) {
    bearish.push("News flow is mostly neutral, limiting directional conviction.");
  }

  return {
    score: clamp(round(score), 0, 100),
    bullish,
    bearish,
    missing,
    stale,
  };
}

function scoreEarningsRisk(bundle: StockResearchBundle, now: Date): {
  score: number;
  bearish: string[];
  missing: string[];
} {
  const bearish: string[] = [];
  const missing: string[] = [];

  let score = 60;
  const nextEarnings = bundle.nextEarningsEvent;
  if (!nextEarnings?.earningsDate) {
    return {
      score: 55,
      bearish,
      missing: ["No upcoming earnings event data."],
    };
  }

  const daysUntilEarnings = Math.ceil((nextEarnings.earningsDate.getTime() - now.getTime()) / DAY_MS);

  if (daysUntilEarnings <= 3) {
    score = 35;
    bearish.push("Earnings event is imminent and may increase volatility.");
  } else if (daysUntilEarnings <= 7) {
    score = 45;
    bearish.push("Earnings event is near-term and can add uncertainty.");
  } else if (daysUntilEarnings <= 14) {
    score = 55;
  } else {
    score = 68;
  }

  return {
    score,
    bearish,
    missing,
  };
}

function weightedComposite(components: TickerResearchComponentScores): number {
  return round(
    components.technicalScore * 0.16 +
      components.fundamentalScore * 0.18 +
      components.valuationScore * 0.14 +
      components.analystScore * 0.14 +
      components.newsScore * 0.12 +
      components.macroRiskScore * 0.1 +
      components.earningsRiskScore * 0.08 +
      components.dataQualityScore * 0.08,
  );
}

export async function scoreTickerResearch(ticker: string): Promise<TickerResearchScoreResult> {
  const normalizedTicker = normalizeTicker(ticker);
  const bundle = await getStockResearchBundle(normalizedTicker);
  if (!bundle) {
    throw new Error("Ticker research bundle not found.");
  }

  const now = new Date();

  const technical = scoreTechnical(bundle, now);
  const fundamentals = scoreFundamentalAndValuation(bundle, now);
  const analyst = scoreAnalyst(bundle, now);
  const news = scoreNews(bundle, now);
  const earnings = scoreEarningsRisk(bundle, now);
  const macro = await buildMacroRiskContext(now);

  const missingData = dedupe([
    ...technical.missing,
    ...fundamentals.missing,
    ...analyst.missing,
    ...news.missing,
    ...earnings.missing,
    ...macro.missingData,
  ]);

  const staleDataWarnings = dedupe([
    ...technical.stale,
    ...fundamentals.stale,
    ...analyst.stale,
    ...news.stale,
    ...macro.staleDataWarnings,
  ]);

  const dataQualityPenalty = missingData.length * 10 + staleDataWarnings.length * 6;
  const dataQualityScore = clamp(round(100 - dataQualityPenalty), 15, 100);

  const componentScores: TickerResearchComponentScores = {
    technicalScore: technical.score,
    fundamentalScore: fundamentals.fundamentalScore,
    valuationScore: fundamentals.valuationScore,
    analystScore: analyst.score,
    newsScore: news.score,
    macroRiskScore: macro.score,
    earningsRiskScore: earnings.score,
    dataQualityScore,
  };

  const compositeScore = weightedComposite(componentScores);
  const suggestedStance = stanceFromComposite(compositeScore);

  const bullishFactors = dedupe([
    ...technical.bullish,
    ...fundamentals.bullish,
    ...analyst.bullish,
    ...news.bullish,
    ...macro.bullishFactors,
  ]).slice(0, 10);

  const bearishFactors = dedupe([
    ...technical.bearish,
    ...fundamentals.bearish,
    ...analyst.bearish,
    ...news.bearish,
    ...earnings.bearish,
    ...macro.bearishFactors,
    ...(missingData.length >= 3 ? ["Coverage gaps reduce confidence in this score."] : []),
  ]).slice(0, 10);

  const explanation = [
    "Deterministic weighted score from local backend data only (no LLM calls).",
    "Component weights: technical 16%, fundamental 18%, valuation 14%, analyst 14%, news 12%, macro risk 10%, earnings risk 8%, data quality 8%.",
    "Valuation signals are conservative and are not sector-relative fair-value estimates.",
    "Output is decision support, not investment advice.",
  ].join(" ");

  return {
    ticker: normalizedTicker,
    asOf: now.toISOString(),
    componentScores,
    compositeScore,
    suggestedStance,
    bullishFactors,
    bearishFactors,
    missingData,
    staleDataWarnings,
    explanation,
  };
}

export async function scoreWatchlist(watchlistId: string): Promise<WatchlistResearchScoreResult> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const watchlistBundle = await getWatchlistResearchBundle(normalizedWatchlistId);
  if (!watchlistBundle) {
    throw new Error("Watchlist research bundle not found.");
  }

  const warnings: string[] = [];
  const skippedItems: WatchlistSkippedItem[] = [];

  const activeItems = watchlistBundle.items.filter((item) =>
    ACTIVE_WATCHLIST_STATUSES.has(item.status),
  );

  const scoredItems: WatchlistScoredItem[] = [];

  for (const item of activeItems) {
    let normalizedTicker: string;

    try {
      normalizedTicker = normalizeTicker(item.ticker);
    } catch {
      skippedItems.push({
        ticker: item.ticker,
        reason: "Invalid ticker format.",
      });
      continue;
    }

    const missingSignals = collectMissingResearchSignals(item);
    if (missingSignals.length >= 6) {
      skippedItems.push({
        ticker: item.ticker,
        reason: "No meaningful research data is currently available.",
        missingData: missingSignals,
      });
      continue;
    }

    try {
      const score = await scoreTickerResearch(normalizedTicker);
      scoredItems.push({
        rank: 0,
        itemId: item.itemId,
        ticker: normalizedTicker,
        status: item.status,
        priority: item.priority,
        compositeScore: score.compositeScore,
        suggestedStance: score.suggestedStance,
        score,
      });
    } catch (error) {
      const reason = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Ticker scoring failed.";

      skippedItems.push({
        ticker: normalizedTicker,
        reason,
        missingData: missingSignals,
      });

      warnings.push(`Skipped ${normalizedTicker}: ${reason}`);
    }
  }

  scoredItems.sort((left, right) => {
    if (right.compositeScore !== left.compositeScore) {
      return right.compositeScore - left.compositeScore;
    }

    return left.ticker.localeCompare(right.ticker);
  });

  const rankedItems = scoredItems.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));

  return {
    watchlistId: watchlistBundle.watchlist.id,
    watchlistName: watchlistBundle.watchlist.name,
    asOf: new Date().toISOString(),
    totalItems: watchlistBundle.itemCount,
    activeItemsCount: activeItems.length,
    scoredItemsCount: rankedItems.length,
    skippedItemsCount: skippedItems.length,
    skippedItems,
    warnings: dedupe(warnings),
    itemCount: rankedItems.length,
    rankedItems,
  };
}

function collectMissingResearchSignals(item: WatchlistResearchItemSummary): string[] {
  const missing: string[] = [];

  if (!item.latestPriceSnapshot) {
    missing.push("latestPriceSnapshot");
  }

  if (!item.latestTechnicalSnapshot) {
    missing.push("latestTechnicalSnapshot");
  }

  if (!item.latestFundamentalSnapshot) {
    missing.push("latestFundamentalSnapshot");
  }

  if (!item.latestAnalystSnapshot && (!Array.isArray(item.recentAnalystActions) || item.recentAnalystActions.length === 0)) {
    missing.push("analystContext");
  }

  if (!Array.isArray(item.topHeadlines) || item.topHeadlines.length === 0) {
    missing.push("topHeadlines");
  }

  if (!item.nextEarningsEvent) {
    missing.push("nextEarningsEvent");
  }

  return missing;
}

function compareScoredValues(scores: TickerResearchScoreResult[]): string[] {
  if (scores.length < 2) {
    return [];
  }

  const byComposite = [...scores].sort((left, right) => right.compositeScore - left.compositeScore);
  const strongest = byComposite[0];
  const weakest = byComposite[byComposite.length - 1];

  const differences: string[] = [];
  differences.push(
    `Highest composite is ${strongest.ticker} (${strongest.compositeScore.toFixed(1)}); lowest is ${weakest.ticker} (${weakest.compositeScore.toFixed(1)}).`,
  );

  const componentKeys: Array<keyof TickerResearchScoreResult["componentScores"]> = [
    "technicalScore",
    "fundamentalScore",
    "valuationScore",
    "analystScore",
    "newsScore",
    "macroRiskScore",
    "earningsRiskScore",
    "dataQualityScore",
  ];

  for (const key of componentKeys) {
    const sorted = [...scores].sort(
      (left, right) => right.componentScores[key] - left.componentScores[key],
    );
    const lead = sorted[0];
    const lag = sorted[sorted.length - 1];

    if (Math.abs(lead.componentScores[key] - lag.componentScores[key]) >= 12) {
      differences.push(
        `${key} spread: ${lead.ticker} leads (${lead.componentScores[key].toFixed(1)}) vs ${lag.ticker} (${lag.componentScores[key].toFixed(1)}).`,
      );
    }
  }

  return differences.slice(0, 8);
}

export async function compareTickers(tickers: string[]): Promise<CompareTickersResult> {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error("tickers is required.");
  }

  const normalized = Array.from(
    new Set(
      tickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter((ticker) => ticker.length > 0),
    ),
  );

  if (normalized.length === 0) {
    throw new Error("tickers is required.");
  }

  const scores: TickerResearchScoreResult[] = [];
  for (const ticker of normalized) {
    scores.push(await scoreTickerResearch(ticker));
  }

  return {
    asOf: new Date().toISOString(),
    requestedTickers: normalized,
    scores,
    keyDifferences: compareScoredValues(scores),
  };
}

function toExposure(
  entries: Map<string, { holdings: number; marketValueCad: number }>,
  totalMarketValueCad: number,
): PortfolioRiskExposure[] {
  return [...entries.entries()]
    .map(([key, value]) => ({
      key,
      holdings: value.holdings,
      marketValueCad: value.marketValueCad > 0 ? round(value.marketValueCad) : null,
      sharePercent:
        totalMarketValueCad > 0 ? round((value.marketValueCad / totalMarketValueCad) * 100) : null,
    }))
    .sort((left, right) => (right.sharePercent ?? 0) - (left.sharePercent ?? 0));
}

function normalizeCurrencyCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function toTickerList(values: Array<{ ticker: string }>): string {
  return values.map((value) => value.ticker).join(", ");
}

function toUnsupportedCurrencyList(values: PortfolioFxIssue[]): string {
  return values
    .map((value) => {
      if (!value.currency) {
        return value.ticker;
      }

      return `${value.ticker} (${value.currency})`;
    })
    .join(", ");
}

function latestNewsPublishedAt(
  headlines: Array<{ publishedAt?: Date | string | null }> | undefined,
): Date | null {
  if (!Array.isArray(headlines) || headlines.length === 0) {
    return null;
  }

  const candidates = headlines
    .map((headline) => toDate(headline.publishedAt ?? null))
    .filter((value): value is Date => value != null)
    .sort((left, right) => right.getTime() - left.getTime());

  return candidates[0] ?? null;
}

function staleWarningForAge(
  label: string,
  ageDays: number | null,
  thresholdDays: number,
): string | null {
  if (ageDays == null || ageDays <= thresholdDays) {
    return null;
  }

  return `${label} appears stale (${ageDays} days old).`;
}

function deriveSuggestedRefreshActionsFromFlags(input: {
  hasPrice: boolean;
  hasTechnical: boolean;
  hasFundamental: boolean;
  hasAnalyst: boolean;
  hasNews: boolean;
  hasEarnings: boolean;
  hasReport: boolean;
  staleDataWarnings: string[];
}): string[] {
  const actions: string[] = [];
  const hasCoverageGap =
    !input.hasPrice ||
    !input.hasTechnical ||
    !input.hasFundamental ||
    !input.hasNews ||
    !input.hasEarnings ||
    !input.hasReport;

  if (hasCoverageGap || input.staleDataWarnings.length > 0) {
    actions.push("refreshWatchlistResearchData");
  }

  if (!input.hasAnalyst || input.staleDataWarnings.some((warning) => warning.toLowerCase().includes("analyst"))) {
    actions.push("refreshTickerAnalystData");
  }

  return dedupe(actions);
}

function evaluateWatchlistItemDataQuality(
  item: WatchlistResearchItemSummary,
  now: Date,
): WatchlistTickerDataQualityResult {
  const hasPrice = item.latestPriceSnapshot != null;
  const hasTechnical = item.latestTechnicalSnapshot != null;
  const hasFundamental = item.latestFundamentalSnapshot != null;
  const hasAnalyst =
    item.latestAnalystSnapshot != null ||
    (Array.isArray(item.recentAnalystActions) && item.recentAnalystActions.length > 0);
  const hasNews = Array.isArray(item.topHeadlines) && item.topHeadlines.length > 0;
  const hasEarnings = item.nextEarningsEvent != null;
  const hasReport = item.latestAIReport != null;

  const missingData: string[] = [];
  if (!hasPrice) {
    missingData.push("price");
  }
  if (!hasTechnical) {
    missingData.push("technical");
  }
  if (!hasFundamental) {
    missingData.push("fundamental");
  }
  if (!hasAnalyst) {
    missingData.push("analyst");
  }
  if (!hasNews) {
    missingData.push("news");
  }
  if (!hasEarnings) {
    missingData.push("earnings");
  }
  if (!hasReport) {
    missingData.push("report");
  }

  const staleDataWarnings: string[] = [];

  const priceWarning = staleWarningForAge(
    "Price snapshot",
    ageInDays(item.latestPriceSnapshot?.capturedAt ?? null, now),
    3,
  );
  if (priceWarning) {
    staleDataWarnings.push(priceWarning);
  }

  const technicalWarning = staleWarningForAge(
    "Technical snapshot",
    ageInDays(item.latestTechnicalSnapshot?.capturedAt ?? null, now),
    10,
  );
  if (technicalWarning) {
    staleDataWarnings.push(technicalWarning);
  }

  const fundamentalWarning = staleWarningForAge(
    "Fundamental snapshot",
    ageInDays(item.latestFundamentalSnapshot?.capturedAt ?? null, now),
    120,
  );
  if (fundamentalWarning) {
    staleDataWarnings.push(fundamentalWarning);
  }

  const analystWarning = staleWarningForAge(
    "Analyst snapshot",
    ageInDays(item.latestAnalystSnapshot?.capturedAt ?? null, now),
    45,
  );
  if (analystWarning) {
    staleDataWarnings.push(analystWarning);
  }

  const newsWarning = staleWarningForAge(
    "Recent news",
    ageInDays(latestNewsPublishedAt(item.topHeadlines), now),
    7,
  );
  if (newsWarning) {
    staleDataWarnings.push(newsWarning);
  }

  const reportWarning = staleWarningForAge(
    "Latest report",
    ageInDays(item.latestReportDate ?? null, now),
    14,
  );
  if (reportWarning) {
    staleDataWarnings.push(reportWarning);
  }

  return {
    itemId: item.itemId,
    ticker: item.ticker,
    status: item.status,
    priority: item.priority,
    hasPrice,
    hasTechnical,
    hasFundamental,
    hasAnalyst,
    hasNews,
    hasEarnings,
    hasReport,
    missingData,
    staleDataWarnings,
    suggestedRefreshActions: deriveSuggestedRefreshActionsFromFlags({
      hasPrice,
      hasTechnical,
      hasFundamental,
      hasAnalyst,
      hasNews,
      hasEarnings,
      hasReport,
      staleDataWarnings,
    }),
  };
}

function selectRiskScopedHoldings(
  holdings: PortfolioOverviewHoldingSummary[],
): PortfolioOverviewHoldingSummary[] {
  const hasStatusValues = holdings.some((holding) => holding.status != null);
  if (!hasStatusValues) {
    return holdings;
  }

  return holdings.filter((holding) => holding.status === HoldingStatus.OWNED);
}

async function collectRiskConversionDiagnostics(
  holdings: PortfolioOverviewHoldingSummary[],
): Promise<{
  fxRateUsed: PortfolioRiskSnapshotResult["fxRateUsed"];
  holdingsMissingFx: PortfolioFxIssue[];
  holdingsUnsupportedCurrency: PortfolioFxIssue[];
  holdingsMissingCurrency: Array<{ ticker: string }>;
  conversionStatuses: PortfolioRiskConversionStatus[];
}> {
  let usdCadCachedProbe: ConvertMoneyToCadResult | null = null;
  let fxRateUsed: PortfolioRiskSnapshotResult["fxRateUsed"] = null;

  const holdingsMissingFx: PortfolioFxIssue[] = [];
  const holdingsUnsupportedCurrency: PortfolioFxIssue[] = [];
  const holdingsMissingCurrency: Array<{ ticker: string }> = [];
  const conversionStatuses: PortfolioRiskConversionStatus[] = [];

  for (const holding of holdings) {
    const currency = normalizeCurrencyCode(holding.nativeCurrency ?? holding.currency);

    if (!currency) {
      holdingsMissingCurrency.push({ ticker: holding.ticker });
      conversionStatuses.push({
        ticker: holding.ticker,
        currency: null,
        conversionStatus: "UNSUPPORTED_CURRENCY",
      });
      continue;
    }

    let conversion: ConvertMoneyToCadResult;
    if (currency === "USD" && usdCadCachedProbe) {
      conversion = usdCadCachedProbe;
    } else {
      conversion = await convertMoneyToCad({
        amount: 1,
        currency,
      });

      if (currency === "USD") {
        usdCadCachedProbe = conversion;
      }
    }

    conversionStatuses.push({
      ticker: holding.ticker,
      currency,
      conversionStatus: conversion.conversionStatus,
    });

    if (
      !fxRateUsed &&
      conversion.conversionStatus === "CONVERTED" &&
      conversion.fxRate != null
    ) {
      fxRateUsed = {
        pair: "USD/CAD",
        rate: conversion.fxRate,
        source: conversion.fxRateSource,
        capturedAt: conversion.fxRateCapturedAt,
      };
    }

    if (conversion.conversionStatus === "MISSING_FX") {
      holdingsMissingFx.push({
        ticker: holding.ticker,
        currency,
      });
      continue;
    }

    if (conversion.conversionStatus === "UNSUPPORTED_CURRENCY") {
      holdingsUnsupportedCurrency.push({
        ticker: holding.ticker,
        currency,
      });
    }
  }

  return {
    fxRateUsed,
    holdingsMissingFx,
    holdingsUnsupportedCurrency,
    holdingsMissingCurrency,
    conversionStatuses,
  };
}

export async function getPortfolioRiskSnapshot(
  portfolioId: string,
): Promise<PortfolioRiskSnapshotResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const overview = await getPortfolioOverview(normalizedPortfolioId);
  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const scopedHoldings = selectRiskScopedHoldings(overview.holdings);
  const conversionDiagnostics = await collectRiskConversionDiagnostics(scopedHoldings);

  const fxRateUsed = conversionDiagnostics.fxRateUsed ?? overview.fxRateUsed;

  const missingData: string[] = [];

  if (conversionDiagnostics.holdingsMissingFx.length > 0) {
    missingData.push(
      `Missing FX rates for ${conversionDiagnostics.holdingsMissingFx.length} holding(s): ${toTickerList(conversionDiagnostics.holdingsMissingFx)}.`,
    );
  }

  if (conversionDiagnostics.holdingsMissingCurrency.length > 0) {
    missingData.push(
      `Some holdings are missing currency metadata: ${toTickerList(conversionDiagnostics.holdingsMissingCurrency)}.`,
    );
  }

  if (conversionDiagnostics.holdingsUnsupportedCurrency.length > 0) {
    missingData.push(
      `Some holdings use unsupported currencies: ${toUnsupportedCurrencyList(conversionDiagnostics.holdingsUnsupportedCurrency)}.`,
    );
  }

  const holdingsWithoutPrice = scopedHoldings.filter((holding) => holding.latestPrice == null);
  if (holdingsWithoutPrice.length > 0) {
    missingData.push(
      `Missing latest price for ${holdingsWithoutPrice.length} holding(s): ${holdingsWithoutPrice
        .map((holding) => holding.ticker)
        .join(", ")}.`,
    );
  }

  const totalMarketValueCad = scopedHoldings.reduce(
    (sum, holding) => sum + Math.max(0, holding.marketValueCad ?? 0),
    0,
  );

  const concentrationRisks: PortfolioConcentrationRisk[] = [];

  if (totalMarketValueCad > 0) {
    const holdingsByShare = scopedHoldings
      .map((holding) => ({
        ticker: holding.ticker,
        sharePercent: ((holding.marketValueCad ?? 0) / totalMarketValueCad) * 100,
      }))
      .sort((left, right) => right.sharePercent - left.sharePercent);

    if (holdingsByShare[0] && holdingsByShare[0].sharePercent >= 35) {
      concentrationRisks.push({
        type: "HOLDING",
        key: holdingsByShare[0].ticker,
        sharePercent: round(holdingsByShare[0].sharePercent),
        message: `Single-name concentration is high in ${holdingsByShare[0].ticker}.`,
      });
    } else if (holdingsByShare[0] && holdingsByShare[0].sharePercent >= 20) {
      concentrationRisks.push({
        type: "HOLDING",
        key: holdingsByShare[0].ticker,
        sharePercent: round(holdingsByShare[0].sharePercent),
        message: `Single-name concentration is moderate in ${holdingsByShare[0].ticker}.`,
      });
    }

    const topThreeShare = holdingsByShare
      .slice(0, 3)
      .reduce((sum, entry) => sum + Math.max(0, entry.sharePercent), 0);

    if (topThreeShare >= 70) {
      concentrationRisks.push({
        type: "HOLDING",
        key: "TOP3",
        sharePercent: round(topThreeShare),
        message: "Top three holdings represent most of the portfolio value.",
      });
    }
  }

  const currencyMap = new Map<string, { holdings: number; marketValueCad: number }>();
  const sectorMap = new Map<string, { holdings: number; marketValueCad: number }>();

  for (const holding of scopedHoldings) {
    const currencyKey = normalizeCurrencyCode(holding.nativeCurrency ?? holding.currency) ?? "UNKNOWN";
    const currencyEntry = currencyMap.get(currencyKey) ?? { holdings: 0, marketValueCad: 0 };
    currencyEntry.holdings += 1;
    currencyEntry.marketValueCad += Math.max(0, holding.marketValueCad ?? 0);
    currencyMap.set(currencyKey, currencyEntry);

    const sectorKey = (holding.sector ?? "UNSPECIFIED").trim() || "UNSPECIFIED";
    const sectorEntry = sectorMap.get(sectorKey) ?? { holdings: 0, marketValueCad: 0 };
    sectorEntry.holdings += 1;
    sectorEntry.marketValueCad += Math.max(0, holding.marketValueCad ?? 0);
    sectorMap.set(sectorKey, sectorEntry);
  }

  const currencyExposure = toExposure(currencyMap, totalMarketValueCad);
  const sectorExposure = toExposure(sectorMap, totalMarketValueCad);

  const topSector = sectorExposure[0];
  if (topSector?.sharePercent != null && topSector.sharePercent >= 45) {
    concentrationRisks.push({
      type: "SECTOR",
      key: topSector.key,
      sharePercent: topSector.sharePercent,
      message: `Sector concentration is elevated in ${topSector.key}.`,
    });
  }

  const topRisks = dedupe([
    ...concentrationRisks.map((risk) => risk.message),
    ...missingData,
  ]).slice(0, 5);

  const summaryParts = [
    `Portfolio includes ${overview.holdingCount} holding(s); ${scopedHoldings.length} owned holding(s) were analyzed for risk.`,
    concentrationRisks.length > 0
      ? `${concentrationRisks.length} concentration risk signal(s) detected.`
      : "No severe concentration thresholds were triggered.",
    missingData.length > 0
      ? `${missingData.length} data-coverage gap(s) detected.`
      : "Core market-value and FX coverage is available.",
  ];

  return {
    portfolioId: overview.portfolio.id,
    asOf: new Date().toISOString(),
    fxRateUsed,
    holdingsMissingFx: conversionDiagnostics.holdingsMissingFx,
    holdingsUnsupportedCurrency: conversionDiagnostics.holdingsUnsupportedCurrency,
    holdingsMissingCurrency: conversionDiagnostics.holdingsMissingCurrency,
    conversionStatuses: conversionDiagnostics.conversionStatuses,
    concentrationRisks,
    currencyExposure,
    sectorExposure,
    missingData,
    topRisks,
    summary: summaryParts.join(" "),
  };
}

export async function getTickerDataQuality(
  ticker: string,
): Promise<TickerDataQualityResult> {
  const normalizedTicker = normalizeTicker(ticker);
  const bundle = await getStockResearchBundle(normalizedTicker);
  if (!bundle) {
    throw new Error("Ticker research bundle not found.");
  }

  const now = new Date();
  const hasPrice = bundle.latestPriceSnapshot != null;
  const hasTechnical = bundle.latestTechnicalSnapshot != null;
  const hasFundamental = bundle.latestFundamentalSnapshot != null;
  const hasAnalyst =
    bundle.latestAnalystSnapshot != null ||
    (Array.isArray(bundle.recentAnalystActions) && bundle.recentAnalystActions.length > 0);
  const hasNews = Array.isArray(bundle.recentNews) && bundle.recentNews.length > 0;
  const hasEarnings = bundle.nextEarningsEvent != null;
  const hasReport = bundle.latestAIReport != null;

  const missingData: string[] = [];
  if (!hasPrice) {
    missingData.push("price");
  }
  if (!hasTechnical) {
    missingData.push("technical");
  }
  if (!hasFundamental) {
    missingData.push("fundamental");
  }
  if (!hasAnalyst) {
    missingData.push("analyst");
  }
  if (!hasNews) {
    missingData.push("news");
  }
  if (!hasEarnings) {
    missingData.push("earnings");
  }
  if (!hasReport) {
    missingData.push("report");
  }

  const staleDataWarnings = dedupe(
    [
      staleWarningForAge("Price snapshot", ageInDays(bundle.latestPriceSnapshot?.capturedAt ?? null, now), 3),
      staleWarningForAge("Technical snapshot", ageInDays(bundle.latestTechnicalSnapshot?.capturedAt ?? null, now), 10),
      staleWarningForAge("Fundamental snapshot", ageInDays(bundle.latestFundamentalSnapshot?.capturedAt ?? null, now), 120),
      staleWarningForAge("Analyst snapshot", ageInDays(bundle.latestAnalystSnapshot?.capturedAt ?? null, now), 45),
      staleWarningForAge("Recent news", ageInDays(latestNewsPublishedAt(bundle.recentNews), now), 7),
      staleWarningForAge("Latest report", ageInDays(bundle.latestAIReport?.reportDate ?? null, now), 14),
    ].filter((warning): warning is string => warning != null),
  );

  return {
    ticker: normalizedTicker,
    hasPrice,
    hasTechnical,
    hasFundamental,
    hasAnalyst,
    hasNews,
    hasEarnings,
    hasReport,
    missingData,
    staleDataWarnings,
    suggestedRefreshActions: deriveSuggestedRefreshActionsFromFlags({
      hasPrice,
      hasTechnical,
      hasFundamental,
      hasAnalyst,
      hasNews,
      hasEarnings,
      hasReport,
      staleDataWarnings,
    }),
  };
}

export async function getWatchlistDataQuality(
  watchlistId: string,
): Promise<WatchlistDataQualityResult> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const watchlistBundle = await getWatchlistResearchBundle(normalizedWatchlistId);
  if (!watchlistBundle) {
    throw new Error("Watchlist research bundle not found.");
  }

  const now = new Date();
  const perTickerQuality = watchlistBundle.items.map((item) =>
    evaluateWatchlistItemDataQuality(item, now),
  );

  let completeItemsCount = 0;
  let partialItemsCount = 0;
  let emptyItemsCount = 0;

  for (const item of perTickerQuality) {
    const coverageCount = [
      item.hasPrice,
      item.hasTechnical,
      item.hasFundamental,
      item.hasAnalyst,
      item.hasNews,
      item.hasEarnings,
      item.hasReport,
    ].filter(Boolean).length;

    if (coverageCount === 7) {
      completeItemsCount += 1;
    } else if (coverageCount === 0) {
      emptyItemsCount += 1;
    } else {
      partialItemsCount += 1;
    }
  }

  const suggestedRefreshActions = dedupe([
    ...(partialItemsCount > 0 || emptyItemsCount > 0 ? ["refreshWatchlistResearchData"] : []),
    ...(perTickerQuality.some((item) => !item.hasAnalyst) ? ["refreshWatchlistAnalystData"] : []),
  ]);

  return {
    watchlistId: watchlistBundle.watchlist.id,
    itemCount: watchlistBundle.itemCount,
    completeItemsCount,
    partialItemsCount,
    emptyItemsCount,
    perTickerQuality,
    suggestedRefreshActions,
  };
}

export async function getPortfolioDataQuality(
  portfolioId: string,
): Promise<PortfolioDataQualityResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const [overview, riskSnapshot] = await Promise.all([
    getPortfolioOverview(normalizedPortfolioId),
    getPortfolioRiskSnapshot(normalizedPortfolioId),
  ]);

  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const scopedHoldings = selectRiskScopedHoldings(overview.holdings);
  const missingPriceIssues = scopedHoldings
    .filter((holding) => holding.latestPrice == null)
    .map((holding) => ({ ticker: holding.ticker }));

  const staleDataWarnings: string[] = [];

  const stalePriceTickers = scopedHoldings
    .filter((holding) => {
      const age = ageInDays(holding.latestPriceCapturedAt ?? null, new Date());
      return age != null && age > 3;
    })
    .map((holding) => holding.ticker);

  if (stalePriceTickers.length > 0) {
    staleDataWarnings.push(`Stale price snapshots detected: ${stalePriceTickers.join(", ")}.`);
  }

  const fxAge = ageInDays(riskSnapshot.fxRateUsed?.capturedAt ?? null, new Date());
  if (fxAge != null && fxAge > 3) {
    staleDataWarnings.push(`USD/CAD FX snapshot appears stale (${fxAge} days old).`);
  }

  const suggestedRefreshActions = dedupe([
    ...(riskSnapshot.holdingsMissingFx.length > 0 ? ["refreshUsdCadFxRate"] : []),
    ...(missingPriceIssues.length > 0 || stalePriceTickers.length > 0 ? ["runPortfolioFullRefresh"] : []),
  ]);

  return {
    portfolioId: overview.portfolio.id,
    holdingCount: scopedHoldings.length,
    missingFxIssues: riskSnapshot.holdingsMissingFx,
    missingCurrencyIssues: riskSnapshot.holdingsMissingCurrency,
    missingPriceIssues,
    staleDataWarnings,
    suggestedRefreshActions,
  };
}
