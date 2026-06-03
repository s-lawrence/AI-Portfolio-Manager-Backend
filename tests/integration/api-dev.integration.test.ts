import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";
import { getUserByEmail, updateUser } from "../../src/repositories/users.repository";

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
});
