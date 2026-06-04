import { describe, expect, it } from "vitest";

import { ProviderConfigurationError, ProviderRequestError } from "../../src/providers/errors";
import { FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import { FmpEconomicsProvider } from "../../src/providers/fmp/fmp-economics.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("fmp economics provider", () => {
  it("maps treasury rates and keeps newest-first order", async () => {
    const provider = new FmpEconomicsProvider(
      createMockClient((path) => {
        if (path === "/treasury-rates") {
          return [
            {
              date: "2026-05-02",
              year10: 4.44,
              year2: 4.12,
            },
            {
              date: "2026-05-05",
              year10: 4.48,
              year2: 4.16,
            },
          ];
        }

        return [];
      }),
    );

    const records = await provider.getTreasuryRates();

    expect(records).toHaveLength(2);
    expect(records[0]?.date.toISOString().slice(0, 10)).toBe("2026-05-05");
    expect(records[0]?.year10).toBe(4.48);
    expect(records[0]?.year2).toBe(4.16);
  });

  it("maps economic calendar from stable endpoint and sorts ascending", async () => {
    const provider = new FmpEconomicsProvider(
      createMockClient((path) => {
        if (path === "/economic-calendar") {
          return [
            {
              title: "US CPI",
              country: "US",
              category: "Inflation",
              importance: "HIGH",
              date: "2026-06-15",
              estimate: 3.2,
            },
            {
              title: "US Payrolls",
              country: "US",
              category: "Labor",
              importance: "HIGH",
              date: "2026-06-07",
              estimate: 185,
            },
          ];
        }

        return [];
      }),
    );

    const events = await provider.getEconomicCalendar({
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-06-30T00:00:00.000Z"),
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.title).toBe("US Payrolls");
    expect(events[1]?.title).toBe("US CPI");
  });

  it("maps market risk premium and skips invalid dates", async () => {
    const provider = new FmpEconomicsProvider(
      createMockClient((path) => {
        if (path === "/market-risk-premium") {
          return [
            {
              date: "not-a-date",
              country: "US",
              totalRiskPremium: 5.4,
            },
            {
              date: "2026-05-30",
              country: "US",
              equityRiskPremium: 4.8,
              countryRiskPremium: 0.6,
              totalRiskPremium: 5.4,
            },
          ];
        }

        return [];
      }),
    );

    const rows = await provider.getMarketRiskPremium();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.country).toBe("US");
    expect(rows[0]?.totalRiskPremium).toBe(5.4);
  });

  it("skips invalid economic indicator rows", async () => {
    const provider = new FmpEconomicsProvider(
      createMockClient((path) => {
        if (path === "/economic-indicators") {
          return [
            {
              name: "GDP",
              date: "2026-04-01",
              value: 2.1,
            },
            {
              name: "CPI",
              date: "bad-date",
              value: 3.1,
            },
            {
              name: "Unemployment",
              date: "2026-04-01",
              value: "N/A",
            },
          ];
        }

        return [];
      }),
    );

    const rows = await provider.getEconomicIndicators();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("GDP");
    expect(rows[0]?.value).toBe(2.1);
  });

  it("surfaces 402 as entitlement/configuration error", async () => {
    const provider = new FmpEconomicsProvider(
      createMockClient((path) => {
        if (path === "/treasury-rates") {
          throw new ProviderRequestError("Financial Modeling Prep", "Payment required", {
            endpoint: path,
            statusCode: 402,
          });
        }

        return [];
      }),
    );

    await expect(provider.getTreasuryRates()).rejects.toBeInstanceOf(ProviderConfigurationError);
  });
});
