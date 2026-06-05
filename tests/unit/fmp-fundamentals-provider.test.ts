import { describe, expect, it } from "vitest";

import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../../src/providers/errors";
import { FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import {
  FmpFundamentalsProvider,
  normalizePercentLike,
} from "../../src/providers/fmp/fmp-fundamentals.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

function toCanonicalPath(path: string): string {
  if (path.startsWith("/stable/")) {
    return `/${path.slice("/stable/".length)}`;
  }

  return path;
}

describe("fmp fundamentals provider", () => {
  it("maps stable ratios and key-metrics fields from most recent FY records", async () => {
    const calledPaths: string[] = [];

    const provider = new FmpFundamentalsProvider(
      createMockClient((path, query) => {
        calledPaths.push(path);
        expect(query).toMatchObject({ symbol: "AAPL" });

        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/key-metrics") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              period: "Q1",
              fiscalYear: "2026",
              marketCap: 3_200_000_000_000,
              evToEBITDA: 26,
              currentRatio: 1.15,
            },
            {
              symbol: "AAPL",
              date: "2025-12-31",
              period: "FY",
              fiscalYear: "2025",
              marketCap: 3_100_000_000_000,
              evToEBITDA: 24,
              currentRatio: 1.18,
            },
          ];
        }

        if (canonicalPath === "/ratios") {
          return [
            {
              symbol: "AAPL",
              date: "2026-03-31",
              period: "Q1",
              fiscalYear: "2026",
              priceToEarningsRatio: 40,
              priceToEarningsGrowthRatio: 3.2,
              priceToBookRatio: 12.5,
              priceToSalesRatio: 10.2,
              debtToEquityRatio: 1.6,
              grossProfitMargin: 0.41,
              operatingProfitMargin: 0.23,
              netProfitMargin: 0.2,
              dividendYield: 0.003,
              netIncomePerShare: 6.2,
              enterpriseValueMultiple: 29,
            },
            {
              symbol: "AAPL",
              date: "2025-12-31",
              period: "FY",
              fiscalYear: "2025",
              priceToEarningsRatio: 29,
              priceToEarningsGrowthRatio: 1.8,
              priceToBookRatio: 10,
              priceToSalesRatio: 8.5,
              debtToEquityRatio: 1.1,
              grossProfitMargin: 0.46,
              operatingProfitMargin: 0.29,
              netProfitMargin: 0.25,
              currentRatio: 1.2,
              dividendYield: 0.006,
              netIncomePerShare: 6.6,
              enterpriseValueMultiple: 24.5,
            },
          ];
        }

        if (canonicalPath === "/profile") {
          return [{ symbol: "AAPL", analystRating: "Buy" }];
        }

        if (canonicalPath === "/financial-growth") {
          return [{ symbol: "AAPL", period: "FY", fiscalYear: "2025", revenueGrowth: 0.11 }];
        }

        if (canonicalPath === "/income-statement") {
          return [{ symbol: "AAPL", date: "2025-12-31", eps: 6.5, revenue: 390_000_000_000 }];
        }

        if (canonicalPath === "/cash-flow-statement") {
          return [{ symbol: "AAPL", date: "2025-12-31", freeCashFlow: 22_000_000_000 }];
        }

        if (canonicalPath === "/balance-sheet-statement") {
          return [{ symbol: "AAPL", date: "2025-12-31", totalDebt: 100, totalStockholdersEquity: 90 }];
        }

        if (canonicalPath === "/quote") {
          return [{ symbol: "AAPL", price: 192 }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("aapl");

    expect(result).not.toBeNull();
    expect(result?.ticker).toBe("AAPL");
    expect(result?.period).toBe("FY");
    expect(result?.fiscalYear).toBe(2025);
    expect(result?.marketCap).toBe(3_100_000_000_000);
    expect(result?.peRatio).toBe(29);
    expect(result?.pegRatio).toBe(1.8);
    expect(result?.priceToBook).toBe(10);
    expect(result?.priceToSales).toBe(8.5);
    expect(result?.debtToEquity).toBe(1.1);
    expect(result?.evToEbitda).toBe(24);
    expect(result?.currentRatio).toBe(1.2);
    expect(result?.grossMargin).toBe(0.46);
    expect(result?.operatingMargin).toBe(0.29);
    expect(result?.netMargin).toBe(0.25);
    expect(result?.dividendYield).toBe(0.006);
    expect(result?.eps).toBe(6.5);
    expect(result?.freeCashFlow).toBe(22_000_000_000);
    expect(result?.source).toBe("FMP");

    expect(calledPaths).toEqual(
      expect.arrayContaining(["/stable/key-metrics", "/stable/ratios"]),
    );
  });

  it("maps enterpriseValueMultiple as evToEbitda fallback when key-metrics evToEBITDA is missing", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          return [{ symbol: "MSFT", period: "FY", date: "2025-12-31", enterpriseValueMultiple: 17.4 }];
        }

        if (canonicalPath === "/key-metrics") {
          return [{ symbol: "MSFT", period: "FY", date: "2025-12-31", marketCap: 100 }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("msft");

    expect(result?.evToEbitda).toBe(17.4);
  });

  it("prefers key-metrics evToEBITDA over ratios enterpriseValueMultiple", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          return [{ symbol: "MSFT", period: "FY", date: "2025-12-31", enterpriseValueMultiple: 18.9 }];
        }

        if (canonicalPath === "/key-metrics") {
          return [{ symbol: "MSFT", period: "FY", date: "2025-12-31", evToEBITDA: 14.2 }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("msft");

    expect(result?.evToEbitda).toBe(14.2);
  });

  it("does not map forwardPriceToEarningsGrowthRatio to forwardPeRatio", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          return [
            {
              symbol: "NVDA",
              period: "FY",
              date: "2025-12-31",
              priceToEarningsGrowthRatio: 1.9,
              forwardPriceToEarningsGrowthRatio: 2.3,
            },
          ];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("nvda");

    expect(result?.pegRatio).toBe(1.9);
    expect(result?.forwardPeRatio).toBeUndefined();
  });

  it("uses dividendYieldPercentage only when dividendYield is missing", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          return [
            {
              symbol: "AMZN",
              period: "FY",
              date: "2025-12-31",
              dividendYieldPercentage: 0.4358,
            },
          ];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("amzn");

    expect(result?.dividendYield).toBeCloseTo(0.004358, 9);
  });

  it("falls back to quote price divided by EPS when peRatio is missing", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          return [{ symbol: "META", period: "FY", date: "2025-12-31" }];
        }

        if (canonicalPath === "/income-statement") {
          return [{ symbol: "META", date: "2025-12-31", eps: 8 }];
        }

        if (canonicalPath === "/quote") {
          return [{ symbol: "META", price: 240 }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("meta");

    expect(result?.peRatio).toBe(30);
  });

  it("falls back debtToEquity to totalDebt/totalStockholdersEquity when ratios value is missing", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          return [{ symbol: "ORCL", period: "FY", date: "2025-12-31" }];
        }

        if (canonicalPath === "/balance-sheet-statement") {
          return [{ symbol: "ORCL", date: "2025-12-31", totalDebt: 180, totalStockholdersEquity: 90 }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("orcl");

    expect(result?.debtToEquity).toBe(2);
  });

  it("falls back revenueGrowth from latest two income statements when financial-growth is missing", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/financial-growth") {
          return [];
        }

        if (canonicalPath === "/income-statement") {
          return [
            { symbol: "TSLA", date: "2025-12-31", revenue: 110 },
            { symbol: "TSLA", date: "2024-12-31", revenue: 100 },
          ];
        }

        if (canonicalPath === "/ratios") {
          return [{ symbol: "TSLA", period: "FY", date: "2025-12-31" }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("tsla");

    expect(result?.revenueGrowth).toBeCloseTo(0.1, 12);
  });

  it("continues when ratios endpoint returns 404 and still returns available fundamentals", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/ratios") {
          throw new ProviderRequestError(
            "Financial Modeling Prep",
            "Not found",
            { endpoint: path, statusCode: 404 },
          );
        }

        if (canonicalPath === "/key-metrics") {
          return [{ symbol: "MSFT", period: "FY", date: "2025-12-31", marketCap: 2_900_000_000_000 }];
        }

        if (canonicalPath === "/profile") {
          return [{ symbol: "MSFT", analystRating: "Strong Buy" }];
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
        if (toCanonicalPath(path) === "/key-metrics") {
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
        if (toCanonicalPath(path) === "/key-metrics") {
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

  it("normalizes percent-like values from either decimal or percentage forms", async () => {
    const provider = new FmpFundamentalsProvider(
      createMockClient((path) => {
        const canonicalPath = toCanonicalPath(path);

        if (canonicalPath === "/financial-growth") {
          return [{ symbol: "AAPL", revenueGrowth: 5.4 }];
        }

        if (canonicalPath === "/ratios") {
          return [
            {
              symbol: "AAPL",
              period: "FY",
              date: "2025-12-31",
              grossProfitMargin: 46.2,
              operatingProfitMargin: 0.287,
              netProfitMargin: 25.2,
              dividendYield: 0.005,
              priceToEarningsRatio: 31.4,
              priceToSalesRatio: 8.4,
              priceToBookRatio: 46.3,
              debtToEquityRatio: 0.92,
              priceToEarningsGrowthRatio: 1.45,
            },
          ];
        }

        if (canonicalPath === "/key-metrics") {
          return [{ symbol: "AAPL", period: "FY", date: "2025-12-31", marketCap: 3_100_000_000_000 }];
        }

        return [];
      }),
    );

    const result = await provider.getFundamentals("AAPL");

    expect(result).not.toBeNull();
    expect(result?.revenueGrowth).toBeCloseTo(0.054, 6);
    expect(result?.grossMargin).toBeCloseTo(0.462, 6);
    expect(result?.operatingMargin).toBeCloseTo(0.287, 6);
    expect(result?.netMargin).toBeCloseTo(0.252, 6);
    expect(result?.dividendYield).toBeCloseTo(0.005, 6);

    expect(result?.peRatio).toBe(31.4);
    expect(result?.pegRatio).toBe(1.45);
    expect(result?.priceToSales).toBe(8.4);
    expect(result?.priceToBook).toBe(46.3);
    expect(result?.debtToEquity).toBe(0.92);
    expect(result?.marketCap).toBe(3_100_000_000_000);
  });

  it("normalizePercentLike helper handles decimal and percentage-form values", () => {
    expect(normalizePercentLike(5.4)).toBeCloseTo(0.054, 12);
    expect(normalizePercentLike(0.054)).toBeCloseTo(0.054, 12);
    expect(normalizePercentLike(-12.5)).toBeCloseTo(-0.125, 12);
    expect(normalizePercentLike(undefined)).toBeNull();
  });
});
