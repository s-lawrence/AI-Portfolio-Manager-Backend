import { NewsArticle, Sentiment } from "@prisma/client";

import {
  listRecentNewsByTicker,
  upsertNewsArticleByUrl,
} from "../repositories/news-articles.repository";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";
import {
  NewsAnalysisInput,
  NewsSentimentSummary,
} from "../types/services";
import { ensureStockExists } from "./stocks.service";

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function normalizeText(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

const BULLISH_KEYWORDS = [
  "beats",
  "beat estimates",
  "raises guidance",
  "record revenue",
  "strong demand",
  "upgrade",
  "outperform",
  "surge",
  "growth accelerates",
];

const BEARISH_KEYWORDS = [
  "misses",
  "missed estimates",
  "cuts guidance",
  "guidance cut",
  "lawsuit",
  "downgrade",
  "investigation",
  "decline",
  "weak demand",
  "warning",
];

export function classifyNewsSentiment(
  headline: string,
  summary?: string | null,
): Sentiment {
  const text = `${normalizeText(headline)} ${normalizeText(summary)}`;

  const bullishMatches = BULLISH_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
  const bearishMatches = BEARISH_KEYWORDS.filter((keyword) => text.includes(keyword)).length;

  if (bullishMatches > 0 && bearishMatches > 0) {
    return Sentiment.MIXED;
  }

  if (bullishMatches > 0) {
    return Sentiment.BULLISH;
  }

  if (bearishMatches > 0) {
    return Sentiment.BEARISH;
  }

  return Sentiment.NEUTRAL;
}

export function estimateMateriality(
  headline: string,
  summary?: string | null,
): number {
  const text = `${normalizeText(headline)} ${normalizeText(summary)}`;

  let score = 0.45;

  const highImpactSignals = [
    "earnings",
    "guidance",
    "acquisition",
    "merger",
    "lawsuit",
    "investigation",
    "sec",
    "bankruptcy",
    "record revenue",
  ];

  const mediumImpactSignals = [
    "product launch",
    "partnership",
    "analyst",
    "upgrade",
    "downgrade",
    "cost cuts",
    "layoffs",
  ];

  if (highImpactSignals.some((signal) => text.includes(signal))) {
    score += 0.3;
  }

  if (mediumImpactSignals.some((signal) => text.includes(signal))) {
    score += 0.15;
  }

  if (text.includes("rumor") || text.includes("speculation")) {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

export function isDemoNewsArticle(article: {
  source?: string | null;
  headline?: string | null;
  url?: string | null;
}): boolean {
  const source = normalizeText(article.source);
  const headline = normalizeText(article.headline);
  const url = normalizeText(article.url);

  return (
    source.includes("demo") ||
    headline.startsWith("[demo]") ||
    url.includes("demo.local")
  );
}

export async function recordNewsArticle(
  ticker: string,
  input: NewsAnalysisInput,
): Promise<NewsArticle> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  const headline = assertNonBlank(input.headline, "headline");
  const url = assertNonBlank(input.url, "url");

  return upsertNewsArticleByUrl({
    stockId: stock.id,
    headline,
    url,
    source: input.source ?? null,
    author: input.author ?? null,
    publishedAt: input.publishedAt ?? new Date(),
    summary: input.summary ?? null,
    rawExcerpt: input.rawExcerpt ?? null,
    sentiment: input.sentiment ?? null,
    sentimentScore: input.sentimentScore ?? null,
    materialityScore: input.materialityScore ?? null,
    relevanceExplanation: input.relevanceExplanation ?? null,
  });
}

export async function recordNewsArticles(
  ticker: string,
  articles: NewsAnalysisInput[],
): Promise<NewsArticle[]> {
  const records: NewsArticle[] = [];

  for (const article of articles) {
    const createdOrUpdated = await recordNewsArticle(ticker, article);
    records.push(createdOrUpdated);
  }

  return records;
}

export async function getRecentNewsForTicker(
  ticker: string,
  limit?: number,
): Promise<NewsArticle[]> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  return listRecentNewsByTicker(normalizedTicker, normalizeListLimit(limit));
}

/**
 * Builds sentiment and materiality aggregates from recent local articles.
 */
export async function getNewsSentimentSummary(
  ticker: string,
  limit?: number,
): Promise<NewsSentimentSummary> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const articles = await getRecentNewsForTicker(normalizedTicker, limit);

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  let mixedCount = 0;

  const sentimentScores: number[] = [];
  const materialityScores: number[] = [];

  for (const article of articles) {
    if (article.sentiment === Sentiment.BULLISH) {
      bullishCount += 1;
    } else if (article.sentiment === Sentiment.BEARISH) {
      bearishCount += 1;
    } else if (article.sentiment === Sentiment.NEUTRAL) {
      neutralCount += 1;
    } else if (article.sentiment === Sentiment.MIXED) {
      mixedCount += 1;
    }

    if (article.sentimentScore != null) {
      sentimentScores.push(article.sentimentScore);
    }

    if (article.materialityScore != null) {
      materialityScores.push(article.materialityScore);
    }
  }

  return {
    ticker: normalizedTicker,
    totalArticles: articles.length,
    bullishCount,
    bearishCount,
    neutralCount,
    mixedCount,
    averageSentimentScore: average(sentimentScores),
    averageMaterialityScore: average(materialityScores),
  };
}
