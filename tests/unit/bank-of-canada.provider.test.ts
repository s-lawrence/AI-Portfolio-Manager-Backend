import { describe, expect, it, vi } from "vitest";

import { env } from "../../src/config/env";
import { BocJsonClient } from "../../src/providers/bank-of-canada/boc-client";
import { BankOfCanadaProvider } from "../../src/providers/bank-of-canada/boc-provider";

describe("bank-of-canada provider", () => {
  it("maps BoC observations to provider macro rows", async () => {
    const mockClient: BocJsonClient = {
      getJson: vi.fn().mockResolvedValue({
        observations: [
          {
            d: "2026-06-01",
            FXUSDCAD: { v: "1.3665" },
          },
          {
            d: "2026-06-02",
            FXUSDCAD: { v: "1.3710" },
          },
        ],
      }),
    };

    const provider = new BankOfCanadaProvider(mockClient);

    const result = await provider.getSeriesObservations("fxusdcad");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        provider: "BANK_OF_CANADA",
        seriesId: "FXUSDCAD",
        country: "CA",
        category: "currency",
        value: 1.3665,
      }),
    );
    expect(result[1]?.observedAt.getTime()).toBeGreaterThan(result[0]?.observedAt.getTime() ?? 0);
  });

  it("uses USD as base and CAD as quote for usd/cad helper", async () => {
    const originalSeriesId = env.BANK_OF_CANADA_USD_CAD_SERIES_ID;
    env.BANK_OF_CANADA_USD_CAD_SERIES_ID = "FXUSDCAD";

    try {
      const mockClient: BocJsonClient = {
        getJson: vi.fn().mockResolvedValue({
          observations: [
            {
              d: "2026-06-04",
              FXUSDCAD: { v: "1.3699" },
            },
          ],
        }),
      };

      const provider = new BankOfCanadaProvider(mockClient);

      const rates = await provider.getUsdCadRate();

      expect(rates).toHaveLength(1);
      expect(rates[0]).toEqual(
        expect.objectContaining({
          baseCurrency: "USD",
          quoteCurrency: "CAD",
          rate: 1.3699,
        }),
      );
      expect(rates[0]?.source).toContain("FXUSDCAD");
    } finally {
      env.BANK_OF_CANADA_USD_CAD_SERIES_ID = originalSeriesId;
    }
  });
});
