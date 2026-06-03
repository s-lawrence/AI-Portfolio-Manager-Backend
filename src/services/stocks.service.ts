import { Prisma, Stock } from "@prisma/client";

import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import { getNextEarningsEvent } from "../repositories/earnings-events.repository";
import { getLatestFundamentalSnapshot } from "../repositories/fundamental-snapshots.repository";
import { listRecentNewsByTicker } from "../repositories/news-articles.repository";
import { getLatestPriceSnapshot } from "../repositories/price-snapshots.repository";
import {
  getStockByTicker,
  listStocks as listStocksRepository,
  searchStocks as searchStocksRepository,
  upsertStockByTicker,
} from "../repositories/stocks.repository";
import { getLatestTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { TickerDashboardSummary } from "../types/services";

export type StockMetadataInput = Partial<
  Pick<
    Prisma.StockUncheckedCreateInput,
    | "companyName"
    | "exchange"
    | "sector"
    | "industry"
    | "country"
    | "currency"
    | "assetType"
  >
>;

export async function getStockProfile(ticker: string): Promise<Stock | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  return getStockByTicker(normalizedTicker);
}

export async function searchStocks(query: string): Promise<Stock[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  return searchStocksRepository(trimmed);
}

export async function listStocks(): Promise<Stock[]> {
  return listStocksRepository();
}

export async function ensureStockExists(
  ticker: string,
  metadata?: StockMetadataInput,
): Promise<Stock> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  return upsertStockByTicker({
    ticker: normalizedTicker,
    ...metadata,
  });
}

export async function updateStockMetadata(
  ticker: string,
  metadata: StockMetadataInput,
): Promise<Stock> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  return ensureStockExists(normalizedTicker, metadata);
}

/**
 * Builds a single stock research bundle from local persisted data only.
 */
export async function getStockResearchBundle(
  ticker: string,
): Promise<TickerDashboardSummary | null> {
  const stock = await getStockProfile(ticker);
  if (!stock) {
    return null;
  }

  const [
    latestPriceSnapshot,
    latestTechnicalSnapshot,
    latestFundamentalSnapshot,
    recentNews,
    nextEarningsEvent,
    latestAIReport,
  ] = await Promise.all([
    getLatestPriceSnapshot(stock.id),
    getLatestTechnicalSnapshot(stock.id),
    getLatestFundamentalSnapshot(stock.id),
    listRecentNewsByTicker(stock.ticker, 20),
    getNextEarningsEvent(stock.id),
    getLatestAIReportByStockId(stock.id),
  ]);

  return {
    stock,
    latestPriceSnapshot,
    latestTechnicalSnapshot,
    latestFundamentalSnapshot,
    recentNews,
    nextEarningsEvent,
    latestAIReport,
  };
}
