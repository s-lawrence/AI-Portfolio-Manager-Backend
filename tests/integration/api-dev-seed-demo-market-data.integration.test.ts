import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";

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

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/market-data/AAPL/history?limit=120",
    });

    expect(historyResponse.statusCode).toBe(200);
    const historyBody = historyResponse.json();
    expect(Array.isArray(historyBody.data.items)).toBe(true);
    expect(historyBody.data.items.length).toBeGreaterThanOrEqual(60);

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
    expect(bundleBody.data.latestFundamentalSnapshot).toBeTruthy();
    expect(bundleBody.data.nextEarningsEvent).toBeTruthy();

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
