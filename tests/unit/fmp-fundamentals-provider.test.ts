import { describe, expect, it } from "vitest";

import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../../src/providers/errors";
import { FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import { FmpFundamentalsProvider } from "../../src/providers/fmp/fmp-fundamentals.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("fmp fundamentals provider", () => {
  it("merges multiple FMP fundamentals endpoints into provider-neutral snapshot", async () => {
    const calledPaths: string[] = [];

    const provider = new FmpFundamentalsProvider(
      createMockClient((path, query) => {
        calledPaths.push(path);
        expect(query).toMatchObject({ symbol: "AAPL" });

        if (path === "/key-metrics") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              period: "Q1",
              calendarYear: "2026",
              marketCap: 3_100_000_000_000,
              peRatio: 31,
              enterpriseValueOverEBITDA: 24,
              currentRatio: 1.2,
            },
          ];
        }

        if (path === "/ratios") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              period: "Q1",
              calendarYear: "2026",
              priceEarningsRatio: 29,
              priceToBookRatio: 10,
              priceToSalesRatio: 8.5,
              debtEquityRatio: 1.1,
              grossProfitMargin: 0.46,
              operatingProfitMargin: 0.29,
              netProfitMargin: 0.25,
              dividendYield: 0.006,
              pegRatio: 1.8,
              forwardPERatio: 26,
            },
          ];
        }

        if (path === "/profile") {
          return [
            {
              symbol: "AAPL",
              analystRating: "Buy",
            },
          ];
        }

        if (path === "/financial-growth") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              period: "Q1",
              calendarYear: "2026",
              revenueGrowth: 0.11,
            },
          ];
        }

        if (path === "/income-statement") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              eps: 1.52,
            },
          ];
        }

        if (path === "/cash-flow-statement") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              freeCashFlow: 22_000_000_000,
            },
          ];
        }

        throw new Error(`Unexpected path: ${path}`);
      }),
    );

    const result = await provider.getFundamentals("aapl");

    expect(result).not.toBeNull();
    expect(result?.ticker).toBe("AAPL");
    expect(result?.period).toBe("Q1");
    expect(result?.fiscalYear).toBe(2026);
    expect(result?.fiscalQuarter).toBe("Q1");
    expect(result?.marketCap).toBe(3_100_000_000_000);
    expect(result?.peRatio).toBe(29);
    expect(result?.forwardPeRatio).toBe(26);
    expect(result?.pegRatio).toBe(1.8);
    expect(result?.priceToSales).toBe(8.5);
    expect(result?.priceToBook).toBe(10);
    expect(result?.evToEbitda).toBe(24);
    expect(result?.eps).toBe(1.52);
    expect(result?.revenueGrowth).toBe(0.11);
    expect(result?.grossMargin).toBe(0.46);
    expect(result?.operatingMargin).toBe(0.29);
    expect(result?.netMargin).toBe(0.25);
    expect(result?.debtToEquity).toBe(1.1);
    expect(result?.currentRatio).toBe(1.2);
    expect(result?.freeCashFlow).toBe(22_000_000_000);
    expect(result?.dividendYield).toBe(0.006);
    expect(result?.analystConsensus).toBe("Buy");
    expect(result?.source).toBe("FMP");
    expect(result?.asOfDate).toBeInstanceOf(Date);

    expect(calledPaths).toEqual(
      expect.arrayContaining([
        "/key-metrics",
        "/ratios",
        "/profile",
        "/financial-growth",
        "/income-statement",
        "/cash-flow-statement",
      ]),
    );
  });

  it("continues when one endpoint returns 404 and still returns available fundamentals", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        if (path === "/ratios") {
          throw new ProviderRequestError(
            "Financial Modeling Prep",
            "Not found",
            { endpoint: path, statusCode: 404 },
          );
        }

        if (path === "/profile") {
          return [
            {
              symbol: "MSFT",
              marketCap: 2_900_000_000_000,
              analystRating: "Strong Buy",
            },
          ];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("msft");

    expect(result).not.toBeNull();
    expect(result?.ticker).toBe("MSFT");
    expect(result?.marketCap).toBe(2_900_000_000_000);
    expect(result?.analystConsensus).toBe("Strong Buy");
  });

  it("returns null when no endpoint yields usable fundamentals", async () => {
    const provider = new FmpFundamentalsProvider(createMockClient(() => []));

    const result = await provider.getFundamentals("nvda");

    expect(result).toBeNull();
  });

  it("throws configuration error for unauthorized API responses", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        if (path === "/key-metrics") {
          throw new ProviderRequestError(
            "Financial Modeling Prep",
            "Unauthorized",
            { endpoint: path, statusCode: 403 },
          );
        }

        return [];
      }),
    );

    await expect(provider.getFundamentals("aapl")).rejects.toBeInstanceOf(
      ProviderConfigurationError,
    );
  });

  it("throws rate-limit error for HTTP 429 responses", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        if (path === "/key-metrics") {
          throw new ProviderRequestError(
            "Financial Modeling Prep",
            "Too many requests",
            { endpoint: path, statusCode: 429 },
          );
        }

        return [];
      }),
    );

    await expect(provider.getFundamentals("aapl")).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
  });
});
