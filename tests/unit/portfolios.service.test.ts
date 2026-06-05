import {
  HoldingStatus,
  Recommendation,
  Sentiment,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { updateHolding } from "../../src/repositories/holdings.repository";
import { updateStock } from "../../src/repositories/stocks.repository";
import { upsertFxRateSnapshot } from "../../src/services/fx-rates.service";
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
    expect(summary?.marketValue).toBe(1200);
    expect(summary?.costBasis).toBe(950);
    expect(summary?.unrealizedGainLoss).toBe(250);
    expect(overview?.estimatedMarketValue).toBe(1200);
    expect(overview?.portfolioBaseCurrency).toBe("CAD");
    expect(overview?.totalMarketValueNative).toBe(1200);
    expect(overview?.totalMarketValueCad).toBeNull();
    expect(overview?.holdingsMissingFx).toEqual([
      {
        ticker: stock.ticker,
        currency: "USD",
      },
    ]);
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

  it("sums CAD totals across USD-converted and CAD-native owned holdings", async () => {
    const portfolio = await createTestPortfolio();

    const usdStock = await createTestStock("TSTPOVCAD1");
    const usdHolding = await createTestHolding(portfolio.id, usdStock.id);

    await updateHolding(usdHolding.id, {
      status: HoldingStatus.OWNED,
      shares: 10,
      averageCost: 90,
    });

    await createTestPriceSnapshot(usdStock.id, {
      price: 100,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const cadStock = await createTestStock("TSTPOVCAD2");
    await updateStock(cadStock.id, { currency: "CAD" });
    const cadHolding = await createTestHolding(portfolio.id, cadStock.id);

    await updateHolding(cadHolding.id, {
      status: HoldingStatus.OWNED,
      shares: 5,
      averageCost: 40,
    });

    await createTestPriceSnapshot(cadStock.id, {
      price: 50,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.4,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const overview = await getPortfolioOverview(portfolio.id);

    expect(overview).not.toBeNull();
    expect(overview?.totalMarketValueCad).toBe(1650);
    expect(overview?.totalCostBasisCad).toBe(1460);
    expect(overview?.totalUnrealizedGainLossCad).toBe(190);
    expect(overview?.totalUnrealizedGainLossPercentCad).toBe(13.01);
    expect(overview?.fxRateUsed).toEqual({
      pair: "USD/CAD",
      rate: 1.4,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });
    expect(overview?.holdingsMissingFx).toHaveLength(0);
    expect(overview?.holdingsUnsupportedCurrency).toHaveLength(0);
    expect(overview?.totalMarketValueNative).toBeNull();
  });

  it("excludes watchlist holdings from CAD totals", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPOVCAD3");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 10,
      averageCost: 90,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 100,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const watchlistStock = await createTestStock("TSTPOVCAD4");
    const watchlistHolding = await createTestHolding(portfolio.id, watchlistStock.id);

    await updateHolding(watchlistHolding.id, {
      status: HoldingStatus.WATCHLIST,
      shares: 200,
      averageCost: 40,
    });

    await createTestPriceSnapshot(watchlistStock.id, {
      price: 50,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.3,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const overview = await getPortfolioOverview(portfolio.id);

    expect(overview).not.toBeNull();
    expect(overview?.totalMarketValueCad).toBe(1300);
    expect(overview?.totalCostBasisCad).toBe(1170);
  });

  it("excludes missing FX holdings from CAD totals and reports missing list", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPOVCAD5");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 10,
      averageCost: 90,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 100,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const overview = await getPortfolioOverview(portfolio.id);

    expect(overview).not.toBeNull();
    expect(overview?.totalMarketValueCad).toBeNull();
    expect(overview?.totalCostBasisCad).toBeNull();
    expect(overview?.totalUnrealizedGainLossCad).toBeNull();
    expect(overview?.totalUnrealizedGainLossPercentCad).toBeNull();
    expect(overview?.holdingsMissingFx).toEqual([
      {
        ticker: stock.ticker,
        currency: "USD",
      },
    ]);
  });

  it("tracks unsupported-currency holdings separately from missing FX", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPOVCAD6");
    await updateStock(stock.id, { currency: "EUR" });
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 10,
      averageCost: 90,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 100,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const overview = await getPortfolioOverview(portfolio.id);
    const summary = overview?.holdings.find((item) => item.id === holding.id);

    expect(overview).not.toBeNull();
    expect(summary?.conversionStatus).toBe("UNSUPPORTED_CURRENCY");
    expect(summary?.marketValueCad).toBeNull();
    expect(overview?.holdingsMissingFx).toEqual([]);
    expect(overview?.holdingsUnsupportedCurrency).toEqual([
      {
        ticker: stock.ticker,
        currency: "EUR",
      },
    ]);
  });
});