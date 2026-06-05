import { HoldingStatus, Sentiment, TrendDirection } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createUser } from "../../src/repositories/users.repository";
import { generateMockTickerReport } from "../../src/services/ai-reports.service";
import { recordFundamentalSnapshot } from "../../src/services/fundamentals.service";
import {
  addTickerToPortfolio,
  getHoldingOverview,
} from "../../src/services/holdings.service";
import {
  recordPriceSnapshot,
} from "../../src/services/market-data.service";
import { recordNewsArticles } from "../../src/services/news.service";
import {
  generateMockPortfolioSummary,
} from "../../src/services/portfolio-summaries.service";
import {
  createPortfolioForUser,
  getPortfolioOverview,
} from "../../src/services/portfolios.service";
import { scoreDuePredictions } from "../../src/services/predictions.service";
import {
  calculateTechnicalSnapshot,
  recordTechnicalSnapshot,
} from "../../src/services/technical-analysis.service";

describe("portfolio workflow integration", () => {
  it("runs through a realistic end-to-end workflow with linked records", async () => {
    const user = await createUser({
      email: "test+auto-workflow@example.com",
      name: "[TEST] Workflow User",
    });

    const portfolio = await createPortfolioForUser(user.id, {
      name: "[TEST] Workflow Portfolio",
      description: "End-to-end portfolio workflow test",
      baseCurrency: "USD",
    });

    const holding = await addTickerToPortfolio(portfolio.id, "TSTFLOW1", {
      status: HoldingStatus.OWNED,
      shares: 12,
      averageCost: 95,
      thesis: "[TEST] Workflow position",
    });

    await recordPriceSnapshot("TSTFLOW1", {
      price: 95,
      previousClose: 93,
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    await recordPriceSnapshot("TSTFLOW1", {
      price: 100,
      previousClose: 95,
      capturedAt: new Date("2026-09-02T00:00:00.000Z"),
    });

    await recordPriceSnapshot("TSTFLOW1", {
      price: 108,
      previousClose: 100,
      capturedAt: new Date("2026-09-03T00:00:00.000Z"),
    });

    const computedTechnical = await calculateTechnicalSnapshot("TSTFLOW1");
    expect(computedTechnical).not.toBeNull();

    await recordTechnicalSnapshot("TSTFLOW1", {
      ...computedTechnical,
      trendDirection:
        computedTechnical?.trendDirection ?? TrendDirection.UPTREND,
      capturedAt: new Date("2026-09-03T00:10:00.000Z"),
    });

    await recordFundamentalSnapshot("TSTFLOW1", {
      capturedAt: new Date("2026-09-03T00:20:00.000Z"),
      marketCap: BigInt(120_000_000_000),
      peRatio: 26,
      revenueGrowth: 0.18,
      debtToEquity: 0.7,
    });

    await recordNewsArticles("TSTFLOW1", [
      {
        headline: "[TEST] Product demand remains strong",
        url: "https://example.com/workflow/news-1",
        sentiment: Sentiment.BULLISH,
        sentimentScore: 0.75,
        materialityScore: 0.7,
        publishedAt: new Date("2026-09-03T01:00:00.000Z"),
      },
      {
        headline: "[TEST] Analysts raise targets",
        url: "https://example.com/workflow/news-2",
        sentiment: Sentiment.BULLISH,
        sentimentScore: 0.8,
        materialityScore: 0.6,
        publishedAt: new Date("2026-09-03T02:00:00.000Z"),
      },
    ]);

    const reportResult = await generateMockTickerReport("TSTFLOW1", holding.id);
    const summary = await generateMockPortfolioSummary(portfolio.id);

    const holdingOverview = await getHoldingOverview(holding.id);
    const portfolioOverview = await getPortfolioOverview(portfolio.id);

    const scoring = await scoreDuePredictions(new Date("2030-01-01T00:00:00.000Z"));

    expect(reportResult.report.stockId).toBe(holding.stockId);
    expect(reportResult.report.holdingId).toBe(holding.id);
    expect(reportResult.predictions).toHaveLength(3);

    expect(summary.portfolioId).toBe(portfolio.id);
    expect(summary.bullishHoldingsCount).toBeGreaterThanOrEqual(1);

    expect(holdingOverview).not.toBeNull();
    expect(holdingOverview?.latestAIReport?.id).toBe(reportResult.report.id);
    expect(holdingOverview?.latestPriceNative).toBe(108);
    expect(holdingOverview?.marketValueNative).toBe(1296);
    expect(holdingOverview?.costBasisNative).toBe(1140);
    expect(holdingOverview?.unrealizedGainLossNative).toBe(156);
    expect(holdingOverview?.unrealizedGainLossPercent).toBeCloseTo(13.68, 2);
    expect(holdingOverview?.conversionStatus).toBe("UNSUPPORTED_CURRENCY");
    expect(holdingOverview?.marketValueCad).toBeNull();

    expect(portfolioOverview).not.toBeNull();
    expect(portfolioOverview?.holdings).toHaveLength(1);

    expect(scoring.totalDue).toBeGreaterThanOrEqual(3);
    expect(
      scoring.scoredCount + scoring.alreadyScoredCount + scoring.skippedNoPriceCount,
    ).toBe(scoring.totalDue);
  });
});
