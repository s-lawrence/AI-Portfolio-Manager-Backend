import { RiskLevel, Sentiment } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createPortfolioSummary } from "../../src/repositories/portfolio-summaries.repository";
import {
  generateMockPortfolioSummary,
  getLatestPortfolioSummary,
} from "../../src/services/portfolio-summaries.service";
import {
  createTestAIReport,
  createTestHolding,
  createTestPortfolio,
  createTestStock,
} from "../../src/test/factories";

describe("portfolio-summaries.service", () => {
  it("generates portfolio summary with sentiment and holding counts", async () => {
    const portfolio = await createTestPortfolio();

    const bullishStock = await createTestStock("TSTPSB1");
    const bearishStock = await createTestStock("TSTPSR1");
    const neutralStock = await createTestStock("TSTPSN1");

    await createTestHolding(portfolio.id, bullishStock.id);
    await createTestHolding(portfolio.id, bearishStock.id);
    await createTestHolding(portfolio.id, neutralStock.id);

    await createTestAIReport(bullishStock.id, {
      sentiment: Sentiment.BULLISH,
      riskScore: 20,
      confidenceScore: 0.8,
      bullishFactors: ["Strong demand"],
      bearishFactors: [],
    });

    await createTestAIReport(bearishStock.id, {
      sentiment: Sentiment.BEARISH,
      riskScore: 80,
      confidenceScore: 0.65,
      bullishFactors: [],
      bearishFactors: ["Margin pressure"],
    });

    await createTestAIReport(neutralStock.id, {
      sentiment: Sentiment.NEUTRAL,
      riskScore: 50,
      confidenceScore: 0.55,
      bullishFactors: ["Stable demand"],
      bearishFactors: ["Valuation uncertain"],
    });

    const summary = await generateMockPortfolioSummary(portfolio.id);

    expect(summary.portfolioId).toBe(portfolio.id);
    expect(summary.bullishHoldingsCount).toBe(1);
    expect(summary.bearishHoldingsCount).toBe(1);
    expect(summary.neutralHoldingsCount).toBe(1);
    expect(summary.overallSentiment).toBe(Sentiment.MIXED);
  });

  it("calculates risk and identifies highest-risk ticker", async () => {
    const portfolio = await createTestPortfolio();

    const lowRiskStock = await createTestStock("TSTPSL2");
    const highRiskStock = await createTestStock("TSTPSH2");

    await createTestHolding(portfolio.id, lowRiskStock.id);
    await createTestHolding(portfolio.id, highRiskStock.id);

    await createTestAIReport(lowRiskStock.id, {
      sentiment: Sentiment.BULLISH,
      riskScore: 20,
      confidenceScore: 0.6,
      bullishFactors: ["Execution momentum"],
      bearishFactors: [],
    });

    await createTestAIReport(highRiskStock.id, {
      sentiment: Sentiment.BEARISH,
      riskScore: 90,
      confidenceScore: 0.85,
      bullishFactors: [],
      bearishFactors: ["Balance sheet stress"],
    });

    const summary = await generateMockPortfolioSummary(portfolio.id);

    expect(summary.overallRiskScore).toBeCloseTo(55, 6);
    expect(summary.overallRiskLevel).toBe(RiskLevel.MEDIUM);
    expect(summary.highestRiskTicker).toBe("TSTPSH2");
    expect(summary.highestConvictionTicker).toBe("TSTPSH2");
  });

  it("does not fabricate reports and flags uncovered holdings", async () => {
    const portfolio = await createTestPortfolio();

    const coveredStock = await createTestStock("TSTPSC3");
    const uncoveredStock = await createTestStock("TSTPSU3");

    await createTestHolding(portfolio.id, coveredStock.id);
    await createTestHolding(portfolio.id, uncoveredStock.id);

    await createTestAIReport(coveredStock.id, {
      sentiment: Sentiment.BULLISH,
      riskScore: 35,
      confidenceScore: 0.7,
      bullishFactors: ["Coverage present"],
      bearishFactors: [],
    });

    const summary = await generateMockPortfolioSummary(portfolio.id);

    expect(summary.neutralHoldingsCount).toBe(1);
    expect(summary.suggestedWatchItems).toHaveLength(1);
    expect(summary.suggestedWatchItems[0]).toContain("TSTPSU3");
  });

  it("returns the newest portfolio summary", async () => {
    const portfolio = await createTestPortfolio();

    await createPortfolioSummary({
      portfolioId: portfolio.id,
      summaryDate: new Date("2026-07-01T00:00:00.000Z"),
      overallSentiment: Sentiment.NEUTRAL,
      overallRiskScore: 50,
      overallRiskLevel: RiskLevel.MEDIUM,
      bullishHoldingsCount: 0,
      bearishHoldingsCount: 0,
      neutralHoldingsCount: 0,
      topPositiveDevelopments: [],
      topNegativeDevelopments: [],
      highestRiskTicker: null,
      highestConvictionTicker: null,
      upcomingEarnings: [],
      concentrationRisks: [],
      suggestedWatchItems: [],
    });

    const newest = await createPortfolioSummary({
      portfolioId: portfolio.id,
      summaryDate: new Date("2026-07-02T00:00:00.000Z"),
      overallSentiment: Sentiment.BULLISH,
      overallRiskScore: 25,
      overallRiskLevel: RiskLevel.LOW,
      bullishHoldingsCount: 1,
      bearishHoldingsCount: 0,
      neutralHoldingsCount: 0,
      topPositiveDevelopments: ["Improving trend"],
      topNegativeDevelopments: [],
      highestRiskTicker: null,
      highestConvictionTicker: null,
      upcomingEarnings: [],
      concentrationRisks: [],
      suggestedWatchItems: [],
    });

    const latest = await getLatestPortfolioSummary(portfolio.id);

    expect(latest?.id).toBe(newest.id);
    expect(latest?.summaryDate.toISOString()).toBe("2026-07-02T00:00:00.000Z");
  });
});
