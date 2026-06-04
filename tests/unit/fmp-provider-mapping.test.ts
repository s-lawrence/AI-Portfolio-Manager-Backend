import { describe, expect, it } from "vitest";

import { FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import { FmpMarketDataProvider } from "../../src/providers/fmp/fmp-market-data.provider";
import { FmpProfileProvider } from "../../src/providers/fmp/fmp-profile.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("fmp provider mapping", () => {
  it("maps FMP quote payload into ProviderQuote", async () => {
    let calledPath: string | undefined;
    let calledQuery: FmpJsonQuery | undefined;

    const provider = new FmpMarketDataProvider(
      createMockClient((path, query) => {
        calledPath = path;
        calledQuery = query;

        return [
          {
            symbol: "aapl",
            price: 192.34,
            open: 189.4,
            dayHigh: 193,
            dayLow: 188.9,
            previousClose: 190.21,
            change: 2.13,
            changesPercentage: "1.12%",
            volume: 51_200_000,
            marketCap: 2_940_000_000_000,
            exchange: "NASDAQ",
            timestamp: 1_717_430_400,
          },
        ];
      }),
    );

    const quote = await provider.getQuote("aapl");

    expect(quote.ticker).toBe("AAPL");
    expect(quote.price).toBe(192.34);
    expect(quote.open).toBe(189.4);
    expect(quote.high).toBe(193);
    expect(quote.low).toBe(188.9);
    expect(quote.previousClose).toBe(190.21);
    expect(quote.change).toBe(2.13);
    expect(quote.changePercent).toBeCloseTo(1.12);
    expect(quote.exchange).toBe("NASDAQ");
    expect(quote.asOf).toBeInstanceOf(Date);
    expect(calledPath).toBe("/quote");
    expect(calledQuery).toMatchObject({ symbol: "AAPL" });
  });

  it("sorts historical rows ascending and applies most recent limit", async () => {
    let calledPath: string | undefined;
    let calledQuery: FmpJsonQuery | undefined;

    const provider = new FmpMarketDataProvider(
      createMockClient((path, query) => {
        calledPath = path;
        calledQuery = query;

        return {
          symbol: "AAPL",
          historical: [
            { date: "2026-03-03", close: 103, open: 102, high: 104, low: 101, volume: 3000 },
            { date: "bad-date", close: 999 },
            { date: "2026-03-01", close: 101, open: 100, high: 102, low: 99, volume: 1000 },
            { date: "2026-03-02", close: 102, open: 101, high: 103, low: 100, volume: 2000 },
            { date: "2026-03-04", high: 105, low: 103 },
          ],
        };
      }),
    );

    const historical = await provider.getHistoricalDailyPrices("aapl", { limit: 2 });

    expect(historical).toHaveLength(2);
    expect(historical[0]?.close).toBe(102);
    expect(historical[1]?.close).toBe(103);
    expect(historical[0]?.date.getTime() ?? 0).toBeLessThan(
      historical[1]?.date.getTime() ?? 0,
    );
    expect(calledPath).toBe("/historical-price-eod/full");
    expect(calledQuery).toMatchObject({ symbol: "AAPL" });
  });

  it("maps FMP profile payload into ProviderCompanyProfile", async () => {
    let calledPath: string | undefined;
    let calledQuery: FmpJsonQuery | undefined;

    const provider = new FmpProfileProvider(
      createMockClient((path, query) => {
        calledPath = path;
        calledQuery = query;

        return [
          {
            symbol: "shop.to",
            companyName: "Shopify Inc.",
            exchangeShortName: "TSX",
            sector: "Technology",
            industry: "Software",
            country: "CA",
            currency: "CAD",
            type: "EQUITY",
            mktCap: 95_000_000_000,
          },
        ];
      }),
    );

    const profile = await provider.getCompanyProfile("shop.to");

    expect(profile).not.toBeNull();
    expect(profile?.ticker).toBe("SHOP.TO");
    expect(profile?.companyName).toBe("Shopify Inc.");
    expect(profile?.exchange).toBe("TSX");
    expect(profile?.sector).toBe("Technology");
    expect(profile?.industry).toBe("Software");
    expect(profile?.country).toBe("CA");
    expect(profile?.currency).toBe("CAD");
    expect(profile?.assetType).toBe("EQUITY");
    expect(profile?.marketCap).toBe(95_000_000_000);
    expect(calledPath).toBe("/profile");
    expect(calledQuery).toMatchObject({ symbol: "SHOP.TO" });
  });
});