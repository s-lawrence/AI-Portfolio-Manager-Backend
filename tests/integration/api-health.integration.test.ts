import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app";

describe("API health routes", () => {
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
});
