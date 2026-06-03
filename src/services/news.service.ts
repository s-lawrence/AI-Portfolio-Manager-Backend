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
