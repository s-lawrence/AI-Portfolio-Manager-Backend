import { NewsArticle, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";

export async function createNewsArticle(
  input: Prisma.NewsArticleUncheckedCreateInput,
): Promise<NewsArticle> {
  return prisma.newsArticle.create({ data: input });
}

/**
 * Upserts a news article keyed by unique URL so repeated ingestions remain idempotent.
 */
export async function upsertNewsArticleByUrl(
  input: Prisma.NewsArticleUncheckedCreateInput,
): Promise<NewsArticle> {
  const normalizedUrl = input.url.trim();
  if (!normalizedUrl) {
    throw new Error("News article URL must be a non-empty string.");
  }

  const createData: Prisma.NewsArticleUncheckedCreateInput = {
    ...input,
    url: normalizedUrl,
  };
  const { url: _ignored, ...updateData } = createData;

  return prisma.newsArticle.upsert({
    where: { url: normalizedUrl },
    create: createData,
    update: updateData,
  });
}

export async function getNewsArticleById(id: string): Promise<NewsArticle | null> {
  return prisma.newsArticle.findUnique({ where: { id } });
}

export async function getNewsArticleByUrl(url: string): Promise<NewsArticle | null> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return null;
  }

  return prisma.newsArticle.findUnique({ where: { url: normalizedUrl } });
}

export async function listNewsByStockId(
  stockId: string,
  limit?: number,
): Promise<NewsArticle[]> {
  return prisma.newsArticle.findMany({
    where: { stockId },
    orderBy: { publishedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function listRecentNewsByTicker(
  ticker: string,
  limit?: number,
): Promise<NewsArticle[]> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);

  return prisma.newsArticle.findMany({
    where: {
      stock: {
        ticker: normalizedTicker,
      },
    },
    orderBy: { publishedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function listRecentNews(limit?: number): Promise<NewsArticle[]> {
  return prisma.newsArticle.findMany({
    orderBy: { publishedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function deleteNewsArticle(id: string): Promise<NewsArticle> {
  return prisma.newsArticle.delete({ where: { id } });
}
