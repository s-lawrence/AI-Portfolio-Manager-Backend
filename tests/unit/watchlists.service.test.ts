import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WatchlistItemPriority,
  WatchlistItemSource,
  WatchlistItemStatus,
} from "@prisma/client";

import * as watchlistsService from "../../src/services/watchlists.service";
import * as watchlistsRepository from "../../src/repositories/watchlists.repository";
import * as watchlistItemsRepository from "../../src/repositories/watchlist-items.repository";
import * as stocksRepository from "../../src/repositories/stocks.repository";
import * as stocksService from "../../src/services/stocks.service";
import * as realDataIngestionService from "../../src/services/real-data-ingestion.service";
import * as analystIngestionService from "../../src/services/analyst-ingestion.service";
import * as aiReportsRepository from "../../src/repositories/ai-reports.repository";
import * as analystSnapshotsRepository from "../../src/repositories/analyst-snapshots.repository";
import * as analystActionsRepository from "../../src/repositories/analyst-action-events.repository";
import * as earningsRepository from "../../src/repositories/earnings-events.repository";
import * as fundamentalsRepository from "../../src/repositories/fundamental-snapshots.repository";
import * as discoveryRepository from "../../src/repositories/market-discovery-snapshots.repository";
import * as newsRepository from "../../src/repositories/news-articles.repository";
import * as priceRepository from "../../src/repositories/price-snapshots.repository";
import * as technicalRepository from "../../src/repositories/technical-snapshots.repository";
import * as geopoliticalService from "../../src/services/geopolitical-ingestion.service";

function buildWatchlistWithItems(
  items: Array<{
    itemId: string;
    ticker: string;
    status: WatchlistItemStatus;
    source?: WatchlistItemSource;
    tags?: string[];
    thesis?: string | null;
  }>,
): unknown {
  const now = new Date("2026-06-01T00:00:00.000Z");

  return {
    id: "watchlist-1",
    userId: "user-1",
    name: "Main",
    description: null,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    items: items.map((item) => ({
      id: item.itemId,
      watchlistId: "watchlist-1",
      stockId: `stock-${item.ticker}`,
      status: item.status,
      priority: WatchlistItemPriority.MEDIUM,
      source: item.source ?? WatchlistItemSource.USER,
      thesis: item.thesis ?? null,
      riskNotes: null,
      targetEntryPrice: null,
      targetExitPrice: null,
      targetAllocation: null,
      tags: item.tags ?? [],
      addedReason: null,
      rejectionReason: null,
      convertedHoldingId: null,
      lastReviewedAt: null,
      createdAt: now,
      updatedAt: now,
      stock: {
        id: `stock-${item.ticker}`,
        ticker: item.ticker,
        companyName: null,
        exchange: null,
        sector: null,
        industry: null,
        country: null,
        currency: "USD",
        assetType: "EQUITY",
        createdAt: now,
        updatedAt: now,
      },
    })),
  };
}

