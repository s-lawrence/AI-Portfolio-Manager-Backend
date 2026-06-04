import {
  HoldingStatus,
  Recommendation,
  Sentiment,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { updateHolding } from "../../src/repositories/holdings.repository";
import { getPortfolioOverview } from "../../src/services/portfolios.service";
import {
  createTestAIReport,
  createTestHolding,
  createTestPortfolio,
  createTestPriceSnapshot,
  createTestStock,
} from "../../src/test/factories";

describe("portfolios.service", () => {
  it("projects latest price fields and computes owned-only estimated market value", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPOV1");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 10,
      averageCost: 95,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 120,
      previousClose: 115,
      changePercent: 4.35,
      volume: BigInt(9_000),
      marketCap: BigInt("9007199254740993"),
      capturedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const overview = await getPortfolioOverview(portfolio.id);

    expect(overview).not.toBeNull();
    const summary = overview?.holdings.find((item) => item.id === holding.id);

    expect(summary).toBeDefined();
    expect(summary?.latestPrice).toBe(120);
    expect(summary?.latestPriceCapturedAt).toEqual(new Date("2026-05-01T00:00:00.000Z"));
    expect(summary?.dailyChangePercent).toBeCloseTo(4.35);
    expect(summary?.previousClose).toBe(115);
    expect(summary?.volume).toBe(9_000);
    expect(summary?.marketCap).toBe("9007199254740993");
    expect(summary?.currency).toBe("USD");
    expect(summary?.exchange).toBe("NASDAQ");
    expect(overview?.estimatedMarketValue).toBe(1200);
  });

  it("projects latest AI report summary fields per holding", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPOV2");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await createTestAIReport(stock.id, {
      recommendation: Recommendation.BUY,
      sentiment: Sentiment.BULLISH,
      confidenceScore: 0.87,
      riskScore: 31,
      reportDate: new Date("2026-05-02T00:00:00.000Z"),
    });

    const overview = await getPortfolioOverview(portfolio.id);
    const summary = overview?.holdings.find((item) => item.id === holding.id);

    expect(summary).toBeDefined();
    expect(summary?.latestRecommendation).toBe(Recommendation.BUY);
    expect(summary?.latestSentiment).toBe(Sentiment.BULLISH);
    expect(summary?.latestConfidenceScore).toBeCloseTo(0.87);
    expect(summary?.latestRiskScore).toBe(31);
    expect(summary?.latestReportDate).toEqual(new Date("2026-05-02T00:00:00.000Z"));
  });

  it("returns null latest price fields and does not crash when snapshot is missing", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPOV3");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 8,
    });

    const overview = await getPortfolioOverview(portfolio.id);
    const summary = overview?.holdings.find((item) => item.id === holding.id);

    expect(summary).toBeDefined();
    expect(summary?.latestPrice).toBeNull();
    expect(summary?.latestPriceCapturedAt).toBeNull();
    expect(summary?.dailyChangePercent).toBeNull();
    expect(summary?.previousClose).toBeNull();
    expect(summary?.volume).toBeNull();
    expect(summary?.marketCap).toBeNull();
    expect(overview?.estimatedMarketValue).toBeNull();
  });
});