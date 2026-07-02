import { afterEach, describe, expect, it, vi } from "vitest";

import * as agentChatService from "../../src/agent/agent-chat.service";
import { agentToolExecutor } from "../../src/agent";
import { buildApp } from "../../src/app";
import * as authService from "../../src/auth/auth.service";
import { env } from "../../src/config/env";
import {
  createTestHolding,
  createTestPortfolio,
  createTestPriceSnapshot,
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

function callbackPathFromGoogleRedirect(locationHeader: string): string {
  const redirect = new URL(locationHeader);
  const state = redirect.searchParams.get("state");

  if (!state) {
    throw new Error("Expected OAuth state parameter in redirect URL.");
  }

  return `/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`;
}

describe("API auth routes and user scoping", () => {
  const originalAuthEnabled = env.AUTH_ENABLED;
  const originalGoogleClientId = env.GOOGLE_CLIENT_ID;
  const originalGoogleClientSecret = env.GOOGLE_CLIENT_SECRET;
  const originalGoogleRedirectUri = env.GOOGLE_REDIRECT_URI;
  const originalFrontendBaseUrl = env.FRONTEND_BASE_URL;
  const originalAuthCookieSecure = env.AUTH_COOKIE_SECURE;
  const originalAuthCookieSameSite = env.AUTH_COOKIE_SAME_SITE;
  const originalOpenAiProviderEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const originalOpenAiApiKey = env.OPENAI_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    env.AUTH_ENABLED = originalAuthEnabled;
    env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
    env.GOOGLE_REDIRECT_URI = originalGoogleRedirectUri;
    env.FRONTEND_BASE_URL = originalFrontendBaseUrl;
    env.AUTH_COOKIE_SECURE = originalAuthCookieSecure;
    env.AUTH_COOKIE_SAME_SITE = originalAuthCookieSameSite;
    env.OPENAI_AGENT_PROVIDER_ENABLED = originalOpenAiProviderEnabled;
    env.OPENAI_API_KEY = originalOpenAiApiKey;
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  async function loginViaDevRoute(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      payload: {
        email,
        displayName: "[TEST] Auth Session User",
      },
    });

    expect(response.statusCode).toBe(200);
    return toCookieHeader(response.headers["set-cookie"]);
  }

  it("/api/auth/me returns unauthenticated state when no session exists", async () => {
    env.AUTH_ENABLED = true;

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.authenticated).toBe(false);
    expect(body.data.user).toBeNull();

    await app.close();
  });

  it("Google callback creates a new user when login is first-time", async () => {
    env.AUTH_ENABLED = true;
    env.GOOGLE_CLIENT_ID = "test-google-client-id";
    env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
    env.GOOGLE_REDIRECT_URI = "http://localhost:4000/api/auth/google/callback";
    env.FRONTEND_BASE_URL = "http://localhost:3000";

    const identity = {
      googleSub: `sub-${Date.now()}`,
      email: `test+auto-auth-google-${Date.now()}@example.com`,
      displayName: "[TEST] OAuth User",
      avatarUrl: "https://example.com/avatar.png",
      emailVerified: true,
    };

    vi.spyOn(authService, "verifyGoogleOAuthCode").mockResolvedValue(identity);

    const app = buildApp();

    const startResponse = await app.inject({
      method: "GET",
      url: "/api/auth/google/start",
    });

    expect(startResponse.statusCode).toBe(302);
    const oauthStateCookie = toCookieHeader(startResponse.headers["set-cookie"]);
    const callbackUrl = callbackPathFromGoogleRedirect(startResponse.headers.location as string);

    const callbackResponse = await app.inject({
      method: "GET",
      url: callbackUrl,
      headers: {
        cookie: oauthStateCookie,
      },
    });

    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toContain("auth=success");

    const user = await testPrisma.user.findUnique({ where: { email: identity.email } });
    expect(user).not.toBeNull();
    expect(user?.googleSub).toBe(identity.googleSub);
    expect(user?.emailVerified).toBe(true);
    expect(user?.displayName).toBe(identity.displayName);

    const [portfolioCount, watchlistCount] = await Promise.all([
      testPrisma.portfolio.count({ where: { userId: user!.id } }),
      testPrisma.watchlist.count({ where: { userId: user!.id } }),
    ]);

    expect(portfolioCount).toBeGreaterThan(0);
    expect(watchlistCount).toBeGreaterThan(0);

    await app.close();
  });

  it("Google callback updates lastLoginAt for an existing user", async () => {
    env.AUTH_ENABLED = true;
    env.GOOGLE_CLIENT_ID = "test-google-client-id";
    env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
    env.GOOGLE_REDIRECT_URI = "http://localhost:4000/api/auth/google/callback";

    const token = Date.now();
    const existing = await testPrisma.user.create({
      data: {
        email: `test+auto-auth-existing-${token}@example.com`,
        name: "[TEST] Existing OAuth User",
        googleSub: `existing-sub-${token}`,
        displayName: "[TEST] Existing OAuth User",
        emailVerified: true,
        authProvider: "GOOGLE",
        lastLoginAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    vi.spyOn(authService, "verifyGoogleOAuthCode").mockResolvedValue({
      googleSub: existing.googleSub!,
      email: existing.email,
      displayName: "[TEST] Existing OAuth User",
      avatarUrl: null,
      emailVerified: true,
    });

    const app = buildApp();

    const startResponse = await app.inject({
      method: "GET",
      url: "/api/auth/google/start",
    });

    const oauthStateCookie = toCookieHeader(startResponse.headers["set-cookie"]);
    const callbackUrl = callbackPathFromGoogleRedirect(startResponse.headers.location as string);

    const callbackResponse = await app.inject({
      method: "GET",
      url: callbackUrl,
      headers: {
        cookie: oauthStateCookie,
      },
    });

    expect(callbackResponse.statusCode).toBe(302);

    const refreshed = await testPrisma.user.findUnique({ where: { id: existing.id } });
    expect(refreshed?.lastLoginAt).not.toBeNull();
    expect((refreshed?.lastLoginAt?.getTime() ?? 0)).toBeGreaterThan(
      existing.lastLoginAt?.getTime() ?? 0,
    );

    await app.close();
  });

  it("logout clears session and /api/auth/me becomes unauthenticated", async () => {
    env.AUTH_ENABLED = true;

    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(
      app,
      `test+auto-auth-logout-${Date.now()}@example.com`,
    );

    const meBeforeLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: sessionCookie,
      },
    });

    expect(meBeforeLogout.statusCode).toBe(200);
    expect(meBeforeLogout.json().data.authenticated).toBe(true);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: sessionCookie,
      },
    });

    expect(logoutResponse.statusCode).toBe(200);

    const meAfterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: sessionCookie,
      },
    });

    expect(meAfterLogout.statusCode).toBe(200);
    expect(meAfterLogout.json().data.authenticated).toBe(false);

    await app.close();
  });

  it("protected portfolio route rejects unauthenticated requests when auth is enabled", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/portfolios/user/${user.id}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("auth-enabled portfolio create without session returns 401 instead of userId validation error", async () => {
    env.AUTH_ENABLED = true;

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        name: "[TEST] Auth Required Portfolio",
        baseCurrency: "CAD",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("auth-enabled portfolio create derives userId from authenticated session", async () => {
    env.AUTH_ENABLED = true;

    const loginEmail = `test+auto-auth-create-${Date.now()}@example.com`;
    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, loginEmail);
    const sessionUser = await testPrisma.user.findUnique({
      where: { email: loginEmail },
      select: { id: true },
    });

    expect(sessionUser).not.toBeNull();

    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        name: "[TEST] Session Derived Portfolio",
        baseCurrency: "CAD",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);
    expect(response.json().data.userId).toBe(sessionUser?.id);

    await app.close();
  });

  it("auth-enabled portfolio create allows matching body.userId for authenticated user", async () => {
    env.AUTH_ENABLED = true;

    const loginEmail = `test+auto-auth-create-match-${Date.now()}@example.com`;
    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, loginEmail);
    const sessionUser = await testPrisma.user.findUnique({
      where: { email: loginEmail },
      select: { id: true },
    });

    expect(sessionUser).not.toBeNull();

    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        userId: sessionUser?.id,
        name: "[TEST] Session Matching userId Portfolio",
        baseCurrency: "CAD",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);
    expect(response.json().data.userId).toBe(sessionUser?.id);

    await app.close();
  });

  it("auth-enabled portfolio create rejects mismatched body.userId", async () => {
    env.AUTH_ENABLED = true;

    const sessionUser = await createTestUser();
    const otherUser = await createTestUser();

    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, sessionUser.email);

    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        userId: otherUser.id,
        name: "[TEST] Mismatched User Portfolio",
        baseCurrency: "CAD",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("authenticated user cannot access another user's portfolio", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();
    const portfolioB = await createTestPortfolio(userB.id);

    const app = buildApp();
    const userACookie = await loginViaDevRoute(app, userA.email);

    const response = await app.inject({
      method: "GET",
      url: `/api/portfolios/${portfolioB.id}`,
      headers: {
        cookie: userACookie,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("authenticated user cannot access another user's watchlist", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();

    const watchlistB = await testPrisma.watchlist.create({
      data: {
        userId: userB.id,
        name: `[TEST] Foreign Watchlist ${Date.now()}`,
        isDefault: false,
      },
    });

    const app = buildApp();
    const userACookie = await loginViaDevRoute(app, userA.email);

    const response = await app.inject({
      method: "GET",
      url: `/api/watchlists/${watchlistB.id}`,
      headers: {
        cookie: userACookie,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("authenticated user can generate report with own portfolio context", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const ticker = `AUTHS${Date.now().toString().slice(-6)}`;
    const stock = await createTestStock(ticker);
    await createTestHolding(portfolio.id, stock.id);
    await createTestPriceSnapshot(stock.id, {
      price: 190,
      previousClose: 188,
    });

    const app = buildApp();
    const sessionCookie = await loginViaDevRoute(app, user.email);

    const response = await app.inject({
      method: "POST",
      url: `/api/reports/${ticker}/generate`,
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        portfolioId: portfolio.id,
        useOpenAi: false,
        createPredictions: false,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);
    expect(response.json().data.report.id).toBeDefined();

    await app.close();
  });

  it("authenticated user cannot generate report with another user's portfolio context", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();

    const portfolioA = await createTestPortfolio(userA.id);
    const portfolioB = await createTestPortfolio(userB.id);

    const ticker = `AUTHF${Date.now().toString().slice(-6)}`;
    const stock = await createTestStock(ticker);
    await createTestHolding(portfolioA.id, stock.id);
    await createTestHolding(portfolioB.id, stock.id);
    await createTestPriceSnapshot(stock.id, {
      price: 420,
      previousClose: 415,
    });

    const app = buildApp();
    const userACookie = await loginViaDevRoute(app, userA.email);

    const response = await app.inject({
      method: "POST",
      url: `/api/reports/${ticker}/generate`,
      headers: {
        cookie: userACookie,
      },
      payload: {
        portfolioId: portfolioB.id,
        useOpenAi: false,
        createPredictions: false,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("agent chat derives userId from authenticated session when auth is enabled", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const runChatSpy = vi.spyOn(agentChatService, "runAgentChat").mockResolvedValue({
      answer: "ok",
      intent: "RESEARCH_TICKER",
      toolCalls: [],
      suggestedActions: [],
      warnings: [],
      missingContext: [],
      confidence: "MEDIUM",
      metadata: {
        mode: "DETERMINISTIC_ROUTER",
        fallbackUsed: false,
        plannerUsed: false,
        plannerFallbackUsed: false,
        plannedToolCount: 0,
        executedToolCount: 0,
        droppedToolCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    });

    const app = buildApp();
    const userCookie = await loginViaDevRoute(app, user.email);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: {
        cookie: userCookie,
      },
      payload: {
        message: "Research AAPL",
        context: {
          source: "USER",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(runChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          userId: user.id,
        }),
      }),
    );

    await app.close();
  });

  it("AUTH_ENABLED=true authenticated review with owned portfolio executes portfolio review tools", async () => {
    env.AUTH_ENABLED = true;
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    const user = await createTestUser();
    const ownedPortfolio = await createTestPortfolio(user.id);

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => ({
      toolName: request.toolName,
      success: true,
      data: { portfolioId: ownedPortfolio.id },
      warnings: [],
      errors: [],
      metadata: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 2,
        riskLevel: "READ_ONLY",
        executionMode: "AUTO_ALLOWED",
        dryRun: false,
      },
    }) as never);

    const app = buildApp();
    const userCookie = await loginViaDevRoute(app, user.email);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: {
        cookie: userCookie,
      },
      payload: {
        message: "Review my portfolio",
        context: {
          source: "USER",
          portfolioId: ownedPortfolio.id,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(executeSpy).toHaveBeenCalled();

    const executedToolNames = executeSpy.mock.calls.map((call) => call[0]?.toolName);
    expect(executedToolNames).toEqual(expect.arrayContaining([
      "getPortfolioOverview",
      "getPortfolioRiskSnapshot",
      "getPortfolioDataQuality",
    ]));

    await app.close();
  });

  it("AUTH_ENABLED=true authenticated review rejects another user's portfolio", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();
    const portfolioB = await createTestPortfolio(userB.id);

    const app = buildApp();
    const userACookie = await loginViaDevRoute(app, userA.email);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      headers: {
        cookie: userACookie,
      },
      payload: {
        message: "Review my portfolio",
        context: {
          source: "USER",
          portfolioId: portfolioB.id,
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("AUTH_ENABLED=true unauthenticated /api/agent/chat returns 401", async () => {
    env.AUTH_ENABLED = true;

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Review my portfolio",
        context: {
          source: "USER",
          portfolioId: "portfolio-unauth",
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("authenticated user can reassign own holding stock and preserve quantity/cost", async () => {
    env.AUTH_ENABLED = true;

    const user = await createTestUser();
    const portfolio = await createTestPortfolio(user.id);
    const originalStock = await createTestStock("ENB");
    const replacementStock = await createTestStock("ENB.TO");

    const holding = await createTestHolding(portfolio.id, originalStock.id);
    await testPrisma.holding.update({
      where: { id: holding.id },
      data: {
        status: "OWNED",
        shares: 42,
        averageCost: 17.25,
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
        stockId: replacementStock.id,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.holdingOverview.holding.id).toBe(holding.id);
    expect(body.data.holdingOverview.holding.stockId).toBe(replacementStock.id);
    expect(body.data.holdingOverview.holding.shares).toBe(42);
    expect(body.data.holdingOverview.holding.averageCost).toBe(17.25);
    expect(body.data.holdingOverview.holding.stock.ticker).toBe("ENB.TO");
    expect(body.data.warnings.some((warning: string) =>
      warning.includes("Market data should be refreshed for corrected ticker."))).toBe(true);

    await app.close();
  });

  it("authenticated user cannot reassign another user's holding stock", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();
    const portfolioB = await createTestPortfolio(userB.id);
    const stockB = await createTestStock("SU.TO");
    const replacementStock = await createTestStock("SU");
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
        stockId: replacementStock.id,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("authenticated user cannot rank another user's portfolio holdings", async () => {
    env.AUTH_ENABLED = true;

    const userA = await createTestUser();
    const userB = await createTestUser();
    const portfolioB = await createTestPortfolio(userB.id);

    const app = buildApp();
    const userACookie = await loginViaDevRoute(app, userA.email);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/tools/rankPortfolioHoldings/execute",
      headers: {
        cookie: userACookie,
      },
      payload: {
        context: {
          source: "AGENT",
        },
        input: {
          portfolioId: portfolioB.id,
          limit: 3,
          includeWatchlist: false,
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");

    await app.close();
  });

  it("AUTH_ENABLED=false preserves existing local userId request behavior", async () => {
    env.AUTH_ENABLED = false;

    const user = await createTestUser();

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/portfolios",
      payload: {
        userId: user.id,
        name: "Auth Disabled Portfolio",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);

    await app.close();
  });

  it("dev-login route is unavailable in production", async () => {
    env.AUTH_ENABLED = true;
    process.env.NODE_ENV = "production";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      payload: {
        email: `test+auto-auth-prod-${Date.now()}@example.com`,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");

    await app.close();
  });

  it("auth session cookie respects secure and sameSite env configuration", async () => {
    env.AUTH_ENABLED = true;
    env.AUTH_COOKIE_SECURE = true;
    env.AUTH_COOKIE_SAME_SITE = "none";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      payload: {
        email: `test+auto-auth-cookie-${Date.now()}@example.com`,
      },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const firstCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(firstCookie).toBeDefined();
    expect(firstCookie).toContain("Secure");
    expect(firstCookie).toContain("SameSite=None");

    await app.close();
  });

  it("rejects insecure cookie configuration when sameSite is none", () => {
    env.AUTH_ENABLED = true;
    env.AUTH_COOKIE_SECURE = false;
    env.AUTH_COOKIE_SAME_SITE = "none";

    expect(() => buildApp()).toThrow(/AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true/i);
  });
});