describe("watchlists.service refresh research data", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshWatchlistResearchData processes WATCHING/RESEARCHING/CANDIDATE items", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistWithItems").mockResolvedValue(
      buildWatchlistWithItems([
        { itemId: "item-1", ticker: "AAA", status: WatchlistItemStatus.WATCHING },
        { itemId: "item-2", ticker: "BBB", status: WatchlistItemStatus.RESEARCHING },
        { itemId: "item-3", ticker: "CCC", status: WatchlistItemStatus.CANDIDATE },
      ]) as never,
    );

    vi.spyOn(stocksService, "ensureStockExists").mockResolvedValue({ id: "stock-1" } as never);
    const marketSpy = vi.spyOn(realDataIngestionService, "ingestTickerMarketData").mockResolvedValue({
      ticker: "AAA",
      profileUpdated: true,
      quoteSnapshotCreated: true,
      historicalSnapshotsCreated: 1,
      historicalSnapshotsUpdated: 0,
      historicalSnapshotsSkipped: 0,
      technicalSnapshotCreated: true,
      warnings: [],
    });

    const result = await watchlistsService.refreshWatchlistResearchData("watchlist-1", {
      includeFundamentals: false,
      includeEarnings: false,
      includeNews: false,
      includeAnalystData: false,
      runReports: false,
    });

    expect(result.tickersProcessed).toBe(3);
    expect(result.tickersSkipped).toBe(0);
    expect(marketSpy).toHaveBeenCalledTimes(3);
  });

  it("refreshWatchlistResearchData skips REJECTED and ARCHIVED items", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistWithItems").mockResolvedValue(
      buildWatchlistWithItems([
        { itemId: "item-1", ticker: "AAA", status: WatchlistItemStatus.WATCHING },
        { itemId: "item-2", ticker: "BBB", status: WatchlistItemStatus.REJECTED },
        { itemId: "item-3", ticker: "CCC", status: WatchlistItemStatus.ARCHIVED },
      ]) as never,
    );

    vi.spyOn(stocksService, "ensureStockExists").mockResolvedValue({ id: "stock-1" } as never);
    const marketSpy = vi.spyOn(realDataIngestionService, "ingestTickerMarketData").mockResolvedValue({
      ticker: "AAA",
      profileUpdated: true,
      quoteSnapshotCreated: true,
      historicalSnapshotsCreated: 1,
      historicalSnapshotsUpdated: 0,
      historicalSnapshotsSkipped: 0,
      technicalSnapshotCreated: true,
      warnings: [],
    });

    const result = await watchlistsService.refreshWatchlistResearchData("watchlist-1", {
      includeFundamentals: false,
      includeEarnings: false,
      includeNews: false,
      includeAnalystData: false,
      runReports: false,
    });

    expect(result.tickersProcessed).toBe(1);
    expect(result.tickersSkipped).toBe(2);
    expect(marketSpy).toHaveBeenCalledTimes(1);
    expect(result.perTickerResults.filter((item) => item.skipped)).toHaveLength(2);
  });

  it("refreshWatchlistResearchData handles per-ticker failures without failing the whole refresh", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistWithItems").mockResolvedValue(
      buildWatchlistWithItems([
        { itemId: "item-1", ticker: "AAA", status: WatchlistItemStatus.WATCHING },
        { itemId: "item-2", ticker: "BBB", status: WatchlistItemStatus.WATCHING },
      ]) as never,
    );

    vi.spyOn(stocksService, "ensureStockExists").mockResolvedValue({ id: "stock-1" } as never);
    const marketSpy = vi.spyOn(realDataIngestionService, "ingestTickerMarketData").mockImplementation(async (ticker) => {
      if (ticker === "AAA") {
        throw new Error("provider unsupported");
      }

      return {
        ticker,
        profileUpdated: true,
        quoteSnapshotCreated: true,
        historicalSnapshotsCreated: 1,
        historicalSnapshotsUpdated: 0,
        historicalSnapshotsSkipped: 0,
        technicalSnapshotCreated: true,
        warnings: [],
      };
    });

    const result = await watchlistsService.refreshWatchlistResearchData("watchlist-1", {
      includeFundamentals: false,
      includeEarnings: false,
      includeNews: false,
      includeAnalystData: false,
      runReports: false,
    });

    expect(marketSpy).toHaveBeenCalledTimes(2);
    expect(result.tickersProcessed).toBe(2);
    expect(result.tickersFailed).toBe(1);
    expect(result.perTickerResults.some((item) => item.ticker === "BBB" && item.failedCategories.length === 0)).toBe(true);
  });

  it("refreshWatchlistResearchData dry-run does not call provider ingestion functions", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistWithItems").mockResolvedValue(
      buildWatchlistWithItems([
        { itemId: "item-1", ticker: "NVDA", status: WatchlistItemStatus.WATCHING },
        { itemId: "item-2", ticker: "RY.TO", status: WatchlistItemStatus.CANDIDATE },
      ]) as never,
    );

    const marketSpy = vi.spyOn(realDataIngestionService, "ingestTickerMarketData");
    const fundamentalsSpy = vi.spyOn(realDataIngestionService, "ingestTickerFundamentals");
    const earningsSpy = vi.spyOn(realDataIngestionService, "ingestTickerEarnings");
    const newsSpy = vi.spyOn(realDataIngestionService, "ingestTickerNews");
    const analystSpy = vi.spyOn(analystIngestionService, "ingestTickerAnalystData");

    const result = await watchlistsService.refreshWatchlistResearchData("watchlist-1", {
      dryRun: true,
    });

    expect(marketSpy).not.toHaveBeenCalled();
    expect(fundamentalsSpy).not.toHaveBeenCalled();
    expect(earningsSpy).not.toHaveBeenCalled();
    expect(newsSpy).not.toHaveBeenCalled();
    expect(analystSpy).not.toHaveBeenCalled();
    expect(result.plannedTickers).toEqual(["NVDA", "RY.TO"]);
  });
});

