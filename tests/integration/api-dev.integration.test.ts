import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { recordPriceSnapshot } from "../../src/services/market-data.service";
import { getUserByEmail, updateUser } from "../../src/repositories/users.repository";
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
});
