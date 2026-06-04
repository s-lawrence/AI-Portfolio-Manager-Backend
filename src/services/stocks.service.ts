import { EarningsEvent, Prisma, Stock } from "@prisma/client";

import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import {
  getNextEarningsEvent,
  listEarningsEventsByStockId,
} from "../repositories/earnings-events.repository";
import { getLatestFundamentalSnapshot } from "../repositories/fundamental-snapshots.repository";
import { listRecentNewsByTicker } from "../repositories/news-articles.repository";
import {
  getLatestMarketSnapshotForStock,
  listPriceSnapshotsByStockId,
} from "../repositories/price-snapshots.repository";
import {
  getStockByTicker,
  listStocks as listStocksRepository,
  searchStocks as searchStocksRepository,
  upsertStockByTicker,
} from "../repositories/stocks.repository";
import { getLatestTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { TickerDashboardSummary } from "../types/services";

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function calculateAnnualizedVolatilityFromCloses(
  closes: number[],
  period: number = 30,
): number | null {
  if (period <= 1) {
    return null;
  }

  const validCloses = closes.filter(isFinitePositiveNumber);
  if (validCloses.length < period + 1) {
    return null;
  }

  const window = validCloses.slice(validCloses.length - (period + 1));
  const dailyReturns: number[] = [];
  let outlierReturnsSkipped = 0;

  const maxAbsDailyLogReturn = 0.5;

  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];

    if (!isFinitePositiveNumber(previous) || !isFinitePositiveNumber(current)) {
      continue;
    }

    const dailyReturn = Math.log(current / previous);
    if (!Number.isFinite(dailyReturn)) {
      continue;
    }

    if (Math.abs(dailyReturn) > maxAbsDailyLogReturn) {
      outlierReturnsSkipped += 1;
      continue;
    }

    dailyReturns.push(dailyReturn);
  }

  if (dailyReturns.length < 2) {
    return null;
  }

  if (outlierReturnsSkipped > 0 && process.env.NODE_ENV !== "production") {
    console.warn(
      `[volatility-warning] Skipped ${outlierReturnsSkipped} outlier daily return(s) for projected research-bundle volatility.`,
    );
  }

  const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (dailyReturns.length - 1);

  if (!Number.isFinite(variance) || variance < 0) {
    return null;
  }

  return Math.sqrt(variance) * Math.sqrt(252);
}

function isUsefulNextEarningsEvent(event: EarningsEvent | null): boolean {
  if (!event || !event.earningsDate) {
    return false;
  }

  return (
    event.fiscalQuarter != null ||
    event.fiscalYear != null ||
    event.estimatedEps != null ||
    event.estimatedRevenue != null ||
    event.reportedEps != null ||
    event.reportedRevenue != null ||
    event.isDateConfirmed
  );
}

function pickNextUsefulEarningsEvent(events: EarningsEvent[]): EarningsEvent | null {
  const now = Date.now();

  for (const event of events) {
    const earningsTime = event.earningsDate?.getTime();
    if (earningsTime == null || earningsTime < now) {
      continue;
    }

    if (isUsefulNextEarningsEvent(event)) {
      return event;
    }
  }

  return null;
}

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
    nextEarningsEventRaw,
    earningsEvents,
    latestAIReport,
    priceHistory,
  ] = await Promise.all([
    getLatestMarketSnapshotForStock(stock.id),
    getLatestTechnicalSnapshot(stock.id),
    getLatestFundamentalSnapshot(stock.id),
    listRecentNewsByTicker(stock.ticker, 20),
    getNextEarningsEvent(stock.id),
    listEarningsEventsByStockId(stock.id),
    getLatestAIReportByStockId(stock.id),
    listPriceSnapshotsByStockId(stock.id, 300),
  ]);

  const closes = [...priceHistory]
    .sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime())
    .map((snapshot) => snapshot.close ?? snapshot.price)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  const projectedVolatility = calculateAnnualizedVolatilityFromCloses(closes, 30);

  if (
    projectedVolatility != null &&
    projectedVolatility > 2 &&
    process.env.NODE_ENV !== "production"
  ) {
    console.warn(
      `[volatility-warning] ${stock.ticker} projected volatility is high: ${projectedVolatility.toFixed(4)}`,
    );
  }

  const technicalSnapshot = latestTechnicalSnapshot
    ? {
        ...latestTechnicalSnapshot,
        ma50: latestTechnicalSnapshot.sma50,
        ma200: latestTechnicalSnapshot.sma200,
        rsi: latestTechnicalSnapshot.rsi14,
        volatility: projectedVolatility,
      }
    : null;

  const nextEarningsEvent = isUsefulNextEarningsEvent(nextEarningsEventRaw)
    ? nextEarningsEventRaw
    : pickNextUsefulEarningsEvent(earningsEvents);

  return {
    stock,
    latestPriceSnapshot,
    latestTechnicalSnapshot: technicalSnapshot,
    latestFundamentalSnapshot,
    recentNews,
    nextEarningsEvent,
    latestAIReport,
  };
}
