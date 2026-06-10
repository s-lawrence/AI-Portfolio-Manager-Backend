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
import { getStockByTicker } from "../repositories/stocks.repository";
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
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";
import {
  type RefreshWatchlistResearchDataOptions,
  type RefreshWatchlistResearchDataResult,
  WatchlistDetail,
  WatchlistDetailItem,
  type WatchlistRefreshCategoryResult,
  type WatchlistRefreshPerTickerResult,
  WatchlistResearchBundle,
  WatchlistResearchItemSummary,
} from "../types/services";
import { ensureStockExists } from "./stocks.service";
import { getGeopoliticalSummary } from "./geopolitical-ingestion.service";
import {
  ingestTickerEarnings,
  ingestTickerFundamentals,
  ingestTickerMarketData,
  ingestTickerNews,
} from "./real-data-ingestion.service";
import { ingestTickerAnalystData } from "./analyst-ingestion.service";
import { generateMockTickerReport } from "./ai-reports.service";

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

const DEFAULT_REFRESH_HISTORICAL_LIMIT = 250;
const DEFAULT_REFRESH_NEWS_LIMIT_PER_TICKER = 10;
const DEFAULT_REFRESH_ACTIVE_STATUSES: WatchlistItemStatus[] = [
  WatchlistItemStatus.WATCHING,
  WatchlistItemStatus.RESEARCHING,
  WatchlistItemStatus.CANDIDATE,
];

const COMMAND_WORD_TICKER_BLOCKLIST = new Set([
  "ADD",
  "REMOVE",
  "DELETE",
  "CONFIRM",
  "REFRESH",
  "BUY",
  "SELL",
  "HOLD",
  "WATCH",
  "RANK",
  "COMPARE",
]);

