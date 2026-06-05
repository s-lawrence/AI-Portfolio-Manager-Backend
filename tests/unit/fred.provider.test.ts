import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/config/env";
import { ProviderConfigurationError } from "../../src/providers/errors";
import { FredClient, FredJsonClient } from "../../src/providers/fred/fred-client";
import { FredProvider } from "../../src/providers/fred/fred-provider";

describe("fred provider", () => {
  const originalFredApiKey = env.FRED_API_KEY;

  afterEach(() => {
    env.FRED_API_KEY = originalFredApiKey;
    vi.restoreAllMocks();
  });

  it("maps FRED observations and skips missing dot values", async () => {
    const mockClient: FredJsonClient = {
      getJson: vi.fn().mockResolvedValue({
        observations: [
          {
            date: "2026-06-01",
            value: ".",
          },
          {
            date: "2026-06-02",
            value: "4.56",
          },
          {
            date: "2026-06-03",
            value: "4.62",
          },
        ],
      }),
    };

    const provider = new FredProvider(mockClient);

    const result = await provider.getSeriesObservations("dgs10");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        provider: "FRED",
        seriesId: "DGS10",
        category: "rates",
        country: "US",
        value: 4.56,
      }),
    );
    expect(result[1]?.value).toBe(4.62);
  });

  it("throws a configuration error when API key is missing on call", async () => {
    env.FRED_API_KEY = undefined;

    const client = new FredClient({
      baseUrl: "https://api.stlouisfed.org/fred",
    });

    await expect(
      client.getJson("/series/observations", { series_id: "DGS10" }),
    ).rejects.toBeInstanceOf(ProviderConfigurationError);
  });
});
