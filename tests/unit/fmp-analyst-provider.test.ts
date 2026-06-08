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
  it("maps stable price-target summary payload including rolling-window fields", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path !== "/stable/price-target-summary") {
          return [];
        }

        return [
          {
            symbol: "AAPL",
            lastMonthCount: 28,
            lastMonthAvgPriceTarget: 209.12,
            lastQuarterCount: 31,
            lastQuarterAvgPriceTarget: 210.44,
            lastYearCount: 39,
            lastYearAvgPriceTarget: 205.83,
            allTimeCount: 49,
            allTimeAvgPriceTarget: 198.91,
            publishers: '["Firm A", "Firm B"]',
          },
        ];
      }),
    );

    const snapshot = await provider.getPriceTargetSummary("AAPL");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.lastMonthPriceTargetCount).toBe(28);
    expect(snapshot?.lastMonthPriceTargetAvg).toBeCloseTo(209.12);
    expect(snapshot?.lastQuarterPriceTargetCount).toBe(31);
    expect(snapshot?.lastQuarterPriceTargetAvg).toBeCloseTo(210.44);
    expect(snapshot?.allTimePriceTargetCount).toBe(49);
    expect(snapshot?.allTimePriceTargetAvg).toBeCloseTo(198.91);
    expect(snapshot?.priceTargetAverage).toBeCloseTo(210.44);
    expect(snapshot?.analystCount).toBe(31);
  });

  it("maps stable price-target consensus payload including target median", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path !== "/stable/price-target-consensus") {
          return [];
        }

        return [
          {
            symbol: "AAPL",
            targetHigh: 240,
            targetLow: 172,
            targetConsensus: 212,
            targetMedian: 214,
          },
        ];
      }),
    );

    const consensus = await provider.getPriceTargetConsensus("AAPL");

    expect(consensus).not.toBeNull();
    expect(consensus?.priceTargetConsensus).toBe(212);
    expect(consensus?.targetMedian).toBe(214);
    expect(consensus?.priceTargetHigh).toBe(240);
    expect(consensus?.priceTargetLow).toBe(172);
  });

  it("maps grades-consensus as analyst ratings distribution", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path !== "/stable/grades-consensus") {
          return [];
        }

        return [
          {
            symbol: "AAPL",
            strongBuy: 5,
            buy: 17,
            hold: 6,
            sell: 1,
            strongSell: 0,
            consensus: "Buy",
          },
        ];
      }),
    );

    const ratings = await provider.getAnalystRatings("AAPL");

    expect(ratings).not.toBeNull();
    expect(ratings?.ratingConsensus).toBe("Buy");
    expect(ratings?.strongBuyCount).toBe(5);
    expect(ratings?.buyCount).toBe(17);
    expect(ratings?.holdCount).toBe(6);
    expect(ratings?.sellCount).toBe(1);
    expect(ratings?.strongSellCount).toBe(0);
    expect(ratings?.analystCount).toBe(29);
  });

  it("maps grades rows into analyst action events", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path, query) => {
        if (path !== "/stable/grades") {
          return [];
        }

        expect(query).toMatchObject({ symbol: "NVDA", limit: 2 });

        return [
          {
            symbol: "nvda",
            action: "Downgrade",
            gradingCompany: "Firm B",
            date: "2026-06-08",
            previousGrade: "Buy",
            newGrade: "Hold",
          },
          {
            symbol: "nvda",
            action: "Upgrade",
            gradingCompany: "Firm A",
            date: "2026-06-10",
            previousGrade: "Hold",
            newGrade: "Buy",
          },
          {
            symbol: "nvda",
            action: "Maintain",
            gradingCompany: "Firm C",
            date: "2026-06-09",
            previousGrade: "Neutral",
            newGrade: "Buy",
          },
        ];
      }),
    );

    const actions = await provider.getUpgradesDowngrades("nvda", { limit: 2 });

    expect(actions).toHaveLength(2);
    expect(actions[0]?.ticker).toBe("NVDA");
    expect(actions[0]?.actionType).toBe("UPGRADE");
    expect(actions[0]?.firm).toBe("Firm A");
    expect(actions[1]?.actionType).toBe("REITERATED");
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

  it("uses grades-historical fallback when grades-consensus is unavailable", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path === "/stable/grades-consensus") {
          return [];
        }

        if (path !== "/stable/grades-historical") {
          return [];
        }

        return [
          {
            symbol: "AAPL",
            date: "2026-06-01",
            analystRatingsStrongBuy: 7,
            analystRatingsBuy: 12,
            analystRatingsHold: 4,
            analystRatingsSell: 1,
            analystRatingsStrongSell: 0,
          },
        ];
      }),
    );

    const ratings = await provider.getAnalystRatings("AAPL");

    expect(ratings).not.toBeNull();
    expect(ratings?.strongBuyCount).toBe(7);
    expect(ratings?.buyCount).toBe(12);
    expect(ratings?.holdCount).toBe(4);
    expect(ratings?.sellCount).toBe(1);
    expect(ratings?.strongSellCount).toBe(0);
    expect(ratings?.analystCount).toBe(24);
  });

  it("maps analyst-estimates annual payload", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path, query) => {
        if (path !== "/stable/analyst-estimates") {
          return [];
        }

        expect(query).toMatchObject({ symbol: "AAPL", period: "annual", page: 0, limit: 10 });

        return [
          {
            symbol: "AAPL",
            date: "2027-09-30",
            revenueLow: 410000000000,
            revenueHigh: 430000000000,
            revenueAvg: 420000000000,
            epsAvg: 7.84,
            epsHigh: 8.12,
            epsLow: 7.41,
            numAnalystsRevenue: 26,
            numAnalystsEps: 27,
          },
        ];
      }),
    );

    const estimates = await provider.getAnalystEstimates("AAPL", { period: "annual", limit: 10 });

    expect(estimates).toHaveLength(1);
    expect(estimates[0]?.period).toBe("annual");
    expect(estimates[0]?.revenueAvg).toBe(420000000000);
    expect(estimates[0]?.epsAvg).toBe(7.84);
    expect(estimates[0]?.numAnalystsRevenue).toBe(26);
  });

  it("does not treat ratings-snapshot as analyst consensus distribution", async () => {
    const provider = new FmpAnalystProvider(
      createMockClient((path) => {
        if (path === "/stable/grades-consensus") {
          return [];
        }

        if (path === "/stable/grades-historical") {
          return [];
        }

        if (path === "/stable/ratings-snapshot") {
          return [
            {
              symbol: "AAPL",
              rating: "B",
              overallScore: 4,
              discountedCashFlowScore: 4,
              returnOnEquityScore: 5,
              returnOnAssetsScore: 4,
              debtToEquityScore: 3,
              priceToEarningsScore: 4,
              priceToBookScore: 4,
            },
          ];
        }

        return [];
      }),
    );

    const analystRatings = await provider.getAnalystRatings("AAPL");
    const financialRating = await provider.getRatingsSnapshot("AAPL");

    expect(analystRatings).toBeNull();
    expect(financialRating).not.toBeNull();
    expect(financialRating?.rating).toBe("B");
    expect(financialRating?.overallScore).toBe(4);
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
