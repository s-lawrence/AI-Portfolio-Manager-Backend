import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { fmpClient } from "../../src/providers/fmp";
import { createTestStock } from "../../src/test/factories";

describe("API stock search endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns local candidates for /api/stocks/search", async () => {
    await createTestStock("ENB.TO");

    vi.spyOn(fmpClient, "getJson").mockResolvedValue([] as never);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/stocks/search?query=ENB.TO",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);

    const localCandidate = body.data.candidates.find(
      (candidate: { ticker: string; matchType: string }) =>
        candidate.ticker === "ENB.TO" && candidate.matchType === "LOCAL",
    );

    expect(localCandidate).toBeTruthy();
    expect(localCandidate.stockId).toBeTruthy();
    expect(localCandidate.provider).toBe("LOCAL_DB");

    await app.close();
  });

  it("marks one-character ticker search candidates as potentially ambiguous", async () => {
    await createTestStock("E");

    vi.spyOn(fmpClient, "getJson").mockResolvedValue([] as never);

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/stocks/search?query=E",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.success).toBe(true);

    const eCandidate = body.data.candidates.find(
      (candidate: { ticker: string }) => candidate.ticker === "E",
    );

    expect(eCandidate).toBeTruthy();
    expect(["LOW", "MEDIUM"]).toContain(eCandidate.confidence);

    await app.close();
  });
});
