import {
  Prisma,
  Sentiment,
  Watchlist,
  WatchlistItem,
  WatchlistItemPriority,
  WatchlistItemSource,
  WatchlistItemStatus,
} from "@prisma/client";

import {
  createWatchlist as createWatchlistRepository,
  deleteWatchlist as deleteWatchlistRepository,
  getWatchlistById,
  getWatchlistWithItems,
  getWatchlistsByUserId,
  updateWatchlist as updateWatchlistRepository,
} from "../repositories/watchlists.repository";
import {
  createWatchlistItem,
  deleteWatchlistItem,
  getWatchlistItemById,
  getWatchlistItemByWatchlistAndStock,
  getWatchlistItemWithStock,
  updateWatchlistItem,
} from "../repositories/watchlist-items.repository";
import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import { listAnalystActionsByStock } from "../repositories/analyst-action-events.repository";
import { getLatestAnalystSnapshot } from "../repositories/analyst-snapshots.repository";
import { getNextEarningsEvent } from "../repositories/earnings-events.repository";
import { getLatestFundamentalSnapshot } from "../repositories/fundamental-snapshots.repository";
import { listRecentDiscovery } from "../repositories/market-discovery-snapshots.repository";
import { listNewsByStockId } from "../repositories/news-articles.repository";
import { getLatestMarketSnapshotForStock } from "../repositories/price-snapshots.repository";
import { getLatestTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { getUserById } from "../repositories/users.repository";
import { normalizeTickerOrThrow } from "../types/common";
import {
  WatchlistDetail,
  WatchlistDetailItem,
  WatchlistResearchBundle,
  WatchlistResearchItemSummary,
} from "../types/services";
import { ensureStockExists } from "./stocks.service";
import { getGeopoliticalSummary } from "./geopolitical-ingestion.service";

export type CreateWatchlistForUserInput = Pick<
  Prisma.WatchlistUncheckedCreateInput,
  "name" | "description" | "isDefault"
>;

export type UpdateWatchlistDetailsInput = Prisma.WatchlistUpdateInput;

export type AddTickerToWatchlistInput = {
  status?: WatchlistItemStatus;
  priority?: WatchlistItemPriority;
  thesis?: string | null;
  riskNotes?: string | null;
  targetEntryPrice?: number | null;
  targetExitPrice?: number | null;
  targetAllocation?: number | null;
  tags?: string[];
  source?: WatchlistItemSource;
  addedReason?: string | null;
  rejectionReason?: string | null;
  convertedHoldingId?: string | null;
  lastReviewedAt?: Date | null;
};

export type UpdateWatchlistItemDetailsInput = Prisma.WatchlistItemUncheckedUpdateInput;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function normalizeName(value: string): string {
  return assertNonBlank(value, "Watchlist name");
}

function toWatchlistDetailItems(
  items: Array<WatchlistDetailItem>,
): WatchlistDetailItem[] {
  return items;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function asNullableDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function asOptionalInteger(value: unknown): number | undefined {
  const numeric = asOptionalFiniteNumber(value);
  return numeric == null ? undefined : Math.trunc(numeric);
}

function asOptionalIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return undefined;
}

function parseAnalystBundleDetails(raw: unknown): Pick<
  WatchlistResearchItemSummary,
  "latestAnnualAnalystEstimate" | "latestQuarterAnalystEstimate" | "fmpFinancialRating"
> {
  const payload = asRecord(raw);
  if (!payload) {
    return {
      latestAnnualAnalystEstimate: null,
      latestQuarterAnalystEstimate: null,
      fmpFinancialRating: null,
    };
  }

  const estimates = asRecord(payload.analystEstimates);
  const latestAnnual = estimates ? asRecord(estimates.latestAnnual) : null;
  const latestQuarter = estimates ? asRecord(estimates.latestQuarter) : null;
  const ratingsSnapshot = asRecord(payload.ratingsSnapshot);

  return {
    latestAnnualAnalystEstimate: latestAnnual
      ? {
          period: "annual",
          date: asOptionalIsoDate(latestAnnual.date) ?? new Date().toISOString(),
          revenueLow: asOptionalFiniteNumber(latestAnnual.revenueLow),
          revenueHigh: asOptionalFiniteNumber(latestAnnual.revenueHigh),
          revenueAvg: asOptionalFiniteNumber(latestAnnual.revenueAvg),
          epsAvg: asOptionalFiniteNumber(latestAnnual.epsAvg),
          epsHigh: asOptionalFiniteNumber(latestAnnual.epsHigh),
          epsLow: asOptionalFiniteNumber(latestAnnual.epsLow),
          numAnalystsRevenue: asOptionalInteger(latestAnnual.numAnalystsRevenue),
          numAnalystsEps: asOptionalInteger(latestAnnual.numAnalystsEps),
        }
      : null,
    latestQuarterAnalystEstimate: latestQuarter
      ? {
          period: "quarter",
          date: asOptionalIsoDate(latestQuarter.date) ?? new Date().toISOString(),
          revenueLow: asOptionalFiniteNumber(latestQuarter.revenueLow),
          revenueHigh: asOptionalFiniteNumber(latestQuarter.revenueHigh),
          revenueAvg: asOptionalFiniteNumber(latestQuarter.revenueAvg),
          epsAvg: asOptionalFiniteNumber(latestQuarter.epsAvg),
          epsHigh: asOptionalFiniteNumber(latestQuarter.epsHigh),
          epsLow: asOptionalFiniteNumber(latestQuarter.epsLow),
          numAnalystsRevenue: asOptionalInteger(latestQuarter.numAnalystsRevenue),
          numAnalystsEps: asOptionalInteger(latestQuarter.numAnalystsEps),
        }
      : null,
    fmpFinancialRating: ratingsSnapshot
      ? {
          rating: typeof ratingsSnapshot.rating === "string" ? ratingsSnapshot.rating : undefined,
          overallScore: asOptionalFiniteNumber(ratingsSnapshot.overallScore),
          discountedCashFlowScore: asOptionalFiniteNumber(ratingsSnapshot.discountedCashFlowScore),
          returnOnEquityScore: asOptionalFiniteNumber(ratingsSnapshot.returnOnEquityScore),
          returnOnAssetsScore: asOptionalFiniteNumber(ratingsSnapshot.returnOnAssetsScore),
          debtToEquityScore: asOptionalFiniteNumber(ratingsSnapshot.debtToEquityScore),
          priceToEarningsScore: asOptionalFiniteNumber(ratingsSnapshot.priceToEarningsScore),
          priceToBookScore: asOptionalFiniteNumber(ratingsSnapshot.priceToBookScore),
          capturedAt: asOptionalIsoDate(ratingsSnapshot.capturedAt),
        }
      : null,
  };
}

// Agent-ready service wrapper candidate for watchlist creation.
export async function createWatchlistForUser(
  userId: string,
  input: CreateWatchlistForUserInput,
): Promise<Watchlist> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  const name = normalizeName(input.name);

  const user = await getUserById(normalizedUserId);
  if (!user) {
    throw new Error("User not found.");
  }

  return createWatchlistRepository({
    userId: normalizedUserId,
    name,
    description: input.description?.trim() || null,
    isDefault: input.isDefault ?? false,
  });
}

