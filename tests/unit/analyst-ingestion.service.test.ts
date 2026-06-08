import { WatchlistItemSource, WatchlistItemStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fmpAnalystProvider } from "../../src/providers/fmp";
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
});
