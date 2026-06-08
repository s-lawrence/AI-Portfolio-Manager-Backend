import { afterEach, describe, expect, it, vi } from "vitest";

import { fmpAnalystProvider } from "../../src/providers/fmp";
import {
  ingestDefaultMarketDiscoverySet,
  ingestMarketDiscovery,
  listDiscoveryCandidates,
} from "../../src/services/market-discovery.service";

describe("market-discovery.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests market discovery snapshots and lists latest candidates", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockResolvedValue([
      {
        ticker: "TSTDISC01",
        companyName: "Discovery One",
        price: 55,
        changePercent: 4.2,
        volume: 100_000,
        marketCap: 1_000_000_000,
        category: "GAINERS",
        capturedAt: new Date("2026-06-10T12:00:00.000Z"),
        source: "FMP",
        raw: { ticker: "TSTDISC01" },
      },
      {
        ticker: "TSTDISC02",
        companyName: "Discovery Two",
        price: 42,
        changePercent: 2.1,
        volume: 80_000,
        marketCap: 700_000_000,
        category: "GAINERS",
        capturedAt: new Date("2026-06-10T12:00:00.000Z"),
        source: "FMP",
        raw: { ticker: "TSTDISC02" },
      },
    ]);

    const ingestResult = await ingestMarketDiscovery("gainers", { limit: 2 });
    const listResult = await listDiscoveryCandidates("GAINERS", { limit: 10 });

    expect(ingestResult.category).toBe("GAINERS");
    expect(ingestResult.recordsCreated).toBe(2);
    expect(listResult.category).toBe("GAINERS");
    expect(listResult.items).toHaveLength(2);
    expect(listResult.items[0]?.ticker).toBe("TSTDISC01");
  });

  it("continues default discovery ingestion when one category fails", async () => {
    vi.spyOn(fmpAnalystProvider, "getMarketMovers").mockImplementation(async (category) => {
      if (category === "LOSERS") {
        throw new Error("LOSERS unavailable");
      }

      return [
        {
          ticker: `TST${category}`.slice(0, 10),
          companyName: `${category} Co.`,
          price: 100,
          changePercent: 1,
          volume: 10_000,
          marketCap: 2_000_000_000,
          category,
          capturedAt: new Date("2026-06-10T12:00:00.000Z"),
          source: "FMP",
          raw: { category },
        },
      ];
    });

    const result = await ingestDefaultMarketDiscoverySet({ limit: 3 });

    expect(result.categories).toHaveLength(5);
    expect(result.warnings.some((warning) => warning.includes("LOSERS"))).toBe(true);

    const losers = result.categories.find((item) => item.category === "LOSERS");
    expect(losers).toBeDefined();
    expect(losers?.recordsCreated).toBe(0);
    expect((losers?.warnings.length ?? 0) > 0).toBe(true);
  });

  it("lists only the latest captured snapshot batch by category", async () => {
    const marketMoverSpy = vi.spyOn(fmpAnalystProvider, "getMarketMovers");

    marketMoverSpy
      .mockResolvedValueOnce([
        {
          ticker: "TSTACT01",
          companyName: "Active Old",
          price: 120,
          changePercent: 1.2,
          volume: 300_000,
          marketCap: 5_000_000_000,
          category: "ACTIVE",
          capturedAt: new Date("2026-06-09T12:00:00.000Z"),
          source: "FMP",
          raw: { batch: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          ticker: "TSTACT02",
          companyName: "Active New",
          price: 130,
          changePercent: 2.2,
          volume: 400_000,
          marketCap: 6_000_000_000,
          category: "ACTIVE",
          capturedAt: new Date("2026-06-10T12:00:00.000Z"),
          source: "FMP",
          raw: { batch: 2 },
        },
      ]);

    await ingestMarketDiscovery("ACTIVE");
    await ingestMarketDiscovery("ACTIVE");

    const result = await listDiscoveryCandidates("ACTIVE", { limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.ticker).toBe("TSTACT02");
    expect(result.items[0]?.capturedAt.toISOString()).toContain("2026-06-10");
  });
});
