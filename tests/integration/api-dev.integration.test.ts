import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { fmpAnalystProvider } from "../../src/providers/fmp";
import { gdeltProvider } from "../../src/providers/gdelt";
import { recordPriceSnapshot } from "../../src/services/market-data.service";
import { createUser, getUserByEmail, updateUser } from "../../src/repositories/users.repository";
import { createTestStock } from "../../src/test/factories";
import { testPrisma } from "../../src/test/test-db";

const DEMO_EMAIL = "demo@example.com";

describe("API dev demo-context route", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("returns demo context in non-production when seed data exists", async () => {
    process.env.NODE_ENV = "test";

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/dev/demo-context",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(DEMO_EMAIL);
    expect(body.data.portfolio.name).toBe("Demo Portfolio");
    expect(Array.isArray(body.data.holdings)).toBe(true);

    await app.close();
  });

  it("returns 404 with useful message when demo data is missing", async () => {
    process.env.NODE_ENV = "test";

    const existingDemoUser = await getUserByEmail(DEMO_EMAIL);

    if (!existingDemoUser) {
      const app = buildApp();
      const response = await app.inject({
        method: "GET",
        url: "/api/dev/demo-context",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toMatch(/Demo user not found/i);
      await app.close();
      return;
    }

    const temporaryEmail = `test+auto-missing-${Date.now()}@example.com`;
    await updateUser(existingDemoUser.id, {
      email: temporaryEmail,
    });

    try {
      const app = buildApp();
      const response = await app.inject({
        method: "GET",
        url: "/api/dev/demo-context",
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toMatch(/Demo user not found/i);
      await app.close();
    } finally {
      await updateUser(existingDemoUser.id, {
        email: DEMO_EMAIL,
      });
    }
  });

  it("is unavailable in production", async () => {
    process.env.NODE_ENV = "production";

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/dev/demo-context",
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("route-map debug endpoint is unavailable in production", async () => {
    process.env.NODE_ENV = "production";

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/dev/routes",
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it("returns market-data audit payload for an existing ticker", async () => {
    process.env.NODE_ENV = "test";

    const ticker = `TSTAUD${Date.now().toString().slice(-4)}`;

    await recordPriceSnapshot(ticker, {
      price: 217,
      previousClose: 214,
      close: 217,
      capturedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    await recordPriceSnapshot(ticker, {
      price: 310,
      previousClose: 305,
      close: 310,
      capturedAt: new Date("2026-05-01T14:30:00.000Z"),
    });

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/dev/market-data-audit/${ticker}`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.ticker).toBe(ticker);
    expect(body.data.selectedLatestSnapshot.price).toBe(310);
    expect(Array.isArray(body.data.latestByCapturedAt)).toBe(true);
    expect(Array.isArray(body.data.latestByCreatedAt)).toBe(true);
    expect(body.data.latestByCapturedAt.length).toBeGreaterThan(0);
    expect(body.data.latestByCreatedAt.length).toBeGreaterThan(0);

    await app.close();
  });

  it("purges demo analytical data via dev route", async () => {
    process.env.NODE_ENV = "test";

    const ticker = `TSTPDV${Date.now().toString().slice(-4)}`;
    const stock = await createTestStock(ticker);

    await testPrisma.priceSnapshot.create({
      data: {
        stockId: stock.id,
        source: "DEMO",
        price: 123,
        capturedAt: new Date("2026-06-04T20:00:00.000Z"),
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/purge-demo-analytical-data",
      payload: {
        ticker,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.priceSnapshotsDeleted).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it("purge endpoint is unavailable in production", async () => {
    process.env.NODE_ENV = "production";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/purge-demo-analytical-data",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("cleanup-watchlist-artifacts removes smoke/demo artifacts and keeps legitimate items", async () => {
    process.env.NODE_ENV = "test";

    const token = Date.now().toString().slice(-6);
    const app = buildApp();
    const user = await createUser({
      email: `test+auto-dev-cleanup-${token}@example.com`,
      name: `[TEST] Dev Cleanup ${token}`,
    });

    const createWatchlistResponse = await app.inject({
      method: "POST",
      url: "/api/watchlists",
      payload: {
        userId: user.id,
        name: `[TEST] Cleanup Watchlist ${token}`,
      },
    });

    expect(createWatchlistResponse.statusCode).toBe(201);
    const watchlistId = createWatchlistResponse.json().data.id as string;

    const addItem = async (payload: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/watchlists/${watchlistId}/items`,
        payload,
      });
      expect(response.statusCode).toBe(201);
    };

    await addItem({ ticker: "ADD" });
    await addItem({ ticker: "INTC", tags: ["smoke-test"] });
    await addItem({
      ticker: "WLTH",
      source: "AGENT",
      thesis: "Smoke write verification artifact",
    });
    await addItem({ ticker: "NVDA" });
    await addItem({ ticker: "AAPL" });
    await addItem({ ticker: "MSFT" });

    const cleanupResponse = await app.inject({
      method: "POST",
      url: `/api/dev/cleanup-watchlist-artifacts/${watchlistId}`,
    });

    expect(cleanupResponse.statusCode).toBe(200);
    const cleanupBody = cleanupResponse.json();
    expect(cleanupBody.success).toBe(true);
    expect(cleanupBody.data.removedCount).toBe(3);
    expect(cleanupBody.data.removedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: "ADD", reason: "COMMAND_WORD_TICKER_ADD" }),
        expect.objectContaining({ ticker: "INTC", reason: "SMOKE_TEST_TAG" }),
        expect.objectContaining({ ticker: "WLTH", reason: "SMOKE_WRITE_VERIFICATION_THESIS" }),
      ]),
    );

    const watchlistResponse = await app.inject({
      method: "GET",
      url: `/api/watchlists/${watchlistId}`,
    });

    expect(watchlistResponse.statusCode).toBe(200);
    const watchlistBody = watchlistResponse.json();
    const remainingTickers = (watchlistBody.data.items as Array<{ stock: { ticker: string } }>)
      .map((item) => item.stock.ticker)
      .sort();

    expect(remainingTickers).toEqual(["AAPL", "MSFT", "NVDA"]);

    await app.close();
  });

  it("cleanup-watchlist-artifacts endpoint is unavailable in production", async () => {
    process.env.NODE_ENV = "production";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/cleanup-watchlist-artifacts/cmaaaaaaa0000000000000000",
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns FMP analyst audit payload in non-production", async () => {
    process.env.NODE_ENV = "test";

    vi.spyOn(fmpAnalystProvider, "auditTicker").mockResolvedValue({
      ticker: "AAPL",
      priceTargetSummary: {
        endpointAttempted: ["/stable/price-target-summary"],
        selectedEndpoint: "/stable/price-target-summary",
        status: "SUCCESS",
        itemCount: 1,
        firstItemKeys: ["symbol", "targetConsensus"],
        mappedFieldSummary: { hasTargetConsensus: true },
      },
      priceTargetConsensus: {
        endpointAttempted: ["/stable/price-target-consensus"],
        selectedEndpoint: "/stable/price-target-consensus",
        status: "SUCCESS",
        itemCount: 1,
        firstItemKeys: ["symbol", "targetConsensus"],
        mappedFieldSummary: { hasTargetConsensus: true },
      },
      gradesConsensus: {
        endpointAttempted: ["/stable/grades-consensus"],
        selectedEndpoint: "/stable/grades-consensus",
        status: "SUCCESS",
        itemCount: 1,
        firstItemKeys: ["buy", "consensus", "hold", "sell", "strongBuy", "strongSell"],
        mappedFieldSummary: { hasRatingConsensus: true },
      },
      grades: {
        endpointAttempted: ["/stable/grades"],
        selectedEndpoint: "/stable/grades",
        status: "SUCCESS",
        itemCount: 1,
        firstItemKeys: ["action", "date", "gradingCompany", "newGrade", "previousGrade", "symbol"],
        mappedFieldSummary: { mappedActionCount: 1 },
      },
      gradesHistorical: {
        endpointAttempted: ["/stable/grades-historical"],
        selectedEndpoint: "/stable/grades-historical",
        status: "EMPTY",
        itemCount: 0,
        firstItemKeys: [],
        mappedFieldSummary: { mapped: false },
      },
      analystEstimates: {
        endpointAttempted: ["/stable/analyst-estimates"],
        selectedEndpoint: "/stable/analyst-estimates",
        status: "EMPTY",
        itemCount: 0,
        firstItemKeys: [],
        mappedFieldSummary: { mappedEstimateCount: 0 },
      },
      ratingsSnapshot: {
        endpointAttempted: ["/stable/ratings-snapshot"],
        selectedEndpoint: "/stable/ratings-snapshot",
        status: "EMPTY",
        itemCount: 0,
        firstItemKeys: [],
        mappedFieldSummary: { mapped: false },
      },
      ratingsHistorical: {
        endpointAttempted: ["/stable/ratings-historical"],
        selectedEndpoint: "/stable/ratings-historical",
        status: "EMPTY",
        itemCount: 0,
        firstItemKeys: [],
        mappedFieldSummary: { mappedCount: 0 },
      },
      analystRatings: {
        endpointAttempted: ["/stable/grades-consensus"],
        selectedEndpoint: "/stable/grades-consensus",
        status: "SUCCESS",
        itemCount: 1,
        firstItemKeys: ["buy", "consensus", "hold", "sell", "strongBuy", "strongSell"],
        mappedFieldSummary: { mapped: true },
      },
      analystActions: {
        endpointAttempted: ["/stable/grades"],
        selectedEndpoint: "/stable/grades",
        status: "SUCCESS",
        itemCount: 1,
        firstItemKeys: ["action", "date", "gradingCompany", "newGrade", "previousGrade", "symbol"],
        mappedFieldSummary: { mappedActionCount: 1 },
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/dev/fmp/analyst-audit/AAPL",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.ticker).toBe("AAPL");
    expect(body.data.priceTargetSummary.status).toBe("SUCCESS");

    await app.close();
  });

  it("returns GDELT query audit payload in non-production", async () => {
    process.env.NODE_ENV = "test";

    vi.spyOn(gdeltProvider, "auditDocQuery").mockResolvedValue({
      query: "geopolitical risk",
      url: "https://api.gdeltproject.org/api/v2/doc/doc?query=geopolitical%20risk",
      statusCode: 200,
      elapsedMs: 75,
      rawTopLevelKeys: ["articles", "status"],
      articleCount: 4,
      firstArticleKeys: ["domain", "seendate", "title", "url"],
      mappedEventCount: 3,
      retryAttempted: false,
      warnings: [],
    });

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/dev/gdelt/query-audit?query=geopolitical%20risk&maxRecords=5",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.query).toBe("geopolitical risk");
    expect(body.data.articleCount).toBe(4);

    await app.close();
  });
});