export async function listWatchlistsForUser(userId: string): Promise<Watchlist[]> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  return getWatchlistsByUserId(normalizedUserId);
}

export async function getWatchlistDetail(
  watchlistId: string,
): Promise<WatchlistDetail | null> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const watchlist = await getWatchlistWithItems(normalizedWatchlistId);

  if (!watchlist) {
    return null;
  }

  return {
    watchlist: {
      id: watchlist.id,
      userId: watchlist.userId,
      name: watchlist.name,
      description: watchlist.description,
      isDefault: watchlist.isDefault,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt,
    },
    items: toWatchlistDetailItems(watchlist.items),
  };
}

export async function updateWatchlistDetails(
  watchlistId: string,
  input: UpdateWatchlistDetailsInput,
): Promise<Watchlist> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const existing = await getWatchlistById(normalizedWatchlistId);

  if (!existing) {
    throw new Error("Watchlist not found.");
  }

  if (typeof input.name === "string") {
    input.name = normalizeName(input.name);
  }

  if (typeof input.description === "string") {
    input.description = input.description.trim();
  }

  return updateWatchlistRepository(normalizedWatchlistId, input);
}

export async function deleteWatchlistById(watchlistId: string): Promise<Watchlist> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const existing = await getWatchlistById(normalizedWatchlistId);

  if (!existing) {
    throw new Error("Watchlist not found.");
  }

  return deleteWatchlistRepository(normalizedWatchlistId);
}

