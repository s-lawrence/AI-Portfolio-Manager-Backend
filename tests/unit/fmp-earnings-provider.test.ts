import { describe, expect, it } from "vitest";

import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../../src/providers/errors";
import { FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import { FmpEarningsProvider } from "../../src/providers/fmp/fmp-earnings.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("fmp earnings provider", () => {
  it("maps stable earnings payloads and calculates surprises", async () => {
    const provider = new FmpEarningsProvider(
      createMockClient((path, query) => {
        if (path === "/earnings") {
          expect(query).toMatchObject({ symbol: "AAPL" });
          return [
            {
              symbol: "AAPL",
              epsEstimated: 1.31,
              epsActual: 1.35,
              revenueEstimated: 86_100_000_000,
              revenueActual: 87_900_000_000,
              date: "2025-05-03",
            },
          ];
        }

        throw new Error(`Unexpected path: ${path}`);
      }),
    );

    const history = await provider.getEarningsHistory("aapl", { limit: 5 });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.ticker).toBe("AAPL");
    expect(history[0]?.reportedEps).toBe(1.35);
    expect(history[0]?.estimatedEps).toBe(1.31);
    expect(history[0]?.epsSurprise).toBeCloseTo(0.04, 10);
    expect(history[0]?.revenueSurprise).toBe(1_800_000_000);
    expect(history[0]?.source).toBe("FMP");
  });

  it("maps stable earnings-calendar payload and sorts ascending", async () => {
    const provider = new FmpEarningsProvider(
      createMockClient((path, query) => {
        if (path === "/earnings-calendar") {
          expect(query).toMatchObject({ from: "2026-01-01", to: "2026-03-01", page: 0 });

          return [
            {
              symbol: "MSFT",
              date: "2026-02-10",
              epsEstimated: 2.1,
              epsActual: null,
              revenueEstimated: 98_000_000_000,
              revenueActual: null,
            },
            {
              symbol: "AAPL",
              date: "2026-01-27",
              epsEstimated: 1.5,
              epsActual: null,
              revenueEstimated: 89_000_000_000,
              revenueActual: null,
            },
          ];
        }

        throw new Error(`Unexpected path: ${path}`);
      }),
    );

    const events = await provider.getEarningsCalendar({
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-03-01T00:00:00.000Z"),
      page: 0,
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.ticker).toBe("AAPL");
    expect(events[1]?.ticker).toBe("MSFT");
  });

  it("getNextEarnings returns first future event and skips invalid/blank rows", async () => {
    const today = new Date();
    const past = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000);
    const future = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

    const provider = new FmpEarningsProvider(
      createMockClient((path) => {
        if (path === "/earnings") {
          return [
            { symbol: "AAPL", date: "not-a-date", epsEstimated: 1.1 },
            { symbol: "AAPL", date: past.toISOString().slice(0, 10), epsEstimated: 1.2 },
            { symbol: "AAPL", date: future.toISOString().slice(0, 10) },
            {
              symbol: "AAPL",
              date: future.toISOString().slice(0, 10),
              epsEstimated: 1.3,
            },
          ];
        }

        return [];
      }),
    );

    const next = await provider.getNextEarnings("AAPL");
    expect(next).not.toBeNull();
    expect(next?.ticker).toBe("AAPL");
    expect(next?.earningsDate?.toISOString().slice(0, 10)).toBe(
      future.toISOString().slice(0, 10),
    );
    expect(next?.estimatedEps).toBe(1.3);
  });

  it("getNextEarnings returns null when no future events exist", async () => {
    const provider = new FmpEarningsProvider(
      createMockClient((path) => {
        if (path === "/earnings") {
          return [
            {
              symbol: "AAPL",
              date: "2024-01-15",
              epsEstimated: 1.1,
            },
          ];
        }

        return [];
      }),
    );

    const next = await provider.getNextEarnings("AAPL");
    expect(next).toBeNull();
  });

  it("getEarningsHistory returns past events newest first and skips invalid dates", async () => {
    const today = new Date();
    const pastA = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
    const pastB = new Date(today.getTime() - 20 * 24 * 60 * 60 * 1000);
    const future = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);

    const provider = new FmpEarningsProvider(
      createMockClient((path) => {
        if (path === "/earnings") {
          return [
            { symbol: "AAPL", date: "invalid", epsEstimated: 1.0 },
            { symbol: "AAPL", date: future.toISOString().slice(0, 10), epsEstimated: 1.2 },
            { symbol: "AAPL", date: pastB.toISOString().slice(0, 10), epsEstimated: 0.9 },
            { symbol: "AAPL", date: pastA.toISOString().slice(0, 10), epsEstimated: 1.1 },
          ];
        }

        return [];
      }),
    );

    const history = await provider.getEarningsHistory("AAPL", { limit: 10 });
    expect(history).toHaveLength(2);
    expect(history[0]?.earningsDate?.getTime()).toBeGreaterThan(
      history[1]?.earningsDate?.getTime() ?? 0,
    );
  });

  it("enforces max 90-day range for getEarningsCalendar", async () => {
    const provider = new FmpEarningsProvider(createMockClient(() => []));

    await expect(
      provider.getEarningsCalendar({
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow(/90 days/i);
  });

  it("returns null or empty when stable earnings data is unavailable", async () => {
    const provider = new FmpEarningsProvider(createMockClient(() => []));

    const next = await provider.getNextEarnings("msft");
    const history = await provider.getEarningsHistory("msft");

    expect(next).toBeNull();
    expect(history).toEqual([]);
  });

  it("throws clear errors for unauthorized and rate-limited responses", async () => {
    const unauthorizedProvider = new FmpEarningsProvider(
      createMockClient((path) => {
        if (path === "/earnings") {
          throw new ProviderRequestError(
            "Financial Modeling Prep",
            "Unauthorized",
            { endpoint: path, statusCode: 403 },
          );
        }

        return [];
      }),
    );

    await expect(unauthorizedProvider.getNextEarnings("aapl")).rejects.toBeInstanceOf(
      ProviderConfigurationError,
    );

    const rateLimitedProvider = new FmpEarningsProvider(
      createMockClient((path) => {
        if (path === "/earnings") {
          throw new ProviderRequestError(
            "Financial Modeling Prep",
            "Too many requests",
            { endpoint: path, statusCode: 429 },
          );
        }

        return [];
      }),
    );

    await expect(rateLimitedProvider.getEarningsHistory("aapl")).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
  });
});
