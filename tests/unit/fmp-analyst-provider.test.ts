import { describe, expect, it } from "vitest";

import { ProviderRequestError } from "../../src/providers/errors";
import { FMP_PROVIDER_NAME, FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import { FmpAnalystProvider } from "../../src/providers/fmp/fmp-analyst.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("fmp-analyst.provider", () => {
  it("falls back from stable summary endpoint and maps analyst snapshot fields", async () => {
    const calledPaths: string[] = [];
    let calledQuery: FmpJsonQuery | undefined;

    const provider = new FmpAnalystProvider(
      createMockClient((path, query) => {
        calledPaths.push(path);
        calledQuery = query;

        if (path === "/stable/price-target-summary") {
          throw new ProviderRequestError(FMP_PROVIDER_NAME, "not found", {
            statusCode: 404,
          });
        }

        if (path === "/price-target-summary") {
          return [
            {
              symbol: "aapl",
              date: "2026-06-01",
              targetMean: "210.5",
              targetHigh: "238.0",
              targetLow: "188.0",
              targetConsensus: "215.0",
              analystCount: "30",
              ratingConsensus: "BUY",
              upsidePercent: "11.4",
            },
          ];
        }

        return [];
      }),
    );

    const snapshot = await provider.getPriceTargetSummary("aapl");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.ticker).toBe("AAPL");
    expect(snapshot?.priceTargetAverage).toBeCloseTo(210.5);
    expect(snapshot?.priceTargetHigh).toBeCloseTo(238);
    expect(snapshot?.priceTargetLow).toBeCloseTo(188);
    expect(snapshot?.priceTargetConsensus).toBeCloseTo(215);
    expect(snapshot?.analystCount).toBe(30);
    expect(snapshot?.ratingConsensus).toBe("BUY");
    expect(snapshot?.upsidePercent).toBeCloseTo(11.4);
    expect(calledPaths).toEqual([
      "/stable/price-target-summary",
      "/price-target-summary",
    ]);
    expect(calledQuery).toMatchObject({ symbol: "AAPL" });
  });

  it("maps price-target consensus and analyst ratings payloads", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path === "/stable/price-target-consensus") {
          return [
            {
              targetConsensus: "190",
              analystCount: 22,
              ratingConsensus: "OUTPERFORM",
            },
          ];
        }

        if (path === "/stable/analyst-ratings") {
          return [
            {
              analystCount: "22",
              recommendation: "Outperform",
              strongBuy: "8",
              buy: "7",
              hold: "5",
              sell: "1",
              strongSell: "1",
            },
          ];
        }

        return [];
      }),
    );

    const consensus = await provider.getPriceTargetConsensus("MSFT");
    const ratings = await provider.getAnalystRatings("MSFT");

    expect(consensus).not.toBeNull();
    expect(consensus?.priceTargetConsensus).toBe(190);
    expect(consensus?.analystCount).toBe(22);
    expect(consensus?.ratingConsensus).toBe("OUTPERFORM");

    expect(ratings).not.toBeNull();
    expect(ratings?.analystCount).toBe(22);
    expect(ratings?.ratingConsensus).toBe("Outperform");
    expect(ratings?.strongBuyCount).toBe(8);
    expect(ratings?.buyCount).toBe(7);
    expect(ratings?.holdCount).toBe(5);
    expect(ratings?.sellCount).toBe(1);
    expect(ratings?.strongSellCount).toBe(1);
  });

  it("maps upgrades/downgrades with ticker normalization, sort order, and limits", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path, query) => {
        if (path !== "/stable/upgrades-downgrades") {
          return [];
        }

        expect(query).toMatchObject({ symbol: "NVDA", limit: 2 });

        return [
          {
            symbol: "nvda",
            actionType: "Downgrade",
            firm: "Firm B",
            eventDate: "2026-06-08",
            previousGrade: "Buy",
            newGrade: "Hold",
            previousTargetPrice: "140",
            newTargetPrice: "130",
          },
          {
            symbol: "nvda",
            actionType: "Upgrade",
            firm: "Firm A",
            eventDate: "2026-06-10",
            previousGrade: "Hold",
            newGrade: "Buy",
            previousTargetPrice: "130",
            newTargetPrice: "150",
          },
          {
            symbol: "nvda",
            actionType: "Upgrade",
            firm: "Firm C",
            eventDate: "2026-06-09",
            previousGrade: "Neutral",
            newGrade: "Buy",
            previousTargetPrice: "132",
            newTargetPrice: "148",
          },
        ];
      }),
    );

    const actions = await provider.getUpgradesDowngrades("nvda", { limit: 2 });

    expect(actions).toHaveLength(2);
    expect(actions[0]?.ticker).toBe("NVDA");
    expect(actions[0]?.actionType).toBe("UPGRADE");
    expect(actions[0]?.firm).toBe("Firm A");
    expect(actions[1]?.firm).toBe("Firm C");
  });

  it("maps market movers for gainers category", async () => {
    let calledPath: string | undefined;

    const provider = new FmpAnalystProvider(
      createMockClient((path, query) => {
        calledPath = path;
        expect(query).toMatchObject({ limit: 1 });

        return [
          {
            symbol: "shop.to",
            companyName: "Shopify",
            price: "125.5",
            changesPercentage: "4.2",
            volume: "1000000",
            marketCap: "20000000000",
          },
        ];
      }),
    );

    const movers = await provider.getMarketMovers("GAINERS", { limit: 1 });

    expect(calledPath).toBe("/stable/biggest-gainers");
    expect(movers).toHaveLength(1);
    expect(movers[0]?.ticker).toBe("SHOP.TO");
    expect(movers[0]?.category).toBe("GAINERS");
    expect(movers[0]?.changePercent).toBeCloseTo(4.2);
    expect(movers[0]?.volume).toBe(1_000_000);
  });

  it("filters analyst discovery items by upgrades/downgrades category", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path !== "/stable/upgrades-downgrades") {
          return [];
        }

        return [
          {
            symbol: "aapl",
            actionType: "Upgrade",
            firm: "Firm Up",
            eventDate: "2026-06-10",
            newTargetPrice: "220",
          },
          {
            symbol: "aapl",
            actionType: "Downgrade",
            firm: "Firm Down",
            eventDate: "2026-06-09",
            newTargetPrice: "180",
          },
        ];
      }),
    );

    const upgrades = await provider.getMarketMovers("ANALYST_UPGRADES", { limit: 10 });
    const downgrades = await provider.getMarketMovers("ANALYST_DOWNGRADES", { limit: 10 });

    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.category).toBe("ANALYST_UPGRADES");
    expect(upgrades[0]?.companyName).toBe("Firm Up");

    expect(downgrades).toHaveLength(1);
    expect(downgrades[0]?.category).toBe("ANALYST_DOWNGRADES");
    expect(downgrades[0]?.companyName).toBe("Firm Down");
  });
});