// Agent-ready service wrapper candidate for watchlist item creation/upsert.
export async function addTickerToWatchlist(
  watchlistId: string,
  ticker: string,
  input: AddTickerToWatchlistInput,
): Promise<WatchlistItem> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const normalizedTicker = normalizeTickerOrThrow(ticker);

  const watchlist = await getWatchlistById(normalizedWatchlistId);
  if (!watchlist) {
    throw new Error("Watchlist not found.");
  }

  const stock = await ensureStockExists(normalizedTicker);
  const existing = await getWatchlistItemByWatchlistAndStock(
    normalizedWatchlistId,
    stock.id,
  );

  if (existing) {
    return updateWatchlistItem(existing.id, {
      status: input.status,
      priority: input.priority,
      thesis: input.thesis,
      riskNotes: input.riskNotes,
      targetEntryPrice: input.targetEntryPrice,
      targetExitPrice: input.targetExitPrice,
      targetAllocation: input.targetAllocation,
      tags: input.tags,
      source: input.source,
      addedReason: input.addedReason,
      rejectionReason: input.rejectionReason,
      convertedHoldingId: input.convertedHoldingId,
      lastReviewedAt: input.lastReviewedAt,
    });
  }

  return createWatchlistItem({
    watchlistId: normalizedWatchlistId,
    stockId: stock.id,
    status: input.status ?? WatchlistItemStatus.WATCHING,
    priority: input.priority ?? WatchlistItemPriority.MEDIUM,
    thesis: input.thesis ?? null,
    riskNotes: input.riskNotes ?? null,
    targetEntryPrice: input.targetEntryPrice ?? null,
    targetExitPrice: input.targetExitPrice ?? null,
    targetAllocation: input.targetAllocation ?? null,
    tags: input.tags ?? [],
    source: input.source ?? WatchlistItemSource.USER,
    addedReason: input.addedReason ?? null,
    rejectionReason: input.rejectionReason ?? null,
    convertedHoldingId: input.convertedHoldingId ?? null,
    lastReviewedAt: input.lastReviewedAt ?? null,
  });
}

// Agent-ready service wrapper candidate for watchlist item updates.
export async function updateWatchlistItemDetails(
  itemId: string,
  input: UpdateWatchlistItemDetailsInput,
): Promise<WatchlistItem> {
  const normalizedItemId = assertNonBlank(itemId, "itemId");
  const existing = await getWatchlistItemById(normalizedItemId);

  if (!existing) {
    throw new Error("Watchlist item not found.");
  }

  return updateWatchlistItem(normalizedItemId, input);
}

export async function removeWatchlistItem(itemId: string): Promise<WatchlistItem> {
  const normalizedItemId = assertNonBlank(itemId, "itemId");
  const existing = await getWatchlistItemById(normalizedItemId);

  if (!existing) {
    throw new Error("Watchlist item not found.");
  }

  return deleteWatchlistItem(normalizedItemId);
}

function sentimentCountsFromNews(news: { sentiment: Sentiment | null }[]): {
  bullish: number;
  neutral: number;
  bearish: number;
  mixed: number;
  unknown: number;
} {
  const counts = {
    bullish: 0,
    neutral: 0,
    bearish: 0,
    mixed: 0,
    unknown: 0,
  };

  for (const article of news) {
    switch (article.sentiment) {
      case Sentiment.BULLISH:
        counts.bullish += 1;
        break;
      case Sentiment.NEUTRAL:
        counts.neutral += 1;
        break;
      case Sentiment.BEARISH:
        counts.bearish += 1;
        break;
      case Sentiment.MIXED:
        counts.mixed += 1;
        break;
      default:
        counts.unknown += 1;
        break;
    }
  }

  return counts;
}

