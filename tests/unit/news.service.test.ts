import { Sentiment } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  getNewsSentimentSummary,
  getRecentNewsForTicker,
  recordNewsArticle,
  recordNewsArticles,
} from "../../src/services/news.service";
import { getStockProfile } from "../../src/services/stocks.service";

let tickerSequence = 0;

function nextTicker(): string {
  tickerSequence += 1;
  return `TSTNEWS${tickerSequence}`;
}

describe("news.service", () => {
  it("records a news article and creates stock if missing", async () => {
    const ticker = nextTicker();

    const article = await recordNewsArticle(ticker, {
      headline: "  [TEST] Company ships new product  ",
      url: "  https://example.com/news/test-story  ",
      source: "test-wire",
      publishedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    const stock = await getStockProfile(ticker);

    expect(stock).not.toBeNull();
    expect(article.stockId).toBe(stock?.id);
    expect(article.headline).toBe("[TEST] Company ships new product");
    expect(article.url).toBe("https://example.com/news/test-story");
  });

  it("deduplicates by URL via upsert behavior", async () => {
    const ticker = nextTicker();
    const url = "https://example.com/news/unique-story";

    const first = await recordNewsArticle(ticker, {
      headline: "[TEST] Initial headline",
      url,
      sentiment: Sentiment.NEUTRAL,
      publishedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    const second = await recordNewsArticle(ticker, {
      headline: "[TEST] Updated headline",
      url,
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.8,
      publishedAt: new Date("2026-04-01T01:00:00.000Z"),
    });

    const recent = await getRecentNewsForTicker(ticker, 10);

    expect(second.id).toBe(first.id);
    expect(second.headline).toBe("[TEST] Updated headline");
    expect(recent).toHaveLength(1);
  });

  it("records multiple articles and returns newest first", async () => {
    const ticker = nextTicker();

    await recordNewsArticles(ticker, [
      {
        headline: "[TEST] Older article",
        url: "https://example.com/news/older",
        publishedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        headline: "[TEST] Newer article",
        url: "https://example.com/news/newer",
        publishedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);

    const recent = await getRecentNewsForTicker(ticker, 5);

    expect(recent).toHaveLength(2);
    expect(recent[0]?.headline).toBe("[TEST] Newer article");
    expect(recent[1]?.headline).toBe("[TEST] Older article");
  });

  it("builds sentiment/materiality summary counts and averages", async () => {
    const ticker = nextTicker();

    await recordNewsArticles(ticker, [
      {
        headline: "[TEST] Bullish 1",
        url: "https://example.com/news/bull-1",
        publishedAt: new Date("2026-04-01T00:00:00.000Z"),
        sentiment: Sentiment.BULLISH,
        sentimentScore: 0.7,
        materialityScore: 0.6,
      },
      {
        headline: "[TEST] Bullish 2",
        url: "https://example.com/news/bull-2",
        publishedAt: new Date("2026-04-01T01:00:00.000Z"),
        sentiment: Sentiment.BULLISH,
        sentimentScore: 0.9,
        materialityScore: 0.8,
      },
      {
        headline: "[TEST] Bearish",
        url: "https://example.com/news/bear-1",
        publishedAt: new Date("2026-04-01T02:00:00.000Z"),
        sentiment: Sentiment.BEARISH,
        sentimentScore: -0.6,
        materialityScore: 0.5,
      },
      {
        headline: "[TEST] Mixed",
        url: "https://example.com/news/mixed-1",
        publishedAt: new Date("2026-04-01T03:00:00.000Z"),
        sentiment: Sentiment.MIXED,
      },
    ]);

    const summary = await getNewsSentimentSummary(ticker, 10);

    expect(summary.totalArticles).toBe(4);
    expect(summary.bullishCount).toBe(2);
    expect(summary.bearishCount).toBe(1);
    expect(summary.mixedCount).toBe(1);
    expect(summary.neutralCount).toBe(0);
    expect(summary.averageSentimentScore).toBeCloseTo(1 / 3, 6);
    expect(summary.averageMaterialityScore).toBeCloseTo(19 / 30, 6);
  });
});
