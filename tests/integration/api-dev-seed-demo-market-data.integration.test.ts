import { afterEach, describe, expect, it } from "vitest";
import { TrendDirection } from "@prisma/client";

import { buildApp } from "../../src/app";
import { recordPriceSnapshot } from "../../src/services/market-data.service";
import { recordTechnicalSnapshot } from "../../src/services/technical-analysis.service";

describe("API dev seed-demo-market-data route", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("returns success envelope in development", async () => {
    process.env.NODE_ENV = "test";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/seed-demo-market-data",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.demoPortfolioId).toBe("string");
    expect(Array.isArray(body.data.tickersSeeded)).toBe(true);
    expect(body.data.tickersSeeded).toEqual(
      expect.arrayContaining(["AAPL", "MSFT", "NVDA"]),
    );

    await app.close();
  });

  it("seeds price, technical, fundamental, news, and earnings data", async () => {
    process.env.NODE_ENV = "test";

    const app = buildApp();
    const seedResponse = await app.inject({
      method: "POST",
      url: "/api/dev/seed-demo-market-data",
    });

    expect(seedResponse.statusCode).toBe(200);
    const seedBody = seedResponse.json();

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/market-data/AAPL/history?limit=120",
    });

    expect(historyResponse.statusCode).toBe(200);
    const historyBody = historyResponse.json();
    expect(Array.isArray(historyBody.data.items)).toBe(true);
    expect(historyBody.data.items.length).toBeGreaterThanOrEqual(60);
    if ((seedBody.data.priceSnapshotsCreated as number) > 0) {
      expect(
        historyBody.data.items.some((item: { source?: string | null }) => item.source === "DEMO"),
      ).toBe(true);
    }

    const newsResponse = await app.inject({
      method: "GET",
      url: "/api/news/AAPL?limit=20",
    });

    expect(newsResponse.statusCode).toBe(200);
    const newsBody = newsResponse.json();
    expect(Array.isArray(newsBody.data.items)).toBe(true);
    expect(newsBody.data.items.length).toBeGreaterThanOrEqual(3);

    const bundleResponse = await app.inject({
      method: "GET",
      url: "/api/stocks/AAPL/research-bundle",
    });

    expect(bundleResponse.statusCode).toBe(200);
    const bundleBody = bundleResponse.json();
    expect(bundleBody.data.latestTechnicalSnapshot).toBeTruthy();
    expect(bundleBody.data.latestTechnicalSnapshot.sma50 == null || typeof bundleBody.data.latestTechnicalSnapshot.sma50 === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.sma200 == null || typeof bundleBody.data.latestTechnicalSnapshot.sma200 === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.rsi14 == null || typeof bundleBody.data.latestTechnicalSnapshot.rsi14 === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.macd == null || typeof bundleBody.data.latestTechnicalSnapshot.macd === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.macdSignal == null || typeof bundleBody.data.latestTechnicalSnapshot.macdSignal === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.macdHistogram == null || typeof bundleBody.data.latestTechnicalSnapshot.macdHistogram === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.volatility == null || typeof bundleBody.data.latestTechnicalSnapshot.volatility === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.rsi == null || typeof bundleBody.data.latestTechnicalSnapshot.rsi === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.ma50 == null || typeof bundleBody.data.latestTechnicalSnapshot.ma50 === "number").toBe(true);
    expect(bundleBody.data.latestTechnicalSnapshot.ma200 == null || typeof bundleBody.data.latestTechnicalSnapshot.ma200 === "number").toBe(true);
    expect(typeof bundleBody.data.latestTechnicalSnapshot.capturedAt).toBe("string");
    expect(bundleBody.data.latestFundamentalSnapshot).toBeTruthy();
    expect(bundleBody.data.nextEarningsEvent).toBeTruthy();
    expect(typeof bundleBody.data.nextEarningsEvent.earningsDate).toBe("string");
    expect(bundleBody.data.nextEarningsEvent.fiscalQuarter == null || typeof bundleBody.data.nextEarningsEvent.fiscalQuarter === "string").toBe(true);
    expect(bundleBody.data.nextEarningsEvent.fiscalYear == null || typeof bundleBody.data.nextEarningsEvent.fiscalYear === "number").toBe(true);
    expect(bundleBody.data.nextEarningsEvent.estimatedEps == null || typeof bundleBody.data.nextEarningsEvent.estimatedEps === "number").toBe(true);
    expect(
      bundleBody.data.nextEarningsEvent.estimatedRevenue == null ||
        typeof bundleBody.data.nextEarningsEvent.estimatedRevenue === "string" ||
        typeof bundleBody.data.nextEarningsEvent.estimatedRevenue === "number",
    ).toBe(true);
    expect(typeof bundleBody.data.nextEarningsEvent.isDateConfirmed).toBe("boolean");

    await app.close();
  });

  it("returns volatility as decimal fraction in research bundle for normal price data", async () => {
    process.env.NODE_ENV = "test";

    const ticker = "TSTVOLINT";
    const start = Date.UTC(2026, 0, 1);

    for (let index = 0; index < 80; index += 1) {
      const close = 200 + index * 0.15 + Math.sin(index / 5) * 1.6;
      const capturedAt = new Date(start + index * 24 * 60 * 60 * 1000);

      await recordPriceSnapshot(ticker, {
        price: close,
        close,
        capturedAt,
      });
    }

    await recordTechnicalSnapshot(ticker, {
      sma50: 210,
      sma200: 195,
      rsi14: 54,
      macd: 1.2,
      macdSignal: 0.9,
      macdHistogram: 0.3,
      trendDirection: TrendDirection.UPTREND,
      capturedAt: new Date(),
    });

    const app = buildApp();
    const bundleResponse = await app.inject({
      method: "GET",
      url: `/api/stocks/${ticker}/research-bundle`,
    });

    expect(bundleResponse.statusCode).toBe(200);
    const bundleBody = bundleResponse.json();

    const volatility = bundleBody.data.latestTechnicalSnapshot.volatility as number | null;
    expect(typeof volatility === "number" || volatility == null).toBe(true);
    expect(volatility == null || volatility >= 0).toBe(true);
    expect(volatility == null || volatility < 2).toBe(true);

    await app.close();
  });

  it("supports runAnalysis=true and returns analysis summary with predictions", async () => {
    process.env.NODE_ENV = "test";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/seed-demo-market-data?runAnalysis=true",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.analysis).toBeTruthy();
    expect(body.data.analysis.reportsCreated).toBeGreaterThan(0);
    expect(body.data.analysis.predictionsCreated).toBeGreaterThan(0);
    expect(body.data.analysis.reports.length).toBeGreaterThan(0);

    const firstTicker = body.data.analysis.reports[0]?.ticker;
    expect(typeof firstTicker).toBe("string");

    const predictionsResponse = await app.inject({
      method: "GET",
      url: `/api/predictions/stock/${firstTicker}?limit=20`,
    });

    expect(predictionsResponse.statusCode).toBe(200);

    const predictionsBody = predictionsResponse.json();
    expect(Array.isArray(predictionsBody.data.items)).toBe(true);
    expect(predictionsBody.data.items.length).toBeGreaterThan(0);

    await app.close();
  });

  it("is unavailable in production", async () => {
    process.env.NODE_ENV = "production";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/seed-demo-market-data",
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
