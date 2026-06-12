import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { env } from "../../src/config/env";
import {
  createTestHolding,
  createTestPortfolio,
  createTestStock,
  createTestUser,
} from "../../src/test/factories";
import { testPrisma } from "../../src/test/test-db";

function toCookieHeader(setCookieHeader: string | string[] | undefined): string {
  if (Array.isArray(setCookieHeader)) {
    const cookie = setCookieHeader[0];
    if (!cookie) {
      throw new Error("Expected Set-Cookie header.");
    }

    return cookie.split(";")[0] ?? "";
  }

  if (!setCookieHeader) {
    throw new Error("Expected Set-Cookie header.");
  }

  return setCookieHeader.split(";")[0] ?? "";
}

async function loginViaDevRoute(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/dev-login",
    payload: {
      email,
      displayName: "[TEST] Holdings Correction User",
    },
  });

  expect(response.statusCode).toBe(200);
  return toCookieHeader(response.headers["set-cookie"]);
}

describe("API holdings correction route", () => {
  const originalAuthEnabled = env.AUTH_ENABLED;
  const originalFrontendOrigin = env.FRONTEND_ORIGIN;
  const originalFrontendBaseUrl = env.FRONTEND_BASE_URL;
  const originalCorsAllowedOrigins = env.CORS_ALLOWED_ORIGINS;

  afterEach(() => {
    env.AUTH_ENABLED = originalAuthEnabled;
    env.FRONTEND_ORIGIN = originalFrontendOrigin;
    env.FRONTEND_BASE_URL = originalFrontendBaseUrl;
    env.CORS_ALLOWED_ORIGINS = originalCorsAllowedOrigins;
  });

  it("PATCH /api/holdings/:holdingId/stock route exists", async () => {
    env.AUTH_ENABLED = false;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const originalStock = await createTestStock("E");
    const holding = await createTestHolding(portfolio.id, originalStock.id);

    const app = buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/holdings/${holding.id}/stock`,
      payload: {
        ticker: "E.TO",
        companyName: "Enterprise Group, Inc.",
        exchange: "TSX",
        currency: "CAD",
        country: "CA",
        provider: "FMP",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);

    await app.close();
  });

  it("authenticated user can correct own holding from E to E.TO and preserves quantity/cost", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const originalStock = await createTestStock("E");
    const holding = await createTestHolding(portfolio.id, originalStock.id);

    await testPrisma.holding.update({
      where: { id: holding.id },
      data: {
        shares: 19,
        averageCost: 12.5,
        status: "OWNED",
      },
    });

    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, user.email);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/holdings/${holding.id}/stock`,
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        ticker: "E.TO",
        companyName: "Enterprise Group, Inc.",
        exchange: "TSX",
        currency: "CAD",
        country: "CA",
        provider: "FMP",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.holdingOverview.holding.id).toBe(holding.id);
    expect(body.data.holdingOverview.holding.shares).toBe(19);
    expect(body.data.holdingOverview.holding.averageCost).toBe(12.5);
    expect(body.data.holdingOverview.holding.stock.ticker).toBe("E.TO");
    expect(body.data.holdingOverview.holding.stock.companyName).toBe("Enterprise Group, Inc.");
    expect(body.data.holdingOverview.holding.stock.exchange).toBe("TSX");
    expect(body.data.holdingOverview.holding.stock.currency).toBe("CAD");
    expect(
      body.data.warnings.some((warning: string) =>
        warning.includes("Market data should be refreshed for corrected ticker."),
      ),
    ).toBe(true);

    await app.close();
  });

  it("unauthenticated request returns 401 when AUTH_ENABLED=true", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const stock = await createTestStock("E");
    const holding = await createTestHolding(portfolio.id, stock.id);

    const app = buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/holdings/${holding.id}/stock`,
      payload: {
        ticker: "E.TO",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().success).toBe(false);
    expect(response.json().error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("authenticated user cannot correct another user's holding", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();
    const portfolioB = await createTestPortfolio(userB.id);
    const stockB = await createTestStock("E");
    const holdingB = await createTestHolding(portfolioB.id, stockB.id);

    const app = buildApp();
    const userACookie = await loginViaDevRoute(app, userA.email);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/holdings/${holdingB.id}/stock`,
      headers: {
        cookie: userACookie,
      },
      payload: {
        ticker: "E.TO",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().success).toBe(false);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("invalid payload returns validation error", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const stock = await createTestStock("E");
    const holding = await createTestHolding(portfolio.id, stock.id);

    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, user.email);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/holdings/${holding.id}/stock`,
      headers: {
        cookie: sessionCookie,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().success).toBe(false);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    await app.close();
  });

  it("route supports provider candidate payload from stock search", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const stock = await createTestStock("E");
    const holding = await createTestHolding(portfolio.id, stock.id);

    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, user.email);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/holdings/${holding.id}/stock`,
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        ticker: "E.TO",
        companyName: "Enterprise Group, Inc.",
        exchange: "TSX",
        currency: "CAD",
        country: "CA",
        provider: "FMP",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(response.json().data.holdingOverview.holding.stock.ticker).toBe("E.TO");

    await app.close();
  });

  it("OPTIONS preflight allows PATCH for holding correction route", async () => {
    env.AUTH_ENABLED = true;
    env.FRONTEND_ORIGIN = "http://localhost:3001";
    env.FRONTEND_BASE_URL = "http://localhost:3001";
    env.CORS_ALLOWED_ORIGINS = "http://localhost:3001";

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const stock = await createTestStock("E");
    const holding = await createTestHolding(portfolio.id, stock.id);

    const app = buildApp();
    const response = await app.inject({
      method: "OPTIONS",
      url: `/api/holdings/${holding.id}/stock`,
      headers: {
        origin: "http://localhost:3001",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type",
      },
    });

    expect([200, 204]).toContain(response.statusCode);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect((response.headers["access-control-allow-methods"] ?? "").toUpperCase()).toContain("PATCH");

    await app.close();
  });

  it("unknown holdings correction route returns standard 404 envelope", async () => {
    env.AUTH_ENABLED = false;

    const app = buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/holdings/c123/stok",
      payload: {
        ticker: "E.TO",
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");

    await app.close();
  });
});