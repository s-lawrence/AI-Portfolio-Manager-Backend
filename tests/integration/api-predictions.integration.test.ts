import {
  PredictionDirection,
  PredictionHorizon,
  Recommendation,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import {
  createTestPrediction,
  createTestStock,
} from "../../src/test/factories";

describe("API predictions routes", () => {
  it("returns ticker/company metadata and dueDate for GET /api/predictions/open", async () => {
    const app = buildApp();

    const stock = await createTestStock("TSTOPN1");
    await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      recommendation: Recommendation.BUY,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/predictions/open",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);

    const item = body.data.items.find((value: { stockId: string }) => value.stockId === stock.id);
    expect(item).toBeTruthy();
    expect(item.ticker).toBe("TSTOPN1");
    expect(typeof item.companyName).toBe("string");
    expect(item.dueDate).toBeTruthy();

    await app.close();
  });

  it("returns ticker/company metadata and dueDate for GET /api/predictions/due", async () => {
    const app = buildApp();

    const stock = await createTestStock("TSTDUE1");
    await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      recommendation: Recommendation.BUY,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/predictions/due?asOfDate=2026-06-03T00:00:00.000Z",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);

    const item = body.data.items.find((value: { stockId: string }) => value.stockId === stock.id);
    expect(item).toBeTruthy();
    expect(item.ticker).toBe("TSTDUE1");
    expect(typeof item.companyName).toBe("string");
    expect(item.dueDate).toBeTruthy();

    await app.close();
  });

  it("returns ticker/company metadata and dueDate for GET /api/predictions/stock/:ticker", async () => {
    const app = buildApp();

    const stock = await createTestStock("TSTSTK1");
    await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_MONTH,
      recommendation: Recommendation.HOLD,
      direction: PredictionDirection.FLAT,
      startingPrice: 100,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/predictions/stock/TSTSTK1?limit=10",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);

    const item = body.data.items.find((value: { stockId: string }) => value.stockId === stock.id);
    expect(item).toBeTruthy();
    expect(item.ticker).toBe("TSTSTK1");
    expect(typeof item.companyName).toBe("string");
    expect(item.dueDate).toBeTruthy();

    await app.close();
  });
});
