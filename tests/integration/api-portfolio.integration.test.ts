import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { createUser } from "../../src/repositories/users.repository";

let sequence = 0;

function nextToken(): string {
  sequence += 1;
  return String(sequence).padStart(4, "0");
}

describe("API portfolio workflow routes", () => {
  it("creates portfolio, adds holding, and generates mock report", async () => {
    const app = buildApp();
    const token = nextToken();
    const ticker = `TSTAPI${token}`;

    const user = await createUser({
      email: `test+auto-api-${token}@example.com`,
      name: `[TEST] API User ${token}`,
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: `[TEST] API Portfolio ${token}`,
        description: "API integration test portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);

    const portfolioBody = createPortfolioResponse.json();
    expect(portfolioBody.success).toBe(true);
    const portfolioId = portfolioBody.data.id as string;

    const addHoldingResponse = await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker,
        status: "OWNED",
        shares: 10,
        averageCost: 100,
        thesis: "[TEST] API holding thesis",
      },
    });

    expect(addHoldingResponse.statusCode).toBe(201);
    const holdingBody = addHoldingResponse.json();
    expect(holdingBody.success).toBe(true);
    const holdingId = holdingBody.data.id as string;

    const marketDataResponse = await app.inject({
      method: "POST",
      url: `/api/market-data/${ticker}/snapshots`,
      payload: {
        price: 108,
        previousClose: 100,
      },
    });

    expect(marketDataResponse.statusCode).toBe(201);

    const generateReportResponse = await app.inject({
      method: "POST",
      url: `/api/reports/${ticker}/generate`,
      payload: {
        holdingId,
      },
    });

    expect(generateReportResponse.statusCode).toBe(201);
    const reportBody = generateReportResponse.json();
    expect(reportBody.success).toBe(true);
    expect(reportBody.data.report.stockId).toBe(holdingBody.data.stockId);
    expect(reportBody.data.predictions).toHaveLength(3);

    await app.close();
  });

  it("returns 400 for invalid request body", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        name: "Missing user id",
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");

    await app.close();
  });
});
