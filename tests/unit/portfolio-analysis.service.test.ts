import { describe, expect, it } from "vitest";

import { runPortfolioAnalysis } from "../../src/services/portfolio-analysis.service";
import {
  createTestHolding,
  createTestPortfolio,
  createTestPriceSnapshot,
  createTestStock,
} from "../../src/test/factories";

describe("portfolio-analysis.service", () => {
  it("creates reports for all holdings with available snapshot data", async () => {
    const portfolio = await createTestPortfolio();

    const stockA = await createTestStock("TSTPAA1");
    const stockB = await createTestStock("TSTPAB1");

    await createTestHolding(portfolio.id, stockA.id);
    await createTestHolding(portfolio.id, stockB.id);

    await createTestPriceSnapshot(stockA.id, { price: 101, previousClose: 100 });
    await createTestPriceSnapshot(stockB.id, { price: 109, previousClose: 107 });

    const result = await runPortfolioAnalysis(portfolio.id);

    expect(result.portfolioId).toBe(portfolio.id);
    expect(result.holdingsAnalyzed).toBe(2);
    expect(result.reportsCreated).toBe(2);
    expect(result.predictionsCreated).toBe(6);
    expect(result.failedTickers).toHaveLength(0);
    expect(result.reports).toHaveLength(2);
  });

  it("creates and returns a portfolio summary", async () => {
    const portfolio = await createTestPortfolio();

    const stock = await createTestStock("TSTPAC1");
    await createTestHolding(portfolio.id, stock.id);
    await createTestPriceSnapshot(stock.id, { price: 120, previousClose: 118 });

    const result = await runPortfolioAnalysis(portfolio.id);

    expect(result.portfolioSummary).not.toBeNull();
    expect(result.portfolioSummary?.id).toBeDefined();
    expect(result.portfolioSummary?.overallSentiment).toBeDefined();
    expect(result.portfolioSummary?.overallRiskLevel).toBeDefined();
  });

  it("continues processing when one holding fails", async () => {
    const portfolio = await createTestPortfolio();

    const successfulStock = await createTestStock("TSTPAD1");
    const failingStock = await createTestStock("TSTPAE1");

    await createTestHolding(portfolio.id, successfulStock.id);
    await createTestHolding(portfolio.id, failingStock.id);

    await createTestPriceSnapshot(successfulStock.id, {
      price: 95,
      previousClose: 94,
    });

    const result = await runPortfolioAnalysis(portfolio.id);

    expect(result.holdingsAnalyzed).toBe(2);
    expect(result.reportsCreated).toBe(1);
    expect(result.predictionsCreated).toBe(3);
    expect(result.failedTickers).toHaveLength(1);
    expect(result.failedTickers[0]?.ticker).toBe("TSTPAE1");
    expect(result.failedTickers[0]?.reason).toMatch(/at least one price snapshot/i);
  });

  it("handles empty portfolios gracefully", async () => {
    const portfolio = await createTestPortfolio();

    const result = await runPortfolioAnalysis(portfolio.id);

    expect(result.holdingsAnalyzed).toBe(0);
    expect(result.reportsCreated).toBe(0);
    expect(result.predictionsCreated).toBe(0);
    expect(result.failedTickers).toEqual([]);
    expect(result.reports).toEqual([]);
    expect(result.portfolioSummary).not.toBeNull();
  });

  it("includes startedAt and finishedAt timestamps", async () => {
    const portfolio = await createTestPortfolio();

    const stock = await createTestStock("TSTPAF1");
    await createTestHolding(portfolio.id, stock.id);
    await createTestPriceSnapshot(stock.id, {
      price: 140,
      previousClose: 139,
    });

    const result = await runPortfolioAnalysis(portfolio.id);

    const startedAtMs = Date.parse(result.startedAt);
    const finishedAtMs = Date.parse(result.finishedAt);

    expect(Number.isNaN(startedAtMs)).toBe(false);
    expect(Number.isNaN(finishedAtMs)).toBe(false);
    expect(finishedAtMs).toBeGreaterThanOrEqual(startedAtMs);
  });
});