// Agent-ready service wrapper candidate for local-only watchlist research bundle.
export async function getWatchlistResearchBundle(
  watchlistId: string,
): Promise<WatchlistResearchBundle | null> {
  const detail = await getWatchlistDetail(watchlistId);
  if (!detail) {
    return null;
  }

  const items: WatchlistResearchItemSummary[] = await Promise.all(
    detail.items.map(async (item) => {
      const [
        latestPriceSnapshot,
        latestTechnicalSnapshot,
        latestFundamentalSnapshot,
        latestAnalystSnapshot,
        recentAnalystActions,
        recentDiscovery,
        latestAIReport,
        recentNews,
        nextEarningsEvent,
      ] = await Promise.all([
        getLatestMarketSnapshotForStock(item.stockId),
        getLatestTechnicalSnapshot(item.stockId),
        getLatestFundamentalSnapshot(item.stockId),
        getLatestAnalystSnapshot(item.stockId),
        listAnalystActionsByStock(item.stockId, 3),
        item.source === WatchlistItemSource.SCREENER || item.source === WatchlistItemSource.AGENT
          ? listRecentDiscovery(1, { ticker: item.stock.ticker })
          : Promise.resolve([]),
        getLatestAIReportByStockId(item.stockId),
        listNewsByStockId(item.stockId, 20),
        getNextEarningsEvent(item.stockId),
      ]);

      const topHeadlines = recentNews.slice(0, 3);
      const analystBundleDetails = parseAnalystBundleDetails(latestAnalystSnapshot?.raw);

      return {
        itemId: item.id,
        watchlistId: item.watchlistId,
        stockId: item.stockId,
        ticker: item.stock.ticker,
        companyName: item.stock.companyName ?? null,
        exchange: item.stock.exchange ?? null,
        sector: item.stock.sector ?? null,
        industry: item.stock.industry ?? null,
        country: item.stock.country ?? null,
        currency: item.stock.currency ?? null,
        status: item.status,
        priority: item.priority,
        source: item.source,
        thesis: item.thesis ?? null,
        riskNotes: item.riskNotes ?? null,
        tags: asStringArray(item.tags),
        addedReason: item.addedReason ?? null,
        rejectionReason: item.rejectionReason ?? null,
        targetEntryPrice: asNullableNumber(item.targetEntryPrice),
        targetExitPrice: asNullableNumber(item.targetExitPrice),
        targetAllocation: asNullableNumber(item.targetAllocation),
        lastReviewedAt: asNullableDate(item.lastReviewedAt),
        latestPriceSnapshot,
        latestTechnicalSnapshot,
        latestFundamentalSnapshot,
        latestAnalystSnapshot,
        recentAnalystActions,
        latestAnnualAnalystEstimate: analystBundleDetails.latestAnnualAnalystEstimate,
        latestQuarterAnalystEstimate: analystBundleDetails.latestQuarterAnalystEstimate,
        fmpFinancialRating: analystBundleDetails.fmpFinancialRating,
        discoveryContext:
          recentDiscovery[0] != null
            ? {
                category: recentDiscovery[0].category,
                source: recentDiscovery[0].source,
              }
            : null,
        latestAIReport,
        nextEarningsEvent,
        topHeadlines,
        sentimentCounts: sentimentCountsFromNews(recentNews),
      };
    }),
  );

  const geopoliticalSummary = await getGeopoliticalSummary({
    days: 7,
    limit: 100,
  }).catch(() => null);

  return {
    watchlist: detail.watchlist,
    itemCount: items.length,
    geopoliticalSummary: geopoliticalSummary ?? undefined,
    items,
  };
}

export const createWatchlist = createWatchlistForUser;
export const updateWatchlist = updateWatchlistDetails;
export const deleteWatchlist = deleteWatchlistById;
