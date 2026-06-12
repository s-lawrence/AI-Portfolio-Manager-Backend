import { WatchlistItemSource, WatchlistItemStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fmpAnalystProvider } from "../../src/providers/fmp";
import { ProviderConfigurationError } from "../../src/providers/errors";
import { listAnalystActionsByStock } from "../../src/repositories/analyst-action-events.repository";
import { getLatestAnalystSnapshot } from "../../src/repositories/analyst-snapshots.repository";
import { createWatchlistItem } from "../../src/repositories/watchlist-items.repository";
import { createWatchlist } from "../../src/repositories/watchlists.repository";
import {
  getLatestTickerAnalystSnapshot,
  ingestPortfolioAnalystData,
  ingestTickerAnalystData,
  ingestWatchlistAnalystData,
  listTickerAnalystActions,
  listTickerAnalystSnapshots,
} from "../../src/services/analyst-ingestion.service";
import { getStockProfile } from "../../src/services/stocks.service";
import {
  createTestHolding,
  createTestPortfolio,
  createTestStock,
  createTestUser,
} from "../../src/test/factories";

function mockAnalystProviderForTicker(): void {
  vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockImplementation(async (inputTicker) => ({
    ticker: inputTicker,
    capturedAt: new Date("2026-06-10T00:00:00.000Z"),
    source: "FMP",
    priceTargetAverage: 120,
    priceTargetHigh: 140,
    priceTargetLow: 100,
    analystCount: 10,
    ratingConsensus: "BUY",
    upsidePercent: 15,
    raw: { ticker: inputTicker },
  }));

  vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
    source: "FMP",
    priceTargetConsensus: 125,
    analystCount: 11,
    ratingConsensus: "BUY",
    raw: { from: "consensus" },
  });

  vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockResolvedValue({
    source: "FMP",
    analystCount: 11,
    ratingConsensus: "BUY",
    strongBuyCount: 4,
    buyCount: 5,
    holdCount: 2,
    sellCount: 0,
    strongSellCount: 0,
    raw: { from: "ratings" },
  });

  vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockResolvedValue(null);
  vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockResolvedValue([]);
  vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockResolvedValue(null);
  vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockResolvedValue([]);

  vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockImplementation(async (inputTicker) => {
    return [
      {
        ticker: inputTicker,
        source: "FMP",
        actionType: "UPGRADE",
        firm: "Firm A",
        analystName: "Analyst A",
        previousRating: "HOLD",
        newRating: "BUY",
        previousPriceTarget: 115,
        newPriceTarget: 130,
        eventDate: new Date("2026-06-11T00:00:00.000Z"),
        headline: `${inputTicker} upgraded`,
        url: `https://example.com/${inputTicker.toLowerCase()}`,
        raw: { ticker: inputTicker },
      },
    ];
  });
}

