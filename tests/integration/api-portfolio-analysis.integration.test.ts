import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { createUser } from "../../src/repositories/users.repository";

describe("API portfolio run-analysis route", () => {
  it("returns success envelope for POST /api/portfolios/:portfolioId/run-analysis", async () => {
    const app = buildApp();

    const user = await createUser({
      email: `test+auto-api-analysis-${Date.now()}@example.com`,
      name: "[TEST] API Analysis User",
    });

    const createPortfolioResponse = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "[TEST] API Analysis Portfolio",
        baseCurrency: "USD",
      },
    });

    expect(createPortfolioResponse.statusCode).toBe(201);
    const portfolioId = createPortfolioResponse.json().data.id as string;

    const ticker = "TSTANL1";

    const addHoldingResponse = await app.inject({
      method: "POST",
      url: "/api/holdings",
      payload: {
        portfolioId,
        ticker,
        status: "OWNED",
        shares: 8,
      },
    });

    expect(addHoldingResponse.statusCode).toBe(201);

    const snapshotResponse = await app.inject({
      method: "POST",
      url: `/api/market-data/${ticker}/snapshots`,
      payload: {
        price: 110,
        previousClose: 108,
      },
    });

    expect(snapshotResponse.statusCode).toBe(201);

    const analysisResponse = await app.inject({
      method: "POST",
      url: `/api/portfolios/${portfolioId}/run-analysis`,
    });

    expect(analysisResponse.statusCode).toBe(200);

    const body = analysisResponse.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.reports)).toBe(true);
    expect(body.data.reports.length).toBeGreaterThanOrEqual(1);
    expect(body.data.portfolioSummary).toBeTruthy();

    await app.close();
  });

  it("returns 400 with standard envelope for invalid portfolioId", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios/not-a-cuid/run-analysis",
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");

    await app.close();
  });

  it("returns 404 with standard envelope for missing portfolio", async () => {
    const app = buildApp();

    const user = await createUser({
      email: `test+auto-api-analysis-missing-${Date.now()}@example.com`,
      name: "[TEST] Missing Portfolio User",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/portfolios/${user.id}/run-analysis`,
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");

    await app.close();
  });
});
