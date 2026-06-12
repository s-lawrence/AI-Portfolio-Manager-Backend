import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { createUser } from "../../src/repositories/users.repository";

async function createPortfolioWithTickers(tickers: string[]): Promise<{
  app: ReturnType<typeof buildApp>;
  portfolioId: string;
}> {
  const app = buildApp();

  const user = await createUser({
    email: `test+api-reports-${Date.now()}@example.com`,
    name: "[TEST] API Reports User",
  });

  const createPortfolioResponse = await app.inject({
    method: "POST",
    url: "/api/portfolios",
    payload: {
      userId: user.id,
      name: "[TEST] Reports Portfolio",
      baseCurrency: "USD",
    },
  });

  expect(createPortfolioResponse.statusCode).toBe(201);
  const portfolioId = createPortfolioResponse.json().data.id as string;

  for (const ticker of tickers) {
    const holdingResponse = await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker,
        status: "OWNED",
        shares: 2,
      },
    });

    expect(holdingResponse.statusCode).toBe(201);

    const snapshotResponse = await app.inject({
      method: "POST",
      url: `/api/market-data/${ticker}/snapshots`,
      payload: {
        price: 100,
        previousClose: 99,
      },
    });

    expect(snapshotResponse.statusCode).toBe(201);
  }

  return { app, portfolioId };
}

describe("API reports routes", () => {
  it("accepts extended generate options and returns report metadata", async () => {
    const { app, portfolioId } = await createPortfolioWithTickers(["NVDA"]);

    const generateResponse = await app.inject({
      method: "POST",
      url: "/api/reports/NVDA/generate",
      payload: {
        portfolioId,
        useOpenAi: false,
        refreshBeforeGenerate: false,
        includeMacro: false,
        includeGeopolitical: false,
        includeNews: true,
        includeAnalyst: true,
        includeScore: true,
        createPredictions: false,
      },
    });

    expect(generateResponse.statusCode).toBe(201);
    const body = generateResponse.json();
    expect(body.success).toBe(true);
    expect(body.data.report.id).toBeDefined();
    expect(body.data.reportMode).toBeDefined();
    expect(Array.isArray(body.data.predictions)).toBe(true);
    expect(body.data.predictions).toHaveLength(0);

    await app.close();
  });

  it("filters report list by ticker and includes stock metadata", async () => {
    const { app } = await createPortfolioWithTickers(["AAPL", "MSFT"]);

    await app.inject({
      method: "PATCH",
      url: "/api/stocks/AAPL",
      payload: {
        companyName: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        sector: "Technology",
        industry: "Consumer Electronics",
      },
    });

    await app.inject({
      method: "PATCH",
      url: "/api/stocks/MSFT",
      payload: {
        companyName: "Microsoft Corporation",
        exchange: "NASDAQ",
        currency: "USD",
        sector: "Technology",
        industry: "Software",
      },
    });

    const createAaplReportResponse = await app.inject({
      method: "POST",
      url: "/api/reports",
      payload: {
        ticker: "AAPL",
        recommendation: "HOLD",
        sentiment: "NEUTRAL",
        confidenceScore: 0.6,
        riskScore: 45,
        riskLevel: "MEDIUM",
        keyTakeaway: "AAPL deterministic report",
        createPredictions: false,
      },
    });

    expect(createAaplReportResponse.statusCode).toBe(201);

    const createMsftReportResponse = await app.inject({
      method: "POST",
      url: "/api/reports",
      payload: {
        ticker: "MSFT",
        recommendation: "HOLD",
        sentiment: "NEUTRAL",
        confidenceScore: 0.6,
        riskScore: 45,
        riskLevel: "MEDIUM",
        keyTakeaway: "MSFT deterministic report",
        createPredictions: false,
      },
    });

    expect(createMsftReportResponse.statusCode).toBe(201);

    const aaplReportsResponse = await app.inject({
      method: "GET",
      url: "/api/reports/AAPL?limit=20",
    });

    expect(aaplReportsResponse.statusCode).toBe(200);
    const aaplBody = aaplReportsResponse.json();
    expect(aaplBody.success).toBe(true);
    expect(Array.isArray(aaplBody.data.items)).toBe(true);
    expect(aaplBody.data.items.length).toBeGreaterThan(0);
    expect(aaplBody.data.items.every((item: { ticker: string }) => item.ticker === "AAPL")).toBe(
      true,
    );
    expect(aaplBody.data.items[0]?.companyName).toBe("Apple Inc.");

    const msftReportsResponse = await app.inject({
      method: "GET",
      url: "/api/reports/MSFT?limit=20",
    });

    expect(msftReportsResponse.statusCode).toBe(200);
    const msftBody = msftReportsResponse.json();
    expect(msftBody.success).toBe(true);
    expect(msftBody.data.items.length).toBeGreaterThan(0);
    expect(msftBody.data.items.every((item: { ticker: string }) => item.ticker === "MSFT")).toBe(
      true,
    );

    const latestAaplResponse = await app.inject({
      method: "GET",
      url: "/api/reports/AAPL/latest",
    });

    expect(latestAaplResponse.statusCode).toBe(200);
    const latestAaplBody = latestAaplResponse.json();
    expect(latestAaplBody.success).toBe(true);
    expect(latestAaplBody.data.ticker).toBe("AAPL");
    expect(latestAaplBody.data.companyName).toBe("Apple Inc.");
    expect(latestAaplBody.data.exchange).toBe("NASDAQ");
    expect(latestAaplBody.data.currency).toBe("USD");
    expect(latestAaplBody.data.sector).toBe("Technology");
    expect(latestAaplBody.data.industry).toBe("Consumer Electronics");

    await app.close();
  });
});