describe("analyst-ingestion.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests ticker analyst snapshot and action events", async () => {
    const stock = await createTestStock("TSTANL01");
    mockAnalystProviderForTicker();

    const result = await ingestTickerAnalystData(stock.ticker);

    expect(result.ticker).toBe(stock.ticker);
    expect(result.snapshotsCreated + result.snapshotsUpdated).toBe(1);
    expect(result.actionsCreated + result.actionsUpdated).toBe(1);
    expect(result.priceTargetSummaryStatus).toBe("SUCCESS");
    expect(result.priceTargetConsensusStatus).toBe("SUCCESS");
    expect(result.gradesConsensusStatus).toBe("SUCCESS");
    expect(result.gradesStatus).toBe("SUCCESS");
    expect(result.analystRatingsStatus).toBe("SUCCESS");
    expect(result.analystActionsStatus).toBe("SUCCESS");
    expect(result.subsourceWarnings.priceTargetSummary).toEqual([]);
    expect(result.subsourceWarnings.priceTargetConsensus).toEqual([]);
    expect(result.subsourceWarnings.analystRatings).toEqual([]);
    expect(result.subsourceWarnings.analystActions).toEqual([]);

    const latestSnapshot = await getLatestAnalystSnapshot(stock.id);
    expect(latestSnapshot).not.toBeNull();
    expect(latestSnapshot?.priceTargetConsensus).toBe(125);
    expect(latestSnapshot?.ratingConsensus).toBe("BUY");

    const actions = await listAnalystActionsByStock(stock.id, 10);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionType).toBe("UPGRADE");
  });

  it("continues portfolio analyst ingestion when one ticker fails", async () => {
    const portfolio = await createTestPortfolio();
    const goodStock = await createTestStock("TSTANLP01");
    const badStock = await createTestStock("TSTANLP02");

    await createTestHolding(portfolio.id, goodStock.id);
    await createTestHolding(portfolio.id, badStock.id);

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockImplementation(async (ticker) => ({
      ticker,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 100,
      priceTargetHigh: 120,
      priceTargetLow: 90,
      priceTargetConsensus: 110,
      analystCount: 8,
      ratingConsensus: "BUY",
      raw: { ticker },
    }));

    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 110,
      raw: { from: "consensus" },
    });

    vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockResolvedValue({
      source: "FMP",
      analystCount: 8,
      ratingConsensus: "BUY",
      strongBuyCount: 3,
      buyCount: 4,
      holdCount: 1,
      sellCount: 0,
      strongSellCount: 0,
      raw: { from: "ratings" },
    });
    vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockResolvedValue([]);
    vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockResolvedValue([]);

    vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockImplementation(async (ticker) => {
      if (ticker === badStock.ticker) {
        return [
          {
            ticker,
            source: "FMP",
            actionType: "UPGRADE",
            eventDate: new Date("invalid"),
            raw: { ticker },
          } as any,
        ];
      }

      return [
        {
          ticker,
          source: "FMP",
          actionType: "UPGRADE",
          eventDate: new Date("2026-06-11T00:00:00.000Z"),
          firm: "Good Firm",
          raw: { ticker },
        },
      ];
    });

    const result = await ingestPortfolioAnalystData(portfolio.id);

    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.failedTickers).toHaveLength(1);
    expect(result.failedTickers[0]?.ticker).toBe(badStock.ticker);
    expect(result.results[0]?.ticker).toBe(goodStock.ticker);
  });

  it("continues watchlist analyst ingestion when one ticker fails", async () => {
    const user = await createTestUser();
    const watchlist = await createWatchlist({
      userId: user.id,
      name: "[TEST] Analyst Watchlist",
      isDefault: false,
    });

    const goodStock = await createTestStock("TSTANLW01");
    const badStock = await createTestStock("TSTANLW02");

    await createWatchlistItem({
      watchlistId: watchlist.id,
      stockId: goodStock.id,
      source: WatchlistItemSource.MANUAL,
      status: WatchlistItemStatus.WATCHING,
    });

    await createWatchlistItem({
      watchlistId: watchlist.id,
      stockId: badStock.id,
      source: WatchlistItemSource.MANUAL,
      status: WatchlistItemStatus.WATCHING,
    });

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockImplementation(async (ticker) => ({
      ticker,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 100,
      priceTargetHigh: 120,
      priceTargetLow: 90,
      priceTargetConsensus: 110,
      analystCount: 8,
      ratingConsensus: "BUY",
      raw: { ticker },
    }));

    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 110,
      raw: { from: "consensus" },
    });

    vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockResolvedValue({
      source: "FMP",
      analystCount: 8,
      ratingConsensus: "BUY",
      strongBuyCount: 3,
      buyCount: 4,
      holdCount: 1,
      sellCount: 0,
      strongSellCount: 0,
      raw: { from: "ratings" },
    });
    vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockResolvedValue([]);
    vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockResolvedValue([]);

    vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockImplementation(async (ticker) => {
      if (ticker === badStock.ticker) {
        return [
          {
            ticker,
            source: "FMP",
            actionType: "DOWNGRADE",
            eventDate: new Date("invalid"),
            raw: { ticker },
          } as any,
        ];
      }

      return [
        {
          ticker,
          source: "FMP",
          actionType: "UPGRADE",
          eventDate: new Date("2026-06-11T00:00:00.000Z"),
          firm: "Good Firm",
          raw: { ticker },
        },
      ];
    });

    const result = await ingestWatchlistAnalystData(watchlist.id);

    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.failedTickers).toHaveLength(1);
    expect(result.failedTickers[0]?.ticker).toBe(badStock.ticker);
    expect(result.results[0]?.ticker).toBe(goodStock.ticker);
  });

  it("returns null/empty analyst reads for unknown tickers", async () => {
    const missingTicker = "TSTANL404";

    const latestSnapshot = await getLatestTickerAnalystSnapshot(missingTicker);
    const snapshots = await listTickerAnalystSnapshots(missingTicker, 5);
    const actions = await listTickerAnalystActions(missingTicker, 5);

    expect(await getStockProfile(missingTicker)).toBeNull();
    expect(latestSnapshot).toBeNull();
    expect(snapshots).toEqual([]);
    expect(actions).toEqual([]);
  });

  it("marks EMPTY statuses when ratings/actions return no usable records", async () => {
    const stock = await createTestStock("TSTANLEMPT");

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockResolvedValue({
      ticker: stock.ticker,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 101,
      priceTargetConsensus: 105,
      raw: { source: "summary" },
    });
    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockResolvedValue([]);
    vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockResolvedValue([]);
    vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockResolvedValue([]);

    const result = await ingestTickerAnalystData(stock.ticker);

    expect(result.priceTargetSummaryStatus).toBe("SUCCESS");
    expect(result.priceTargetConsensusStatus).toBe("EMPTY");
    expect(result.gradesConsensusStatus).toBe("EMPTY");
    expect(result.analystRatingsStatus).toBe("EMPTY");
    expect(result.gradesStatus).toBe("EMPTY");
    expect(result.analystActionsStatus).toBe("EMPTY");
    expect(result.subsourceWarnings.gradesConsensus.length).toBeGreaterThan(0);
    expect(result.subsourceWarnings.priceTargetConsensus.length).toBeGreaterThan(0);
    expect(result.subsourceWarnings.analystRatings.length).toBeGreaterThan(0);
    expect(result.subsourceWarnings.analystActions.length).toBeGreaterThan(0);
  });

  it("aggregates repeated entitlement warnings into a bounded summary", async () => {
    const portfolio = await createTestPortfolio();
    const stockA = await createTestStock("TSTANLENT1");
    const stockB = await createTestStock("TSTANLENT2");

    await createTestHolding(portfolio.id, stockA.id);
    await createTestHolding(portfolio.id, stockB.id);

    const entitlementError = new ProviderConfigurationError(
      "Financial Modeling Prep",
      "Financial Modeling Prep endpoint is not available for the current plan.",
    );

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockRejectedValue(entitlementError);
    vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockRejectedValue(entitlementError);

    const result = await ingestPortfolioAnalystData(portfolio.id);

    expect(result.tickersFailed).toBe(0);
    expect(result.analystWarningsSummary.entitlementIssuesCount).toBeGreaterThan(0);
    expect(result.analystWarningsSummary.affectedTickers).toEqual([
      stockA.ticker,
      stockB.ticker,
    ]);
    expect(
      result.warnings.filter(
        (warning) => warning === "Analyst data unavailable for some tickers under current FMP plan.",
      ),
    ).toHaveLength(1);
    expect(result.warnings.length).toBeLessThanOrEqual(5);
    expect(result.rawWarnings.length).toBeGreaterThan(result.warnings.length);
    expect(result.rawWarnings.some((warning) => warning.includes("current plan"))).toBe(true);
  });

  it("aggregates no-data warnings by ticker/category while keeping raw warning detail", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTANLND01");

    await createTestHolding(portfolio.id, stock.id);

    vi.spyOn(fmpAnalystProvider, "getPriceTargetSummary").mockResolvedValue({
      ticker: stock.ticker,
      capturedAt: new Date("2026-06-10T00:00:00.000Z"),
      source: "FMP",
      priceTargetAverage: 120,
      raw: { source: "summary" },
    });
    vi.spyOn(fmpAnalystProvider, "getPriceTargetConsensus").mockResolvedValue({
      source: "FMP",
      priceTargetConsensus: 121,
      raw: { source: "consensus" },
    });
    vi.spyOn(fmpAnalystProvider, "getGradesConsensus").mockResolvedValue(null);
    vi.spyOn(fmpAnalystProvider, "getHistoricalGrades").mockResolvedValue({
      source: "FMP",
      ratingConsensus: "HOLD",
      raw: { source: "grades-historical" },
    });
    vi.spyOn(fmpAnalystProvider, "getAnalystEstimates").mockResolvedValue([
      {
        period: "annual",
        date: new Date("2026-06-01T00:00:00.000Z"),
        source: "FMP",
      },
    ] as any);
    vi.spyOn(fmpAnalystProvider, "getRatingsSnapshot").mockResolvedValue({
      rating: "B",
      source: "FMP",
    } as any);
    vi.spyOn(fmpAnalystProvider, "getHistoricalRatings").mockResolvedValue([
      {
        rating: "B",
        source: "FMP",
      },
    ] as any);
    vi.spyOn(fmpAnalystProvider, "getRecentGrades").mockResolvedValue([
      {
        ticker: stock.ticker,
        source: "FMP",
        actionType: "UPGRADE",
        eventDate: new Date("2026-06-11T00:00:00.000Z"),
        raw: { source: "actions" },
      },
    ]);

    const result = await ingestPortfolioAnalystData(portfolio.id);

    expect(result.analystWarningsSummary.entitlementIssuesCount).toBe(0);
    expect(result.analystWarningsSummary.noDataCount).toBe(1);
    expect(result.analystWarningsSummary.noRecordsCount).toBe(0);
    expect(result.warnings.some((warning) => warning.includes("returned no data"))).toBe(true);
    expect(result.warnings.length).toBeLessThanOrEqual(5);

    const duplicatedRawWarnings = result.rawWarnings.filter((warning) =>
      warning.includes("Grades consensus returned no data."),
    );
    expect(duplicatedRawWarnings.length).toBeGreaterThan(1);
  });
});
