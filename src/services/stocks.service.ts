import { EarningsEvent, Prisma, Stock } from "@prisma/client";

import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import { env } from "../config/env";
import { fmpClient } from "../providers/fmp";
import { ProviderConfigurationError, ProviderError } from "../providers/errors";
import {
  getNextEarningsEvent,
  listEarningsEventsByStockId,
} from "../repositories/earnings-events.repository";
import {
  getLatestAnalystSnapshot,
} from "../repositories/analyst-snapshots.repository";
import {
  listAnalystActionsByStock,
} from "../repositories/analyst-action-events.repository";
import { getLatestFundamentalSnapshot } from "../repositories/fundamental-snapshots.repository";
import { listRecentNewsByTicker } from "../repositories/news-articles.repository";
import {
  getLatestMarketSnapshotForStock,
  listPriceSnapshotsByStockId,
} from "../repositories/price-snapshots.repository";
import {
  getStockByTicker,
  listStocksByTickers,
  listStocks as listStocksRepository,
  searchStocksByIdentity,
  searchStocks as searchStocksRepository,
  upsertStockByTicker,
} from "../repositories/stocks.repository";
import { getLatestTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { TickerDashboardSummary } from "../types/services";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumberOrUndefined(value: unknown): number | undefined {
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

function toIntegerOrUndefined(value: unknown): number | undefined {
  const numeric = toFiniteNumberOrUndefined(value);
  return numeric == null ? undefined : Math.trunc(numeric);
}

function toDateIsoOrUndefined(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return undefined;
}

function parseAnalystBundleDetails(
  raw: unknown,
): Pick<
  TickerDashboardSummary,
  "latestAnnualAnalystEstimate" | "latestQuarterAnalystEstimate" | "fmpFinancialRating"
> {
  if (!isRecord(raw)) {
    return {
      latestAnnualAnalystEstimate: null,
      latestQuarterAnalystEstimate: null,
      fmpFinancialRating: null,
    };
  }

  const estimates = isRecord(raw.analystEstimates) ? raw.analystEstimates : null;
  const latestAnnual = estimates && isRecord(estimates.latestAnnual) ? estimates.latestAnnual : null;
  const latestQuarter = estimates && isRecord(estimates.latestQuarter) ? estimates.latestQuarter : null;
  const ratingsSnapshot = isRecord(raw.ratingsSnapshot) ? raw.ratingsSnapshot : null;

  return {
    latestAnnualAnalystEstimate: latestAnnual
      ? {
          period: "annual",
          date: toDateIsoOrUndefined(latestAnnual.date) ?? new Date().toISOString(),
          revenueLow: toFiniteNumberOrUndefined(latestAnnual.revenueLow),
          revenueHigh: toFiniteNumberOrUndefined(latestAnnual.revenueHigh),
          revenueAvg: toFiniteNumberOrUndefined(latestAnnual.revenueAvg),
          epsAvg: toFiniteNumberOrUndefined(latestAnnual.epsAvg),
          epsHigh: toFiniteNumberOrUndefined(latestAnnual.epsHigh),
          epsLow: toFiniteNumberOrUndefined(latestAnnual.epsLow),
          numAnalystsRevenue: toIntegerOrUndefined(latestAnnual.numAnalystsRevenue),
          numAnalystsEps: toIntegerOrUndefined(latestAnnual.numAnalystsEps),
        }
      : null,
    latestQuarterAnalystEstimate: latestQuarter
      ? {
          period: "quarter",
          date: toDateIsoOrUndefined(latestQuarter.date) ?? new Date().toISOString(),
          revenueLow: toFiniteNumberOrUndefined(latestQuarter.revenueLow),
          revenueHigh: toFiniteNumberOrUndefined(latestQuarter.revenueHigh),
          revenueAvg: toFiniteNumberOrUndefined(latestQuarter.revenueAvg),
          epsAvg: toFiniteNumberOrUndefined(latestQuarter.epsAvg),
          epsHigh: toFiniteNumberOrUndefined(latestQuarter.epsHigh),
          epsLow: toFiniteNumberOrUndefined(latestQuarter.epsLow),
          numAnalystsRevenue: toIntegerOrUndefined(latestQuarter.numAnalystsRevenue),
          numAnalystsEps: toIntegerOrUndefined(latestQuarter.numAnalystsEps),
        }
      : null,
    fmpFinancialRating: ratingsSnapshot
      ? {
          rating:
            typeof ratingsSnapshot.rating === "string" ? ratingsSnapshot.rating : undefined,
          overallScore: toFiniteNumberOrUndefined(ratingsSnapshot.overallScore),
          discountedCashFlowScore: toFiniteNumberOrUndefined(
            ratingsSnapshot.discountedCashFlowScore,
          ),
          returnOnEquityScore: toFiniteNumberOrUndefined(ratingsSnapshot.returnOnEquityScore),
          returnOnAssetsScore: toFiniteNumberOrUndefined(ratingsSnapshot.returnOnAssetsScore),
          debtToEquityScore: toFiniteNumberOrUndefined(ratingsSnapshot.debtToEquityScore),
          priceToEarningsScore: toFiniteNumberOrUndefined(ratingsSnapshot.priceToEarningsScore),
          priceToBookScore: toFiniteNumberOrUndefined(ratingsSnapshot.priceToBookScore),
          capturedAt: toDateIsoOrUndefined(ratingsSnapshot.capturedAt),
        }
      : null,
  };
}

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

export type StockSearchMatchType = "LOCAL" | "PROVIDER";

export type StockSearchConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface StockSearchCandidate {
  stockId?: string;
  ticker: string;
  companyName?: string;
  exchange?: string;
  currency?: string;
  country?: string;
  provider: string;
  matchType: StockSearchMatchType;
  confidence: StockSearchConfidence;
}

export interface SearchStockCandidatesOptions {
  exchange?: string;
  country?: string;
  limit?: number;
}

interface ProviderSymbolSearchRecord {
  ticker?: string;
  symbol?: string;
  name?: string;
  companyName?: string;
  exchange?: string;
  exchangeShortName?: string;
  currency?: string;
  country?: string;
}

const SHORT_AMBIGUOUS_TICKERS = new Set(["E", "F", "T"]);
const DEFAULT_STOCK_SEARCH_LIMIT = 12;

function hasConfiguredValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalUpper(value: string | undefined): string | undefined {
  return value?.trim().toUpperCase() || undefined;
}

function toProviderSearchQuery(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 0 ? trimmed : query;
}

function isShortAmbiguousTicker(ticker: string): boolean {
  return ticker.length === 1 || SHORT_AMBIGUOUS_TICKERS.has(ticker);
}

function inferStockSearchConfidence(input: {
  queryTicker: string;
  candidateTicker: string;
  candidateMatchType: StockSearchMatchType;
  queryExchange?: string;
  candidateExchange?: string;
  queryCountry?: string;
  candidateCountry?: string;
}): StockSearchConfidence {
  const queryTicker = input.queryTicker;
  const candidateTicker = input.candidateTicker;
  const exactTicker = candidateTicker === queryTicker;
  const shortTicker = isShortAmbiguousTicker(queryTicker);

  if (!exactTicker) {
    return input.candidateMatchType === "LOCAL" ? "MEDIUM" : "LOW";
  }

  const exchangeMatches =
    input.queryExchange != null &&
    input.candidateExchange != null &&
    input.queryExchange === input.candidateExchange;
  const countryMatches =
    input.queryCountry != null &&
    input.candidateCountry != null &&
    input.queryCountry === input.candidateCountry;

  if (!shortTicker) {
    return "HIGH";
  }

  if (exchangeMatches || countryMatches) {
    return "HIGH";
  }

  if (input.queryExchange || input.queryCountry) {
    return "MEDIUM";
  }

  return "LOW";
}

function toLocalCandidate(
  stock: Stock,
  options: {
    queryTicker: string;
    queryExchange?: string;
    queryCountry?: string;
  },
): StockSearchCandidate {
  const candidateExchange = normalizeOptionalUpper(stock.exchange ?? undefined);
  const candidateCountry = normalizeOptionalUpper(stock.country ?? undefined);

  return {
    stockId: stock.id,
    ticker: stock.ticker,
    companyName: stock.companyName ?? undefined,
    exchange: stock.exchange ?? undefined,
    currency: stock.currency ?? undefined,
    country: stock.country ?? undefined,
    provider: "LOCAL_DB",
    matchType: "LOCAL",
    confidence: inferStockSearchConfidence({
      queryTicker: options.queryTicker,
      candidateTicker: stock.ticker,
      candidateMatchType: "LOCAL",
      queryExchange: options.queryExchange,
      candidateExchange,
      queryCountry: options.queryCountry,
      candidateCountry,
    }),
  };
}

async function searchProviderCandidates(
  query: string,
  options: {
    queryTicker: string;
    queryExchange?: string;
    queryCountry?: string;
    limit: number;
  },
): Promise<StockSearchCandidate[]> {
  if (!hasConfiguredValue(env.FMP_API_KEY)) {
    return [];
  }

  let records: ProviderSymbolSearchRecord[] = [];

  try {
    const profileRecord = await fmpClient.getJson<ProviderSymbolSearchRecord[]>("/profile", {
      symbol: options.queryTicker,
    });

    if (Array.isArray(profileRecord)) {
      records = profileRecord;
    }
  } catch (error) {
    if (!(error instanceof ProviderConfigurationError || error instanceof ProviderError)) {
      throw error;
    }
  }

  try {
    const searchRecords = await fmpClient.getJson<ProviderSymbolSearchRecord[]>("/search", {
      query: toProviderSearchQuery(query),
      limit: options.limit,
      exchange: options.queryExchange,
    });

    if (Array.isArray(searchRecords)) {
      records = [...records, ...searchRecords];
    }
  } catch (error) {
    if (!(error instanceof ProviderConfigurationError || error instanceof ProviderError)) {
      throw error;
    }
  }

  const uniqueRecords = new Map<string, ProviderSymbolSearchRecord>();
  for (const record of records) {
    const ticker = normalizeOptionalUpper(asString(record.symbol) ?? asString(record.ticker));
    if (!ticker) {
      continue;
    }

    const dedupeKey = `${ticker}:${normalizeOptionalUpper(asString(record.exchangeShortName) ?? asString(record.exchange)) ?? ""}`;
    if (!uniqueRecords.has(dedupeKey)) {
      uniqueRecords.set(dedupeKey, record);
    }
  }

  const localStocks = await listStocksByTickers(
    [...uniqueRecords.values()]
      .map((record) => normalizeOptionalUpper(asString(record.symbol) ?? asString(record.ticker)))
      .filter((value): value is string => value != null),
  );
  const localByTicker = new Map(localStocks.map((stock) => [stock.ticker, stock]));

  const candidates: StockSearchCandidate[] = [];
  for (const record of uniqueRecords.values()) {
    const ticker = normalizeOptionalUpper(asString(record.symbol) ?? asString(record.ticker));
    if (!ticker) {
      continue;
    }

    const stock = localByTicker.get(ticker);
    const exchange = asString(record.exchangeShortName) ?? asString(record.exchange);
    const country = asString(record.country);
    const exchangeUpper = normalizeOptionalUpper(exchange);
    const countryUpper = normalizeOptionalUpper(country);

    candidates.push({
      stockId: stock?.id,
      ticker,
      companyName: asString(record.name) ?? asString(record.companyName) ?? stock?.companyName ?? undefined,
      exchange: exchange ?? stock?.exchange ?? undefined,
      currency: asString(record.currency) ?? stock?.currency ?? undefined,
      country: country ?? stock?.country ?? undefined,
      provider: "FMP",
      matchType: "PROVIDER",
      confidence: inferStockSearchConfidence({
        queryTicker: options.queryTicker,
        candidateTicker: ticker,
        candidateMatchType: "PROVIDER",
        queryExchange: options.queryExchange,
        candidateExchange: exchangeUpper,
        queryCountry: options.queryCountry,
        candidateCountry: countryUpper,
      }),
    });
  }

  return candidates;
}

export async function searchStockCandidates(
  query: string,
  options: SearchStockCandidatesOptions = {},
): Promise<StockSearchCandidate[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const normalizedQueryTicker = normalizeTickerOrThrow(trimmedQuery);
  const normalizedExchange = normalizeOptionalUpper(options.exchange);
  const normalizedCountry = normalizeOptionalUpper(options.country);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_STOCK_SEARCH_LIMIT, 25));

  const localStocks = await searchStocksByIdentity(trimmedQuery, limit);
  const exactLocalStock = await getStockByTicker(normalizedQueryTicker);
  const resolvedLocalStocks =
    exactLocalStock && !localStocks.some((stock) => stock.id === exactLocalStock.id)
      ? [exactLocalStock, ...localStocks]
      : localStocks;

  const localCandidates = resolvedLocalStocks.map((stock) =>
    toLocalCandidate(stock, {
      queryTicker: normalizedQueryTicker,
      queryExchange: normalizedExchange,
      queryCountry: normalizedCountry,
    }),
  );

  const providerCandidates = await searchProviderCandidates(trimmedQuery, {
    queryTicker: normalizedQueryTicker,
    queryExchange: normalizedExchange,
    queryCountry: normalizedCountry,
    limit,
  });

  const merged = new Map<string, StockSearchCandidate>();

  for (const candidate of [...localCandidates, ...providerCandidates]) {
    const key = `${candidate.ticker}:${normalizeOptionalUpper(candidate.exchange) ?? ""}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, candidate);
      continue;
    }

    const confidenceRank: Record<StockSearchConfidence, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
    };

    if (confidenceRank[candidate.confidence] > confidenceRank[existing.confidence]) {
      merged.set(key, {
        ...existing,
        ...candidate,
      });
      continue;
    }

    if (!existing.stockId && candidate.stockId) {
      merged.set(key, {
        ...existing,
        stockId: candidate.stockId,
      });
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      const leftExactRank = left.ticker === normalizedQueryTicker ? 0 : 1;
      const rightExactRank = right.ticker === normalizedQueryTicker ? 0 : 1;
      const byExactTicker = leftExactRank - rightExactRank;
      if (byExactTicker !== 0) {
        return byExactTicker;
      }

      const confidenceRank: Record<StockSearchConfidence, number> = {
        HIGH: 0,
        MEDIUM: 1,
        LOW: 2,
      };

      const byConfidence = confidenceRank[left.confidence] - confidenceRank[right.confidence];
      if (byConfidence !== 0) {
        return byConfidence;
      }

      if (left.ticker !== right.ticker) {
        return left.ticker.localeCompare(right.ticker);
      }

      return (left.exchange ?? "").localeCompare(right.exchange ?? "");
    })
    .slice(0, limit);
}

export function isAmbiguousTickerSymbol(ticker: string): boolean {
  const normalized = normalizeTickerOrThrow(ticker);
  return isShortAmbiguousTicker(normalized);
}

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
    latestAnalystSnapshot,
    recentAnalystActions,
    recentNews,
    nextEarningsEventRaw,
    earningsEvents,
    latestAIReport,
    priceHistory,
  ] = await Promise.all([
    getLatestMarketSnapshotForStock(stock.id),
    getLatestTechnicalSnapshot(stock.id),
    getLatestFundamentalSnapshot(stock.id),
    getLatestAnalystSnapshot(stock.id),
    listAnalystActionsByStock(stock.id, 20),
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

  const analystBundleDetails = parseAnalystBundleDetails(latestAnalystSnapshot?.raw);

  return {
    stock,
    latestPriceSnapshot,
    latestTechnicalSnapshot: technicalSnapshot,
    latestFundamentalSnapshot,
    latestAnalystSnapshot,
    recentAnalystActions,
    latestAnnualAnalystEstimate: analystBundleDetails.latestAnnualAnalystEstimate,
    latestQuarterAnalystEstimate: analystBundleDetails.latestQuarterAnalystEstimate,
    fmpFinancialRating: analystBundleDetails.fmpFinancialRating,
    recentNews,
    nextEarningsEvent,
    latestAIReport,
  };
}
