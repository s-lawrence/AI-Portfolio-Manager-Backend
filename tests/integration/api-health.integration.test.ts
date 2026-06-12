import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { env } from "../../src/config/env";

describe("API health routes", () => {
  const originalFmpApiKey = env.FMP_API_KEY;
  const originalFredApiKey = env.FRED_API_KEY;
  const originalOpenAiApiKey = env.OPENAI_API_KEY;
  const originalAuthEnabled = env.AUTH_ENABLED;
  const originalOpenAiEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const originalFrontendOrigin = env.FRONTEND_ORIGIN;
  const originalFrontendBaseUrl = env.FRONTEND_BASE_URL;
  const originalCorsAllowedOrigins = env.CORS_ALLOWED_ORIGINS;

  afterEach(() => {
    env.FMP_API_KEY = originalFmpApiKey;
    env.FRED_API_KEY = originalFredApiKey;
    env.OPENAI_API_KEY = originalOpenAiApiKey;
    env.AUTH_ENABLED = originalAuthEnabled;
    env.OPENAI_AGENT_PROVIDER_ENABLED = originalOpenAiEnabled;
    env.FRONTEND_ORIGIN = originalFrontendOrigin;
    env.FRONTEND_BASE_URL = originalFrontendBaseUrl;
    env.CORS_ALLOWED_ORIGINS = originalCorsAllowedOrigins;
  });

  it("GET /health returns ok payload", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.service).toBe("portfolio-ai-backend");
    expect(typeof body.data.timestamp).toBe("string");

    await app.close();
  });

  it("GET /api/health returns ok payload", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.service).toBe("portfolio-ai-backend");

    await app.close();
  });

  it("GET /health/db returns ok when database is reachable", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health/db",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.database).toBe("reachable");

    await app.close();
  });

  it("GET /api/health/dependencies returns non-secret readiness booleans", async () => {
    env.FMP_API_KEY = "fmp-secret-value";
    env.FRED_API_KEY = "fred-secret-value";
    env.OPENAI_API_KEY = "sk-test-secret-value";
    env.AUTH_ENABLED = true;
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/health/dependencies",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.dependencies.database.ok).toBeTypeOf("boolean");
    expect(body.data.dependencies.providerConfig.fmpApiKeyConfigured).toBe(true);
    expect(body.data.dependencies.providerConfig.fredApiKeyConfigured).toBe(true);
    expect(body.data.dependencies.openAi.enabled).toBe(true);
    expect(body.data.dependencies.openAi.apiKeyConfigured).toBe(true);
    expect(body.data.dependencies.auth.enabled).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("fmp-secret-value");
    expect(serialized).not.toContain("fred-secret-value");
    expect(serialized).not.toContain("sk-test-secret-value");

    await app.close();
  });

  it("CORS allows credentials for trusted origin and omits allow-origin for untrusted origin", async () => {
    env.FRONTEND_ORIGIN = "https://beta.example.com";
    env.FRONTEND_BASE_URL = "https://beta.example.com";
    env.CORS_ALLOWED_ORIGINS = "https://friend.example.com";

    const app = buildApp();

    const trustedResponse = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: "https://friend.example.com",
      },
    });

    expect(trustedResponse.statusCode).toBe(200);
    expect(trustedResponse.headers["access-control-allow-origin"]).toBe(
      "https://friend.example.com",
    );
    expect(trustedResponse.headers["access-control-allow-credentials"]).toBe("true");

    const untrustedResponse = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        origin: "https://untrusted.example.com",
      },
    });

    expect(untrustedResponse.statusCode).toBe(200);
    expect(untrustedResponse.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });
});
