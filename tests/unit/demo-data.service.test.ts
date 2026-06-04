import { describe, expect, it } from "vitest";

import {
  createTestAIReport,
  createTestHolding,
  createTestPortfolio,
  createTestPrediction,
  createTestStock,
} from "../../src/test/factories";
import { testPrisma } from "../../src/test/test-db";
import { purgeDemoAnalyticalData } from "../../src/services/demo-data.service";

async function seedDemoAnalyticalRows(ticker: string): Promise<{ stockId: string }> {
  const stock = await createTestStock(ticker);

  await testPrisma.priceSnapshot.create({
    data: {
      stockId: stock.id,
      source: "DEMO",
      price: 100,
      capturedAt: new Date("2026-06-04T20:00:00.000Z"),
    },
  });

  await testPrisma.fundamentalSnapshot.create({
    data: {
      stockId: stock.id,
      source: "Demo Fundamentals (Local Fake Data)",
      peRatio: 30,
      capturedAt: new Date("2026-06-04T20:00:00.000Z"),
    },
  });

  await testPrisma.newsArticle.create({
    data: {
      stockId: stock.id,
      headline: "[DEMO] Local fake headline",
      source: "Demo News (Local Fake Data)",
      url: `https://demo.local/news/${ticker.toLowerCase()}-purge`,
      publishedAt: new Date("2026-06-04T20:00:00.000Z"),
    },
  });

  await testPrisma.earningsEvent.create({
    data: {
      stockId: stock.id,
      earningsDate: new Date("2026-07-01T20:00:00.000Z"),
      guidanceSummary: "[DEMO] Local fake earnings event",
      earningsCallUrl: `https://demo.local/earnings/${ticker.toLowerCase()}/call`,
      transcriptUrl: `https://demo.local/earnings/${ticker.toLowerCase()}/transcript`,
    },
  });

  const report = await createTestAIReport(stock.id, {
    stockId: stock.id,
    reportDate: new Date("2026-06-04T20:00:00.000Z"),
    keyTakeaway: "[TEST] Purge demo report",
    sourceReferences: {
      deterministicMock: true,
      source: "local-repository-data-only",
    },
  });

  await createTestPrediction(stock.id, {
    stockId: stock.id,
    aiReportId: report.id,
    predictionDate: new Date("2026-06-04T20:00:00.000Z"),
    confidenceScore: 0.7,
    startingPrice: 100,
  });

  return { stockId: stock.id };
}

describe("demo-data purge", () => {
  it("purges demo analytical rows while keeping core entities", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTPURG1");
    await createTestHolding(portfolio.id, stock.id);

    await seedDemoAnalyticalRows("TSTPURG1");

    const userCountBefore = await testPrisma.user.count();
    const portfolioCountBefore = await testPrisma.portfolio.count();
    const holdingCountBefore = await testPrisma.holding.count();
    const stockCountBefore = await testPrisma.stock.count();

    const result = await purgeDemoAnalyticalData({ ticker: "TSTPURG1" });

    expect(result.priceSnapshotsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.fundamentalSnapshotsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.newsArticlesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.earningsEventsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.aiReportsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.predictionsDeleted).toBeGreaterThanOrEqual(1);

    expect(await testPrisma.user.count()).toBe(userCountBefore);
    expect(await testPrisma.portfolio.count()).toBe(portfolioCountBefore);
    expect(await testPrisma.holding.count()).toBe(holdingCountBefore);
    expect(await testPrisma.stock.count()).toBe(stockCountBefore);
  });

  it("purge by ticker only affects targeted ticker", async () => {
    await seedDemoAnalyticalRows("TSTPURG2A");
    await seedDemoAnalyticalRows("TSTPURG2B");

    const stockA = await testPrisma.stock.findUnique({ where: { ticker: "TSTPURG2A" } });
    const stockB = await testPrisma.stock.findUnique({ where: { ticker: "TSTPURG2B" } });

    expect(stockA).not.toBeNull();
    expect(stockB).not.toBeNull();

    await purgeDemoAnalyticalData({ ticker: "TSTPURG2A" });

    const countA = await testPrisma.priceSnapshot.count({ where: { stockId: stockA!.id, source: "DEMO" } });
    const countB = await testPrisma.priceSnapshot.count({ where: { stockId: stockB!.id, source: "DEMO" } });

    expect(countA).toBe(0);
    expect(countB).toBeGreaterThanOrEqual(1);
  });

  it("purge by portfolio affects holdings in that portfolio", async () => {
    const portfolio = await createTestPortfolio();
    const stockA = await createTestStock("TSTPURG3A");
    const stockB = await createTestStock("TSTPURG3B");

    await createTestHolding(portfolio.id, stockA.id);
    await createTestHolding(portfolio.id, stockB.id);

    await seedDemoAnalyticalRows("TSTPURG3A");
    await seedDemoAnalyticalRows("TSTPURG3B");

    const otherStock = await createTestStock("TSTPURG3C");
    await testPrisma.priceSnapshot.create({
      data: {
        stockId: otherStock.id,
        source: "DEMO",
        price: 101,
        capturedAt: new Date("2026-06-04T20:00:00.000Z"),
      },
    });

    await purgeDemoAnalyticalData({ portfolioId: portfolio.id });

    const otherCount = await testPrisma.priceSnapshot.count({
      where: { stockId: otherStock.id, source: "DEMO" },
    });

    expect(otherCount).toBeGreaterThanOrEqual(1);
  });

  it("allowLegacyDemoPurge removes null-source legacy rows when FMP historical exists for same day", async () => {
    const stock = await createTestStock("TSTPURGLEG");

    const dayLegacy = new Date("2026-05-01T20:00:00.000Z");
    const dayFmp = new Date("2026-05-01T00:00:00.000Z");
    const dayQuote = new Date("2026-05-01T15:30:00.000Z");

    await testPrisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        source: null,
        price: 210,
        capturedAt: dayLegacy,
      },
    });

    await testPrisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        source: "FMP_HISTORICAL",
        price: 310,
        capturedAt: dayFmp,
      },
    });

    await testPrisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        source: "FMP_QUOTE",
        price: 312,
        capturedAt: dayQuote,
      },
    });

    const noLegacyPurge = await purgeDemoAnalyticalData({
      ticker: "TSTPURGLEG",
      allowLegacyDemoPurge: false,
    });

    expect(noLegacyPurge.priceSnapshotsDeleted).toBe(0);

    const withLegacyPurge = await purgeDemoAnalyticalData({
      ticker: "TSTPURGLEG",
      allowLegacyDemoPurge: true,
    });

    expect(withLegacyPurge.priceSnapshotsDeleted).toBeGreaterThanOrEqual(1);

    const remainingNullSource = await testPrisma.priceSnapshot.count({
      where: {
        stockId: stock.id,
        source: null,
      },
    });

    const remainingFmpHistorical = await testPrisma.priceSnapshot.count({
      where: {
        stockId: stock.id,
        source: "FMP_HISTORICAL",
      },
    });

    const remainingFmpQuote = await testPrisma.priceSnapshot.count({
      where: {
        stockId: stock.id,
        source: "FMP_QUOTE",
      },
    });

    expect(remainingNullSource).toBe(0);
    expect(remainingFmpHistorical).toBe(1);
    expect(remainingFmpQuote).toBe(1);
  });
});