function isBlockedCommandWordTicker(ticker: string): boolean {
  const normalized = ticker.trim().toUpperCase().replace(/[.-]/g, "");
  return COMMAND_WORD_TICKER_BLOCKLIST.has(normalized);
}

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

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function calculateDurationMs(startedAtDate: Date, finishedAtDate: Date): number {
  return Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
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

function toValidDate(value: unknown): Date | null {
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

function collectMissingResearchData(input: {
  latestPriceSnapshot: unknown;
  latestTechnicalSnapshot: unknown;
  latestFundamentalSnapshot: unknown;
  latestAnalystSnapshot: unknown;
  recentAnalystActions: unknown;
  topHeadlines: unknown;
  nextEarningsEvent: unknown;
}): string[] {
  const missing: string[] = [];

  if (!input.latestPriceSnapshot) {
    missing.push("latestPriceSnapshot");
  }

  if (!input.latestTechnicalSnapshot) {
    missing.push("latestTechnicalSnapshot");
  }

  if (!input.latestFundamentalSnapshot) {
    missing.push("latestFundamentalSnapshot");
  }

  const hasAnalystActions = Array.isArray(input.recentAnalystActions) && input.recentAnalystActions.length > 0;
  if (!input.latestAnalystSnapshot && !hasAnalystActions) {
    missing.push("analystContext");
  }

  if (!Array.isArray(input.topHeadlines) || input.topHeadlines.length === 0) {
    missing.push("topHeadlines");
  }

  if (!input.nextEarningsEvent) {
    missing.push("nextEarningsEvent");
  }

  return missing;
}

function resolveLatestResearchUpdatedAt(input: {
  latestPriceSnapshot: { capturedAt?: unknown } | null;
  latestTechnicalSnapshot: { capturedAt?: unknown } | null;
  latestFundamentalSnapshot: { capturedAt?: unknown } | null;
  latestAnalystSnapshot: { capturedAt?: unknown; updatedAt?: unknown } | null;
  latestAIReport: { reportDate?: unknown; updatedAt?: unknown; createdAt?: unknown } | null;
  topHeadlines: Array<{ publishedAt?: unknown }>;
  nextEarningsEvent: { updatedAt?: unknown; createdAt?: unknown; earningsDate?: unknown } | null;
}): Date | null {
  const candidates: Date[] = [];

  const pushDate = (value: unknown): void => {
    const parsed = toValidDate(value);
    if (parsed) {
      candidates.push(parsed);
    }
  };

  pushDate(input.latestPriceSnapshot?.capturedAt);
  pushDate(input.latestTechnicalSnapshot?.capturedAt);
  pushDate(input.latestFundamentalSnapshot?.capturedAt);
  pushDate(input.latestAnalystSnapshot?.updatedAt);
  pushDate(input.latestAnalystSnapshot?.capturedAt);
  pushDate(input.latestAIReport?.reportDate);
  pushDate(input.latestAIReport?.updatedAt);
  pushDate(input.latestAIReport?.createdAt);
  pushDate(input.nextEarningsEvent?.updatedAt);
  pushDate(input.nextEarningsEvent?.createdAt);
  pushDate(input.nextEarningsEvent?.earningsDate);

  for (const headline of input.topHeadlines) {
    pushDate(headline.publishedAt);
  }

  if (candidates.length === 0) {
    return null;
  }

  const latestTimestamp = Math.max(...candidates.map((candidate) => candidate.getTime()));
  return new Date(latestTimestamp);
}

function summarizeCategoryResult<T extends { warnings?: string[]; ticker?: string }>(
  result: T,
): WatchlistRefreshCategoryResult {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const summary: Record<string, unknown> = Object.entries(result as Record<string, unknown>).reduce(
    (accumulator, [key, value]) => {
      accumulator[key] = value;
      return accumulator;
    },
    {} as Record<string, unknown>,
  );
  delete summary.warnings;
  delete summary.ticker;

  return {
    attempted: true,
    success: true,
    warnings,
    summary,
  };
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

  if (isBlockedCommandWordTicker(normalizedTicker)) {
    const existingStock = await getStockByTicker(normalizedTicker);
    if (!existingStock) {
      throw new Error(
        `Ticker '${normalizedTicker}' appears to be a command word and cannot be verified as a known stock. Please confirm the intended ticker.`,
      );
    }
  }

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

export type CleanupWatchlistArtifactsResult = {
  watchlistId: string;
  removedCount: number;
  removedItems: Array<{
    itemId: string;
    ticker: string;
    reason: "COMMAND_WORD_TICKER_ADD" | "SMOKE_TEST_TAG" | "SMOKE_WRITE_VERIFICATION_THESIS";
  }>;
  keptCount: number;
};

export async function cleanupWatchlistArtifacts(
  watchlistId: string,
): Promise<CleanupWatchlistArtifactsResult> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const watchlist = await getWatchlistWithItems(normalizedWatchlistId);

  if (!watchlist) {
    throw new Error("Watchlist not found.");
  }

  const removals: CleanupWatchlistArtifactsResult["removedItems"] = [];

  for (const item of watchlist.items) {
    const ticker = item.stock.ticker.trim().toUpperCase();
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const thesis = (item.thesis ?? "").toLowerCase();

    let reason: CleanupWatchlistArtifactsResult["removedItems"][number]["reason"] | null = null;

    if (ticker === "ADD") {
      reason = "COMMAND_WORD_TICKER_ADD";
    } else if (tags.some((tag) => tag.toLowerCase().includes("smoke-test"))) {
      reason = "SMOKE_TEST_TAG";
    } else if (item.source === WatchlistItemSource.AGENT && thesis.includes("smoke write verification")) {
      reason = "SMOKE_WRITE_VERIFICATION_THESIS";
    }

    if (!reason) {
      continue;
    }

    await deleteWatchlistItem(item.id);
    removals.push({
      itemId: item.id,
      ticker,
      reason,
    });
  }

  return {
    watchlistId: normalizedWatchlistId,
    removedCount: removals.length,
    removedItems: removals,
    keptCount: Math.max(0, watchlist.items.length - removals.length),
  };
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
      const missingResearchData = collectMissingResearchData({
        latestPriceSnapshot,
        latestTechnicalSnapshot,
        latestFundamentalSnapshot,
        latestAnalystSnapshot,
        recentAnalystActions,
        topHeadlines,
        nextEarningsEvent,
      });
      const hasResearchData = missingResearchData.length < 6;
      const latestResearchUpdatedAt = resolveLatestResearchUpdatedAt({
        latestPriceSnapshot,
        latestTechnicalSnapshot,
        latestFundamentalSnapshot,
        latestAnalystSnapshot,
        latestAIReport,
        topHeadlines,
        nextEarningsEvent,
      });

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
        latestReportRecommendation: latestAIReport?.recommendation ?? null,
        latestReportSentiment: latestAIReport?.sentiment ?? null,
        latestReportConfidenceScore: latestAIReport?.confidenceScore ?? null,
        latestReportDate: latestAIReport?.reportDate ?? null,
        nextEarningsEvent,
        topHeadlines,
        hasResearchData,
        missingResearchData,
        latestResearchUpdatedAt,
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

export async function refreshWatchlistResearchData(
  watchlistId: string,
  options: RefreshWatchlistResearchDataOptions = {},
): Promise<RefreshWatchlistResearchDataResult> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const startedAtDate = new Date();

  const watchlist = await getWatchlistWithItems(normalizedWatchlistId);
  if (!watchlist) {
    throw new Error("Watchlist not found.");
  }

  const historicalLimit = normalizeListLimit(options.historicalLimit, DEFAULT_REFRESH_HISTORICAL_LIMIT);
  const newsLimitPerTicker = normalizeListLimit(options.newsLimitPerTicker, DEFAULT_REFRESH_NEWS_LIMIT_PER_TICKER);
  const includeMarketData = options.includeMarketData ?? true;
  const includeFundamentals = options.includeFundamentals ?? true;
  const includeEarnings = options.includeEarnings ?? true;
  const includeNews = options.includeNews ?? true;
  const includeAnalystData = options.includeAnalystData ?? true;
  const runReports = options.runReports ?? false;
  const activeStatuses = options.activeStatuses?.length
    ? options.activeStatuses
    : DEFAULT_REFRESH_ACTIVE_STATUSES;
  const activeStatusSet = new Set(activeStatuses);

  const perTickerResults: WatchlistRefreshPerTickerResult[] = [];
  const warnings: string[] = [];
  const plannedTickers: string[] = [];

  let tickersProcessed = 0;
  let tickersFailed = 0;
  let tickersSkipped = 0;

  for (const item of watchlist.items) {
    const rawTicker = item.stock.ticker;

    if (!activeStatusSet.has(item.status)) {
      tickersSkipped += 1;
      perTickerResults.push({
        ticker: rawTicker,
        itemId: item.id,
        status: item.status,
        skipped: true,
        skipReason: `Skipped due to status ${item.status}.`,
        warnings: [],
        failedCategories: [],
      });
      continue;
    }

    tickersProcessed += 1;
    plannedTickers.push(rawTicker);

    if (options.dryRun === true) {
      perTickerResults.push({
        ticker: rawTicker,
        itemId: item.id,
        status: item.status,
        skipped: false,
        warnings: [],
        failedCategories: [],
      });
      continue;
    }

    const perTickerWarnings: string[] = [];
    const perTickerResult: WatchlistRefreshPerTickerResult = {
      ticker: rawTicker,
      itemId: item.id,
      status: item.status,
      skipped: false,
      warnings: [],
      failedCategories: [],
    };

    let normalizedTicker = rawTicker;

    try {
      normalizedTicker = normalizeTickerOrThrow(rawTicker);
      await ensureStockExists(normalizedTicker);
      perTickerResult.ticker = normalizedTicker;
    } catch (error) {
      const reason = toErrorReason(error);
      perTickerWarnings.push(`Ticker validation failed: ${reason}`);
      perTickerResult.failedCategories.push("ticker");
      perTickerResult.warnings = dedupe(perTickerWarnings);
      perTickerResults.push(perTickerResult);
      tickersFailed += 1;
      warnings.push(`${rawTicker}: ${reason}`);
      continue;
    }

    if (includeMarketData) {
      try {
        const marketDataResult = await ingestTickerMarketData(normalizedTicker, {
          historicalLimit,
        });
        perTickerResult.marketData = summarizeCategoryResult(marketDataResult);
        perTickerWarnings.push(...(perTickerResult.marketData.warnings ?? []));
      } catch (error) {
        const reason = toErrorReason(error);
        perTickerResult.marketData = {
          attempted: true,
          success: false,
          warnings: [],
          error: reason,
        };
        perTickerResult.failedCategories.push("marketData");
        perTickerWarnings.push(`Market data refresh failed: ${reason}`);
      }
    }

    if (includeFundamentals) {
      try {
        const fundamentalsResult = await ingestTickerFundamentals(normalizedTicker);
        perTickerResult.fundamentals = summarizeCategoryResult(fundamentalsResult);
        perTickerWarnings.push(...(perTickerResult.fundamentals.warnings ?? []));
      } catch (error) {
        const reason = toErrorReason(error);
        perTickerResult.fundamentals = {
          attempted: true,
          success: false,
          warnings: [],
          error: reason,
        };
        perTickerResult.failedCategories.push("fundamentals");
        perTickerWarnings.push(`Fundamentals refresh failed: ${reason}`);
      }
    }

    if (includeEarnings) {
      try {
        const earningsResult = await ingestTickerEarnings(normalizedTicker);
        perTickerResult.earnings = summarizeCategoryResult(earningsResult);
        perTickerWarnings.push(...(perTickerResult.earnings.warnings ?? []));
      } catch (error) {
        const reason = toErrorReason(error);
        perTickerResult.earnings = {
          attempted: true,
          success: false,
          warnings: [],
          error: reason,
        };
        perTickerResult.failedCategories.push("earnings");
        perTickerWarnings.push(`Earnings refresh failed: ${reason}`);
      }
    }

    if (includeNews) {
      try {
        const newsResult = await ingestTickerNews(normalizedTicker, {
          limit: newsLimitPerTicker,
        });
        perTickerResult.news = summarizeCategoryResult(newsResult);
        perTickerWarnings.push(...(perTickerResult.news.warnings ?? []));
      } catch (error) {
        const reason = toErrorReason(error);
        perTickerResult.news = {
          attempted: true,
          success: false,
          warnings: [],
          error: reason,
        };
        perTickerResult.failedCategories.push("news");
        perTickerWarnings.push(`News refresh failed: ${reason}`);
      }
    }

    if (includeAnalystData) {
      try {
        const analystResult = await ingestTickerAnalystData(normalizedTicker);
        perTickerResult.analystData = summarizeCategoryResult(analystResult);
        perTickerWarnings.push(...(perTickerResult.analystData.warnings ?? []));
      } catch (error) {
        const reason = toErrorReason(error);
        perTickerResult.analystData = {
          attempted: true,
          success: false,
          warnings: [],
          error: reason,
        };
        perTickerResult.failedCategories.push("analystData");
        perTickerWarnings.push(`Analyst refresh failed: ${reason}`);
      }
    }

    if (runReports) {
      try {
        const reportResult = await generateMockTickerReport(normalizedTicker);
        perTickerResult.report = {
          attempted: true,
          success: true,
          warnings: [],
          summary: {
            reportId: reportResult.report.id,
            recommendation: reportResult.report.recommendation,
            sentiment: reportResult.report.sentiment,
            confidenceScore: reportResult.report.confidenceScore,
            reportDate: reportResult.report.reportDate,
            predictionsCreated: reportResult.predictions.length,
          },
        };
      } catch (error) {
        const reason = toErrorReason(error);
        perTickerResult.report = {
          attempted: true,
          success: false,
          warnings: [],
          error: reason,
        };
        perTickerResult.failedCategories.push("report");
        perTickerWarnings.push(`Report generation failed: ${reason}`);
      }
    }

    perTickerResult.warnings = dedupe(perTickerWarnings);
    perTickerResult.failedCategories = dedupe(perTickerResult.failedCategories);
    if (perTickerResult.failedCategories.length > 0) {
      tickersFailed += 1;
    }

    perTickerResults.push(perTickerResult);
    warnings.push(...perTickerResult.warnings.map((warning) => `${normalizedTicker}: ${warning}`));
  }

  const finishedAtDate = new Date();

  return {
    watchlistId: normalizedWatchlistId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    tickersProcessed,
    tickersFailed,
    tickersSkipped,
    plannedTickers: options.dryRun === true ? plannedTickers : undefined,
    perTickerResults,
    warnings: dedupe(warnings),
  };
}

export const createWatchlist = createWatchlistForUser;
export const updateWatchlist = updateWatchlistDetails;
export const deleteWatchlist = deleteWatchlistById;
