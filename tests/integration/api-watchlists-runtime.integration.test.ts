import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { fmpAnalystProvider } from "../../src/providers/fmp";
import { createUser } from "../../src/repositories/users.repository";

let sequence = 0;

function nextToken(): string {
  sequence += 1;
  return String(sequence).padStart(4, "0");
}

function expectStandardEnvelope(body: unknown): asserts body is { success: boolean } {
  expect(typeof body).toBe("object");
  expect(body).not.toBeNull();

  const payload = body as Record<string, unknown>;
  expect(typeof payload.success).toBe("boolean");

  // Guard against Fastify default route-not-found payload shape.
  expect(payload).not.toMatchObject({
    message: expect.stringMatching(/^Route\s.+\snot found$/),
    error: "Not Found",
    statusCode: 404,
  });
}

describe("API watchlist route registration runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/watchlists/user/:userId returns app envelope (not Fastify default 404)", async () => {
    const app = buildApp();
    const token = nextToken();
    const user = await createUser({
      email: `test+auto-watchlist-user-${token}@example.com`,
      name: `[TEST] Watchlist User ${token}`,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/watchlists/user/${user.id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expectStandardEnvelope(body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.items)).toBe(true);

    await app.close();
  });

  it("POST /api/watchlists returns app envelope", async () => {
    const app = buildApp();
    const token = nextToken();
    const user = await createUser({
      email: `test+auto-watchlist-create-${token}@example.com`,
      name: `[TEST] Watchlist Create ${token}`,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/watchlists",
      payload: {
        userId: user.id,
        name: `[TEST] Runtime Watchlist ${token}`,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expectStandardEnvelope(body);
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe(user.id);

    await app.close();
  });

  it("GET /api/watchlists/:watchlistId/research-bundle returns app envelope", async () => {
    const app = buildApp();
    const token = nextToken();
    const ticker = `TSTWLB${token}`;

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockResolvedValue({
      ticker,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 110,
      priceTargetHigh: 125,
      priceTargetLow: 95,
      priceTargetConsensus: 112,
      analystCount: 10,
      ratingConsensus: "BUY",
      raw: { ticker },
    });

    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 112,
      analystCount: 10,
      ratingConsensus: "BUY",
      raw: { source: "consensus" },
    });

    vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockResolvedValue({
      source: "FMP",
      analystCount: 10,
      ratingConsensus: "BUY",
      strongBuyCount: 4,
      buyCount: 4,
      holdCount: 2,
      sellCount: 0,
      strongSellCount: 0,
      raw: { source: "ratings" },
    });

    vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockResolvedValue([]);
    vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockResolvedValue([]);

    vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockResolvedValue([
      {
        ticker,
        source: "FMP",
        actionType: "UPGRADE",
        firm: "Firm Watchlist",
        eventDate: new Date("2026-06-11T00:00:00.000Z"),
        newPriceTarget: 118,
        raw: { ticker },
      },
    ]);

    const user = await createUser({
      email: `test+auto-watchlist-bundle-${token}@example.com`,
      name: `[TEST] Watchlist Bundle ${token}`,
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/watchlists",
      payload: {
        userId: user.id,
        name: `[TEST] Bundle Watchlist ${token}`,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const watchlistId = (createResponse.json().data.id ?? "") as string;

    const addItemResponse = await app.inject({
      method: "POST",
      url: `/api/watchlists/${watchlistId}/items`,
      payload: {
        ticker,
      },
    });

    expect(addItemResponse.statusCode).toBe(201);

    const analystIngestionResponse = await app.inject({
      method: "POST",
      url: `/api/ingestion/fmp/ticker/${ticker}/analyst`,
      payload: {},
    });

    expect(analystIngestionResponse.statusCode).toBe(200);

    const bundleResponse = await app.inject({
      method: "GET",
      url: `/api/watchlists/${watchlistId}/research-bundle`,
    });

    expect(bundleResponse.statusCode).toBe(200);
    const body = bundleResponse.json();
    expectStandardEnvelope(body);
    expect(body.success).toBe(true);
    expect(body.data.watchlist.id).toBe(watchlistId);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.items[0].ticker).toBe(ticker);
    expect(body.data.items[0].latestAnalystSnapshot).toBeDefined();
    expect(typeof body.data.items[0].latestAnalystSnapshot.buyCount).toBe("number");
    expect(Array.isArray(body.data.items[0].recentAnalystActions)).toBe(true);
    expect(body.data.items[0].latestAnnualAnalystEstimate).toBeDefined();
    expect(body.data.items[0].fmpFinancialRating).toBeDefined();

    await app.close();
  });
});