describe("watchlists.service research bundle freshness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getWatchlistResearchBundle marks missingResearchData for sparse items", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistWithItems").mockResolvedValue(
      buildWatchlistWithItems([
        { itemId: "item-1", ticker: "WLTH", status: WatchlistItemStatus.WATCHING },
      ]) as never,
    );

    vi.spyOn(priceRepository, "getLatestMarketSnapshotForStock").mockResolvedValue(null);
    vi.spyOn(technicalRepository, "getLatestTechnicalSnapshot").mockResolvedValue(null);
    vi.spyOn(fundamentalsRepository, "getLatestFundamentalSnapshot").mockResolvedValue(null);
    vi.spyOn(analystSnapshotsRepository, "getLatestAnalystSnapshot").mockResolvedValue(null);
    vi.spyOn(analystActionsRepository, "listAnalystActionsByStock").mockResolvedValue([]);
    vi.spyOn(discoveryRepository, "listRecentDiscovery").mockResolvedValue([]);
    vi.spyOn(aiReportsRepository, "getLatestAIReportByStockId").mockResolvedValue(null);
    vi.spyOn(newsRepository, "listNewsByStockId").mockResolvedValue([]);
    vi.spyOn(earningsRepository, "getNextEarningsEvent").mockResolvedValue(null);
    vi.spyOn(geopoliticalService, "getGeopoliticalSummary").mockRejectedValue(new Error("skip"));

    const bundle = await watchlistsService.getWatchlistResearchBundle("watchlist-1");

    expect(bundle).not.toBeNull();
    expect(bundle?.items[0]?.hasResearchData).toBe(false);
    expect(bundle?.items[0]?.missingResearchData).toEqual(
      expect.arrayContaining([
        "latestPriceSnapshot",
        "latestTechnicalSnapshot",
        "latestFundamentalSnapshot",
        "analystContext",
        "topHeadlines",
        "nextEarningsEvent",
      ]),
    );
  });
});

describe("watchlists.service add/cleanup safeguards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("addTickerToWatchlist rejects command-word ticker when unknown", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistById").mockResolvedValue({
      id: "watchlist-1",
    } as never);
    vi.spyOn(stocksRepository, "getStockByTicker").mockResolvedValue(null);

    await expect(
      watchlistsService.addTickerToWatchlist("watchlist-1", "ADD", {
        status: WatchlistItemStatus.WATCHING,
      }),
    ).rejects.toThrow(/command word/i);
  });

  it("addTickerToWatchlist allows command-word ticker when already known", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistById").mockResolvedValue({
      id: "watchlist-1",
    } as never);
    vi.spyOn(stocksRepository, "getStockByTicker").mockResolvedValue({
      id: "stock-add",
      ticker: "ADD",
    } as never);
    vi.spyOn(stocksService, "ensureStockExists").mockResolvedValue({ id: "stock-add" } as never);
    vi.spyOn(watchlistItemsRepository, "getWatchlistItemByWatchlistAndStock").mockResolvedValue(null);
    vi.spyOn(watchlistItemsRepository, "createWatchlistItem").mockResolvedValue({
      id: "item-1",
      watchlistId: "watchlist-1",
      stockId: "stock-add",
      status: WatchlistItemStatus.WATCHING,
      priority: WatchlistItemPriority.MEDIUM,
      source: WatchlistItemSource.USER,
      tags: [],
    } as never);

    const result = await watchlistsService.addTickerToWatchlist("watchlist-1", "ADD", {
      status: WatchlistItemStatus.WATCHING,
    });

    expect(result.id).toBe("item-1");
  });

  it("cleanupWatchlistArtifacts removes only explicit demo/smoke artifacts", async () => {
    vi.spyOn(watchlistsRepository, "getWatchlistWithItems").mockResolvedValue(
      buildWatchlistWithItems([
        { itemId: "item-add", ticker: "ADD", status: WatchlistItemStatus.WATCHING },
        {
          itemId: "item-smoke-tag",
          ticker: "INTC",
          status: WatchlistItemStatus.WATCHING,
          tags: ["smoke-test"],
        },
        {
          itemId: "item-smoke-thesis",
          ticker: "WLTH",
          status: WatchlistItemStatus.WATCHING,
          source: WatchlistItemSource.AGENT,
          thesis: "Smoke write verification for artifact cleanup",
        },
        { itemId: "item-nvda", ticker: "NVDA", status: WatchlistItemStatus.WATCHING },
        { itemId: "item-aapl", ticker: "AAPL", status: WatchlistItemStatus.WATCHING },
        { itemId: "item-msft", ticker: "MSFT", status: WatchlistItemStatus.WATCHING },
      ]) as never,
    );

    const deleteSpy = vi
      .spyOn(watchlistItemsRepository, "deleteWatchlistItem")
      .mockResolvedValue({ id: "removed" } as never);

    const result = await watchlistsService.cleanupWatchlistArtifacts("watchlist-1");

    expect(deleteSpy).toHaveBeenCalledTimes(3);
    expect(result.removedCount).toBe(3);
    expect(result.keptCount).toBe(3);
    expect(result.removedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: "item-add", ticker: "ADD", reason: "COMMAND_WORD_TICKER_ADD" }),
        expect.objectContaining({ itemId: "item-smoke-tag", ticker: "INTC", reason: "SMOKE_TEST_TAG" }),
        expect.objectContaining({
          itemId: "item-smoke-thesis",
          ticker: "WLTH",
          reason: "SMOKE_WRITE_VERIFICATION_THESIS",
        }),
      ]),
    );
  });
});
