import { Prisma, Sentiment } from "@prisma/client";

import { env } from "../config/env";
import {
  fmpEarningsProvider,
  fmpFundamentalsProvider,
  fmpMarketDataProvider,
  fmpNewsProvider,
  fmpProfileProvider,
} from "../providers/fmp";
import {
  ProviderEarningsEvent,
  ProviderFundamentalSnapshot,
  ProviderNewsArticle,
  normalizeProviderTickerOrThrow,
} from "../providers/types";
import {
  IngestPortfolioNewsOptions,
  IngestPortfolioNewsResult,
  PortfolioFmpFullRefreshOptions,
  PortfolioFmpFullRefreshResult,
  IngestPortfolioFullBasicOptions,
  IngestPortfolioFullBasicResult,
  IngestPortfolioFundamentalsResult,
  IngestPortfolioMarketDataOptions,
  IngestPortfolioMarketDataResult,
  IngestTickerFundamentalsResult,
  IngestTickerMarketDataOptions,
  IngestTickerMarketDataResult,
  IngestTickerNewsOptions,
  IngestTickerNewsResult,
  MacroIngestionSectionResult,
  PortfolioEarningsIngestionResult,
  TickerEarningsIngestionResult,
} from "../types/services";
import { normalizeListLimit } from "../types/common";
import {
  createEarningsEvent,
  getNextEarningsEvent,
  listEarningsEventsByStockId,
  updateEarningsEvent,
} from "../repositories/earnings-events.repository";
import {
  getNewsArticleByUrl,
  upsertNewsArticleByUrl,
} from "../repositories/news-articles.repository";
import {
  upsertFundamentalSnapshotForUtcDay,
} from "./fundamentals.service";
import {
  recordPriceSnapshot,
  upsertHistoricalPriceSnapshotForDay,
} from "./market-data.service";
import {
  classifyNewsSentiment,
  estimateMateriality,
} from "./news.service";
import { runPortfolioAnalysis } from "./portfolio-analysis.service";
import { ingestFmpEconomicsDefaultSet } from "./fmp-economics-ingestion.service";
import { ingestDefaultMacroAndFx } from "./macro-ingestion.service";
import { ingestPortfolioAnalystData } from "./analyst-ingestion.service";
import { ingestDefaultGdeltRiskSet } from "./geopolitical-ingestion.service";
import { getPortfolioOverview } from "./portfolios.service";
import {
  StockMetadataInput,
  ensureStockExists,
  getStockProfile,
} from "./stocks.service";
import {
  calculateTechnicalSnapshot,
  recordTechnicalSnapshot,
} from "./technical-analysis.service";

const DEFAULT_HISTORICAL_LIMIT = 250;
const DEFAULT_HISTORICAL_LIMIT_QUICK = 120;
const DEFAULT_NEWS_LIMIT_PER_TICKER_QUICK = 12;
const DEFAULT_NEWS_LIMIT_PER_TICKER_FULL = 20;
const DEFAULT_ECONOMICS_CALENDAR_PAST_DAYS_QUICK = 7;
const DEFAULT_ECONOMICS_CALENDAR_FUTURE_DAYS_QUICK = 30;
const DEFAULT_ECONOMICS_CALENDAR_PAST_DAYS_FULL = 30;
const DEFAULT_ECONOMICS_CALENDAR_FUTURE_DAYS_FULL = 90;
const DEFAULT_FRED_OBSERVATION_LIMIT_QUICK = 120;
const DEFAULT_FRED_OBSERVATION_LIMIT_FULL = 300;
const DEFAULT_BOC_OBSERVATION_LIMIT_QUICK = 120;
const DEFAULT_BOC_OBSERVATION_LIMIT_FULL = 300;
const DEFAULT_GDELT_LOOKBACK_DAYS = 7;
const SECTION_SLOW_LOG_THRESHOLD_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const FUNDAMENTAL_FIELD_NAMES: Array<keyof ProviderFundamentalSnapshot> = [
  "period",
  "fiscalYear",
  "fiscalQuarter",
  "marketCap",
  "peRatio",
  "forwardPeRatio",
  "pegRatio",
  "priceToSales",
  "priceToBook",
  "evToEbitda",
  "eps",
  "revenueGrowth",
  "grossMargin",
  "operatingMargin",
  "netMargin",
  "debtToEquity",
  "currentRatio",
  "freeCashFlow",
  "dividendYield",
  "analystConsensus",
  "source",
];

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
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

function addDurationMetadata<
  T extends {
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
  },
>(
  section: T,
  startedAtDate: Date,
  finishedAtDate: Date,
): T {
  return {
    ...section,
    startedAt: section.startedAt ?? startedAtDate.toISOString(),
    finishedAt: section.finishedAt ?? finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
  };
}

function logSlowSection(
  section: string,
  durationMs: number,
  summary: Record<string, number | string | boolean | undefined>,
): void {
  if (env.NODE_ENV !== "development" || durationMs <= SECTION_SLOW_LOG_THRESHOLD_MS) {
    return;
  }

  const compactSummary = Object.entries(summary).reduce<Record<string, number | string | boolean>>(
    (accumulator, [key, value]) => {
      if (value !== undefined) {
        accumulator[key] = value;
      }

      return accumulator;
    },
    {},
  );

  console.warn(
    `[full-refresh-slow] section=${section} durationMs=${durationMs} summary=${JSON.stringify(compactSummary)}`,
  );
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }

  return normalized;
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return undefined;
  }

  return normalized;
}

function parseOptionalIsoTimestamp(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Date(timestamp);
}

function emptyMacroIngestionSection(
  warning?: string,
): MacroIngestionSectionResult {
  return {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: warning ? [warning] : [],
  };
}

function normalizeHistoricalLimit(limit?: number): number {
  return normalizeListLimit(limit, DEFAULT_HISTORICAL_LIMIT);
}

function normalizeMetadataValue(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toStockMetadata(profile: {
  companyName?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  country?: string;
  currency?: string;
  assetType?: string;
}): StockMetadataInput {
  return {
    companyName: normalizeMetadataValue(profile.companyName),
    exchange: normalizeMetadataValue(profile.exchange),
    sector: normalizeMetadataValue(profile.sector),
    industry: normalizeMetadataValue(profile.industry),
    country: normalizeMetadataValue(profile.country),
    currency: normalizeMetadataValue(profile.currency),
    assetType: normalizeMetadataValue(profile.assetType),
  };
}

function hasStockMetadata(metadata: StockMetadataInput): boolean {
  return Object.values(metadata).some((value) => value !== undefined);
}

function isDuplicateCapturedAtError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function normalizeFiniteNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function toBigIntOrNull(value: number | undefined): bigint | null {
  const normalized = normalizeFiniteNumber(value);
  if (normalized === undefined) {
    return null;
  }

  return BigInt(Math.trunc(normalized));
}

function getPopulatedFundamentalFields(
  snapshot: ProviderFundamentalSnapshot,
): string[] {
  const populated: string[] = [];

  for (const field of FUNDAMENTAL_FIELD_NAMES) {
    const value = snapshot[field];
    if (value !== undefined && value !== null) {
      populated.push(field);
    }
  }

  return populated;
}

function toIsoDate(value: Date | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.toISOString().slice(0, 10);
}

function toIntegerOrNull(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function providerEarningsIdentityKey(event: ProviderEarningsEvent): string {
  const date = toIsoDate(event.earningsDate) ?? "NA";
  const fiscalYear =
    typeof event.fiscalYear === "number" && Number.isFinite(event.fiscalYear)
      ? String(Math.trunc(event.fiscalYear))
      : "NA";
  const fiscalQuarter = normalizeMetadataValue(event.fiscalQuarter) ?? "NA";

  return `${date}|${fiscalYear}|${fiscalQuarter}`;
}

function isSameEventDate(
  left: Date | null | undefined,
  right: Date | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return toIsoDate(left) === toIsoDate(right);
}

function matchesEarningsEvent(
  existing: {
    fiscalQuarter: string | null;
    fiscalYear: number | null;
    earningsDate: Date | null;
  },
  incoming: ProviderEarningsEvent,
): boolean {
  const incomingQuarter = normalizeMetadataValue(incoming.fiscalQuarter) ?? null;
  const existingQuarter = normalizeMetadataValue(existing.fiscalQuarter ?? undefined) ?? null;
  const incomingYear = toIntegerOrNull(incoming.fiscalYear);
  const existingYear = existing.fiscalYear;

  const dateMatch = isSameEventDate(existing.earningsDate, incoming.earningsDate);
  const fiscalMatch =
    incomingQuarter !== null &&
    existingQuarter !== null &&
    incomingYear !== null &&
    existingYear !== null &&
    incomingQuarter === existingQuarter &&
    incomingYear === existingYear;

  return dateMatch || fiscalMatch;
}

function isUsefulIncomingEarningsEvent(event: ProviderEarningsEvent): boolean {
  if (!event.earningsDate) {
    return false;
  }

  return (
    event.estimatedEps !== undefined ||
    event.reportedEps !== undefined ||
    event.estimatedRevenue !== undefined ||
    event.reportedRevenue !== undefined
  );
}

function normalizeSentimentValue(value?: string): Sentiment | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "positive" || normalized === "bullish") {
    return Sentiment.BULLISH;
  }

  if (normalized === "negative" || normalized === "bearish") {
    return Sentiment.BEARISH;
  }

  if (normalized === "mixed") {
    return Sentiment.MIXED;
  }

  if (normalized === "neutral") {
    return Sentiment.NEUTRAL;
  }

  return undefined;
}

function toNewsSentiment(article: ProviderNewsArticle): Sentiment {
  return (
    normalizeSentimentValue(article.sentiment) ??
    classifyNewsSentiment(article.headline, article.summary)
  );
}

function toNewsMateriality(article: ProviderNewsArticle): number {
  const providerScore = normalizeFiniteNumber(article.materialityScore);
  if (providerScore !== undefined) {
    return Math.max(0, Math.min(1, providerScore));
  }

  return estimateMateriality(article.headline, article.summary);
}

export async function ingestTickerMarketData(
  ticker: string,
  options: IngestTickerMarketDataOptions = {},
): Promise<IngestTickerMarketDataResult> {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const warnings: string[] = [];
  const historicalLimit = normalizeHistoricalLimit(options.historicalLimit);

  const profile = await fmpProfileProvider.getCompanyProfile(normalizedTicker);
  const metadata = profile ? toStockMetadata(profile) : {};
  const profileUpdated = profile != null && hasStockMetadata(metadata);

  await ensureStockExists(normalizedTicker, profileUpdated ? metadata : undefined);

  if (!profile) {
    warnings.push(`No company profile found for ticker ${normalizedTicker}.`);
  }

  const quote = await fmpMarketDataProvider.getQuote(normalizedTicker);
  const quotePrice = normalizeFiniteNumber(quote.price);

  if (quotePrice === undefined) {
    throw new Error(`Quote response for ${normalizedTicker} did not include a valid price.`);
  }

  await recordPriceSnapshot(normalizedTicker, {
    source: "FMP_QUOTE",
    price: quotePrice,
    open: normalizeFiniteNumber(quote.open),
    high: normalizeFiniteNumber(quote.high),
    low: normalizeFiniteNumber(quote.low),
    close: normalizeFiniteNumber(quote.close) ?? quotePrice,
    previousClose: normalizeFiniteNumber(quote.previousClose),
    volume: normalizeFiniteNumber(quote.volume),
    marketCap: normalizeFiniteNumber(quote.marketCap),
    changePercent: normalizeFiniteNumber(quote.changePercent),
    capturedAt: new Date(),
  });

  const historicalPrices = await fmpMarketDataProvider.getHistoricalDailyPrices(
    normalizedTicker,
    { limit: historicalLimit },
  );

  if (historicalPrices.length === 0) {
    warnings.push(`No historical daily prices returned for ticker ${normalizedTicker}.`);
  }

  let historicalSnapshotsCreated = 0;
  let historicalSnapshotsUpdated = 0;
  let historicalSnapshotsSkipped = 0;
  let previousClose: number | undefined;

  for (const historical of historicalPrices) {
    const resolvedClose =
      normalizeFiniteNumber(historical.close) ??
      normalizeFiniteNumber(historical.adjustedClose);

    if (resolvedClose === undefined) {
      historicalSnapshotsSkipped += 1;
      continue;
    }

    const historicalUpsert = await upsertHistoricalPriceSnapshotForDay(
      normalizedTicker,
      {
        source: "FMP_HISTORICAL",
        price: resolvedClose,
        open: normalizeFiniteNumber(historical.open),
        high: normalizeFiniteNumber(historical.high),
        low: normalizeFiniteNumber(historical.low),
        close: normalizeFiniteNumber(historical.close) ?? resolvedClose,
        previousClose,
        volume: normalizeFiniteNumber(historical.volume),
        capturedAt: new Date(historical.date.getTime()),
      },
      {
        cleanupLegacyDuplicates: true,
      },
    );

    if (historicalUpsert.created) {
      historicalSnapshotsCreated += 1;
    } else if (historicalUpsert.updated) {
      historicalSnapshotsUpdated += 1;
    } else if (historicalUpsert.skipped) {
      historicalSnapshotsSkipped += 1;
    }

    previousClose = resolvedClose;
  }

  const technicalInput = await calculateTechnicalSnapshot(normalizedTicker);

  let technicalSnapshotCreated = false;
  if (technicalInput) {
    await recordTechnicalSnapshot(normalizedTicker, technicalInput);
    technicalSnapshotCreated = true;

    if (technicalInput.sma50 == null) {
      warnings.push(
        `Technical snapshot for ${normalizedTicker} is missing SMA50 (insufficient close history).`,
      );
    }

    if (technicalInput.sma200 == null) {
      warnings.push(
        `Technical snapshot for ${normalizedTicker} is missing SMA200 (insufficient close history).`,
      );
    }

    if (technicalInput.rsi14 == null) {
      warnings.push(
        `Technical snapshot for ${normalizedTicker} is missing RSI14 (insufficient close history).`,
      );
    }

    if (technicalInput.macd == null || technicalInput.macdSignal == null) {
      warnings.push(
        `Technical snapshot for ${normalizedTicker} is missing MACD components (insufficient close history).`,
      );
    }

    if (technicalInput.volatility == null) {
      warnings.push(
        `Technical projection for ${normalizedTicker} is missing annualized volatility (insufficient close history).`,
      );
    } else if (technicalInput.volatility > 2) {
      warnings.push(
        `Technical projection for ${normalizedTicker} returned unusually high annualized volatility (${technicalInput.volatility.toFixed(4)}).`,
      );
    }
  } else {
    warnings.push(
      `Technical snapshot was not created for ${normalizedTicker} due to insufficient price history.`,
    );
  }

  return {
    ticker: normalizedTicker,
    profileUpdated,
    quoteSnapshotCreated: true,
    historicalSnapshotsCreated,
    historicalSnapshotsUpdated,
    historicalSnapshotsSkipped,
    technicalSnapshotCreated,
    warnings,
  };
}

export async function ingestTickerFundamentals(
  ticker: string,
): Promise<IngestTickerFundamentalsResult> {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const warnings: string[] = [];

  await ensureStockExists(normalizedTicker);

  const fundamentals = await fmpFundamentalsProvider.getFundamentals(normalizedTicker);
  if (!fundamentals) {
    warnings.push(`No fundamentals data returned for ticker ${normalizedTicker}.`);

    return {
      ticker: normalizedTicker,
      snapshotCreated: false,
      snapshotUpdated: false,
      snapshotSkipped: true,
      fieldsPopulated: [],
      warnings,
    };
  }

  const fieldsPopulated = getPopulatedFundamentalFields(fundamentals);

  const now = new Date();

  try {
    const upsertResult = await upsertFundamentalSnapshotForUtcDay(normalizedTicker, {
      capturedAt: now,
      source: normalizeMetadataValue(fundamentals.source) ?? "FMP",
      marketCap: toBigIntOrNull(fundamentals.marketCap),
      peRatio: normalizeFiniteNumber(fundamentals.peRatio) ?? null,
      forwardPeRatio: normalizeFiniteNumber(fundamentals.forwardPeRatio) ?? null,
      pegRatio: normalizeFiniteNumber(fundamentals.pegRatio) ?? null,
      priceToSales: normalizeFiniteNumber(fundamentals.priceToSales) ?? null,
      priceToBook: normalizeFiniteNumber(fundamentals.priceToBook) ?? null,
      evToEbitda: normalizeFiniteNumber(fundamentals.evToEbitda) ?? null,
      eps: normalizeFiniteNumber(fundamentals.eps) ?? null,
      revenueGrowth: normalizeFiniteNumber(fundamentals.revenueGrowth) ?? null,
      grossMargin: normalizeFiniteNumber(fundamentals.grossMargin) ?? null,
      operatingMargin: normalizeFiniteNumber(fundamentals.operatingMargin) ?? null,
      netMargin: normalizeFiniteNumber(fundamentals.netMargin) ?? null,
      debtToEquity: normalizeFiniteNumber(fundamentals.debtToEquity) ?? null,
      currentRatio: normalizeFiniteNumber(fundamentals.currentRatio) ?? null,
      freeCashFlow: toBigIntOrNull(fundamentals.freeCashFlow),
      dividendYield: normalizeFiniteNumber(fundamentals.dividendYield) ?? null,
      analystConsensus: normalizeMetadataValue(fundamentals.analystConsensus) ?? null,
    });

    return {
      ticker: normalizedTicker,
      snapshotCreated: upsertResult.created,
      snapshotUpdated: upsertResult.updated,
      snapshotSkipped: false,
      fieldsPopulated,
      warnings,
    };
  } catch (error) {
    if (isDuplicateCapturedAtError(error)) {
      const upsertResult = await upsertFundamentalSnapshotForUtcDay(normalizedTicker, {
        capturedAt: now,
        source: normalizeMetadataValue(fundamentals.source) ?? "FMP",
        marketCap: toBigIntOrNull(fundamentals.marketCap),
        peRatio: normalizeFiniteNumber(fundamentals.peRatio) ?? null,
        forwardPeRatio: normalizeFiniteNumber(fundamentals.forwardPeRatio) ?? null,
        pegRatio: normalizeFiniteNumber(fundamentals.pegRatio) ?? null,
        priceToSales: normalizeFiniteNumber(fundamentals.priceToSales) ?? null,
        priceToBook: normalizeFiniteNumber(fundamentals.priceToBook) ?? null,
        evToEbitda: normalizeFiniteNumber(fundamentals.evToEbitda) ?? null,
        eps: normalizeFiniteNumber(fundamentals.eps) ?? null,
        revenueGrowth: normalizeFiniteNumber(fundamentals.revenueGrowth) ?? null,
        grossMargin: normalizeFiniteNumber(fundamentals.grossMargin) ?? null,
        operatingMargin: normalizeFiniteNumber(fundamentals.operatingMargin) ?? null,
        netMargin: normalizeFiniteNumber(fundamentals.netMargin) ?? null,
        debtToEquity: normalizeFiniteNumber(fundamentals.debtToEquity) ?? null,
        currentRatio: normalizeFiniteNumber(fundamentals.currentRatio) ?? null,
        freeCashFlow: toBigIntOrNull(fundamentals.freeCashFlow),
        dividendYield: normalizeFiniteNumber(fundamentals.dividendYield) ?? null,
        analystConsensus: normalizeMetadataValue(fundamentals.analystConsensus) ?? null,
      });

      return {
        ticker: normalizedTicker,
        snapshotCreated: upsertResult.created,
        snapshotUpdated: upsertResult.updated,
        snapshotSkipped: false,
        fieldsPopulated,
        warnings,
      };
    }

    throw error;
  }
}

export async function ingestPortfolioFundamentals(
  portfolioId: string,
): Promise<IngestPortfolioFundamentalsResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const overview = await getPortfolioOverview(normalizedPortfolioId);
  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const results: IngestTickerFundamentalsResult[] = [];
  const failedTickers: IngestPortfolioFundamentalsResult["failedTickers"] = [];

  for (const holding of overview.holdings) {
    const ticker = holding.stock.ticker;

    try {
      const result = await ingestTickerFundamentals(ticker);
      results.push(result);
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: toErrorReason(error),
      });
    }
  }

  const finishedAtDate = new Date();

  const snapshotsCreated = results.reduce(
    (count, result) => count + (result.snapshotCreated ? 1 : 0),
    0,
  );

  const snapshotsUpdated = results.reduce(
    (count, result) => count + (result.snapshotUpdated ? 1 : 0),
    0,
  );

  const snapshotsSkipped = results.reduce(
    (count, result) => count + (result.snapshotSkipped ? 1 : 0),
    0,
  );

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    tickersProcessed: overview.holdings.length,
    tickersFailed: failedTickers.length,
    snapshotsCreated,
    snapshotsUpdated,
    snapshotsSkipped,
    results,
    failedTickers,
  };
}

export async function ingestTickerEarnings(
  ticker: string,
): Promise<TickerEarningsIngestionResult> {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const warnings: string[] = [];

  await ensureStockExists(normalizedTicker);

  const stock = await getStockProfile(normalizedTicker);
  if (!stock) {
    throw new Error(`Unable to resolve stock for ticker ${normalizedTicker}.`);
  }

  const [nextEarnings, earningsHistory, existingEvents] = await Promise.all([
    fmpEarningsProvider.getNextEarnings(normalizedTicker),
    fmpEarningsProvider.getEarningsHistory(normalizedTicker, { limit: 16 }),
    listEarningsEventsByStockId(stock.id),
  ]);

  const mergedIncoming = new Map<string, ProviderEarningsEvent>();

  if (nextEarnings && isUsefulIncomingEarningsEvent(nextEarnings)) {
    mergedIncoming.set(providerEarningsIdentityKey(nextEarnings), nextEarnings);
  }

  for (const event of earningsHistory) {
    if (!isUsefulIncomingEarningsEvent(event)) {
      continue;
    }

    mergedIncoming.set(providerEarningsIdentityKey(event), event);
  }

  if (mergedIncoming.size === 0) {
    warnings.push(`No earnings events returned for ticker ${normalizedTicker}.`);
  }

  let eventsCreated = 0;
  let eventsUpdated = 0;

  for (const incoming of mergedIncoming.values()) {
    const matchingExisting = existingEvents.find((event) =>
      matchesEarningsEvent(event, incoming),
    );

    const payload = {
      fiscalQuarter: normalizeMetadataValue(incoming.fiscalQuarter) ?? null,
      fiscalYear: toIntegerOrNull(incoming.fiscalYear),
      earningsDate: incoming.earningsDate ?? null,
      earningsTime: normalizeMetadataValue(incoming.earningsTime) ?? null,
      isDateConfirmed: incoming.isDateConfirmed ?? false,
      estimatedEps: normalizeFiniteNumber(incoming.estimatedEps) ?? null,
      reportedEps: normalizeFiniteNumber(incoming.reportedEps) ?? null,
      epsSurprise: normalizeFiniteNumber(incoming.epsSurprise) ?? null,
      estimatedRevenue: toBigIntOrNull(incoming.estimatedRevenue),
      reportedRevenue: toBigIntOrNull(incoming.reportedRevenue),
      revenueSurprise: normalizeFiniteNumber(incoming.revenueSurprise) ?? null,
      guidanceSummary: normalizeMetadataValue(incoming.guidanceSummary) ?? null,
      earningsCallUrl: normalizeMetadataValue(incoming.earningsCallUrl) ?? null,
      transcriptUrl: normalizeMetadataValue(incoming.transcriptUrl) ?? null,
    };

    if (matchingExisting) {
      await updateEarningsEvent(matchingExisting.id, payload);
      eventsUpdated += 1;
      continue;
    }

    await createEarningsEvent({
      stockId: stock.id,
      ...payload,
    });
    eventsCreated += 1;
  }

  const nextPersisted = await getNextEarningsEvent(stock.id);

  return {
    ticker: normalizedTicker,
    eventsCreated,
    eventsUpdated,
    nextEarningsDate: nextPersisted?.earningsDate?.toISOString(),
    warnings,
  };
}

export async function ingestPortfolioEarnings(
  portfolioId: string,
): Promise<PortfolioEarningsIngestionResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const overview = await getPortfolioOverview(normalizedPortfolioId);
  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const results: TickerEarningsIngestionResult[] = [];
  const failedTickers: PortfolioEarningsIngestionResult["failedTickers"] = [];

  for (const holding of overview.holdings) {
    const ticker = holding.stock.ticker;

    try {
      const result = await ingestTickerEarnings(ticker);
      results.push(result);
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: toErrorReason(error),
      });
    }
  }

  const finishedAtDate = new Date();

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    tickersProcessed: overview.holdings.length,
    tickersFailed: failedTickers.length,
    results,
    failedTickers,
  };
}

export async function ingestTickerNews(
  ticker: string,
  options: IngestTickerNewsOptions = {},
): Promise<IngestTickerNewsResult> {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const warnings: string[] = [];

  await ensureStockExists(normalizedTicker);
  const stock = await getStockProfile(normalizedTicker);
  if (!stock) {
    throw new Error(`Unable to resolve stock for ticker ${normalizedTicker}.`);
  }

  const news = await fmpNewsProvider.getCompanyNews(normalizedTicker, {
    from: options.from,
    to: options.to,
    limit: options.limit,
  });

  if (news.length === 0) {
    warnings.push(`No news articles returned for ticker ${normalizedTicker}.`);
  }

  let articlesCreated = 0;
  let articlesUpdated = 0;
  let articlesSkipped = 0;

  for (const article of news) {
    if (!article.url.trim()) {
      articlesSkipped += 1;
      continue;
    }

    const existing = await getNewsArticleByUrl(article.url);

    await upsertNewsArticleByUrl({
      stockId: stock.id,
      headline: article.headline,
      source: normalizeMetadataValue(article.source) ?? null,
      author: normalizeMetadataValue(article.author) ?? null,
      url: article.url,
      publishedAt: article.publishedAt,
      summary: normalizeMetadataValue(article.summary) ?? null,
      rawExcerpt: normalizeMetadataValue(article.rawExcerpt) ?? null,
      sentiment: toNewsSentiment(article),
      sentimentScore: normalizeFiniteNumber(article.sentimentScore) ?? null,
      materialityScore: toNewsMateriality(article),
      relevanceExplanation: normalizeMetadataValue(article.relevanceExplanation) ?? null,
    });

    if (existing) {
      articlesUpdated += 1;
    } else {
      articlesCreated += 1;
    }
  }

  return {
    ticker: normalizedTicker,
    articlesCreated,
    articlesUpdated,
    articlesSkipped,
    warnings,
  };
}

export async function ingestPortfolioNews(
  portfolioId: string,
  options: IngestPortfolioNewsOptions = {},
): Promise<IngestPortfolioNewsResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const overview = await getPortfolioOverview(normalizedPortfolioId);
  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const results: IngestTickerNewsResult[] = [];
  const failedTickers: IngestPortfolioNewsResult["failedTickers"] = [];

  for (const holding of overview.holdings) {
    const ticker = holding.stock.ticker;

    try {
      const result = await ingestTickerNews(ticker, {
        limit: options.limitPerTicker,
      });

      results.push(result);
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: toErrorReason(error),
      });
    }
  }

  const finishedAtDate = new Date();

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    tickersProcessed: overview.holdings.length,
    tickersFailed: failedTickers.length,
    results,
    failedTickers,
  };
}

export async function ingestPortfolioMarketData(
  portfolioId: string,
  options: IngestPortfolioMarketDataOptions = {},
): Promise<IngestPortfolioMarketDataResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const overview = await getPortfolioOverview(normalizedPortfolioId);
  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const results: IngestTickerMarketDataResult[] = [];
  const failedTickers: IngestPortfolioMarketDataResult["failedTickers"] = [];

  for (const holding of overview.holdings) {
    const ticker = holding.stock.ticker;

    try {
      const result = await ingestTickerMarketData(ticker, {
        historicalLimit: options.historicalLimit,
      });

      results.push(result);
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: toErrorReason(error),
      });
    }
  }

  let analysis: IngestPortfolioMarketDataResult["analysis"];

  if (options.runAnalysis) {
    analysis = await runPortfolioAnalysis(normalizedPortfolioId);
  }

  const finishedAtDate = new Date();

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    tickersProcessed: overview.holdings.length,
    tickersFailed: failedTickers.length,
    results,
    failedTickers,
    analysis,
  };
}

export async function ingestPortfolioFullBasic(
  portfolioId: string,
  options: IngestPortfolioFullBasicOptions = {},
): Promise<IngestPortfolioFullBasicResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const marketData = await ingestPortfolioMarketData(normalizedPortfolioId, {
    historicalLimit: options.historicalLimit,
    runAnalysis: false,
  });

  const fundamentals = await ingestPortfolioFundamentals(normalizedPortfolioId);

  let analysis: IngestPortfolioFullBasicResult["analysis"];
  if (options.runAnalysis) {
    analysis = await runPortfolioAnalysis(normalizedPortfolioId);
  }

  const finishedAtDate = new Date();

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    marketData,
    fundamentals,
    analysis,
  };
}

export async function ingestPortfolioFmpFullRefresh(
  portfolioId: string,
  options: PortfolioFmpFullRefreshOptions = {},
): Promise<PortfolioFmpFullRefreshResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const refreshMode = options.refreshMode ?? "quick";
  const includeAnalystData = options.includeAnalystData === true;
  const includeGdelt = options.includeGdelt === true;
  const includeEconomics = options.includeEconomics === true;
  const includeBankOfCanada = options.includeBankOfCanada === true;
  const includeFred = options.includeFred === true;

  const historicalLimit =
    options.historicalLimit ??
    (refreshMode === "full" ? DEFAULT_HISTORICAL_LIMIT : DEFAULT_HISTORICAL_LIMIT_QUICK);
  const newsLimitPerTicker =
    options.newsLimitPerTicker ??
    (refreshMode === "full"
      ? DEFAULT_NEWS_LIMIT_PER_TICKER_FULL
      : DEFAULT_NEWS_LIMIT_PER_TICKER_QUICK);

  const economicsCalendarPastDays = normalizePositiveInteger(
    options.economicsCalendarPastDays,
    refreshMode === "full"
      ? DEFAULT_ECONOMICS_CALENDAR_PAST_DAYS_FULL
      : DEFAULT_ECONOMICS_CALENDAR_PAST_DAYS_QUICK,
  );
  const economicsCalendarFutureDays = normalizePositiveInteger(
    options.economicsCalendarFutureDays,
    refreshMode === "full"
      ? DEFAULT_ECONOMICS_CALENDAR_FUTURE_DAYS_FULL
      : DEFAULT_ECONOMICS_CALENDAR_FUTURE_DAYS_QUICK,
  );

  const fredObservationLimit = normalizePositiveInteger(
    options.fredObservationLimit,
    refreshMode === "full"
      ? DEFAULT_FRED_OBSERVATION_LIMIT_FULL
      : DEFAULT_FRED_OBSERVATION_LIMIT_QUICK,
  );
  const bocObservationLimit = normalizePositiveInteger(
    options.bocObservationLimit,
    refreshMode === "full"
      ? DEFAULT_BOC_OBSERVATION_LIMIT_FULL
      : DEFAULT_BOC_OBSERVATION_LIMIT_QUICK,
  );
  const macroMaxSeries = normalizeOptionalPositiveInteger(options.macroMaxSeries);
  const gdeltLookbackDays = normalizePositiveInteger(
    options.gdeltLookbackDays,
    DEFAULT_GDELT_LOOKBACK_DAYS,
  );

  const marketDataStartedAt = new Date();
  const marketData = addDurationMetadata(
    await ingestPortfolioMarketData(normalizedPortfolioId, {
      historicalLimit,
      runAnalysis: false,
    }),
    marketDataStartedAt,
    new Date(),
  );
  logSlowSection("marketData", marketData.durationMs ?? 0, {
    tickersProcessed: marketData.tickersProcessed,
    tickersFailed: marketData.tickersFailed,
  });

  const fundamentalsStartedAt = new Date();
  const fundamentals = addDurationMetadata(
    await ingestPortfolioFundamentals(normalizedPortfolioId),
    fundamentalsStartedAt,
    new Date(),
  );
  logSlowSection("fundamentals", fundamentals.durationMs ?? 0, {
    tickersProcessed: fundamentals.tickersProcessed,
    tickersFailed: fundamentals.tickersFailed,
    snapshotsCreated: fundamentals.snapshotsCreated,
    snapshotsUpdated: fundamentals.snapshotsUpdated,
    snapshotsSkipped: fundamentals.snapshotsSkipped,
  });

  const earningsStartedAt = new Date();
  const earnings = addDurationMetadata(
    await ingestPortfolioEarnings(normalizedPortfolioId),
    earningsStartedAt,
    new Date(),
  );
  logSlowSection("earnings", earnings.durationMs ?? 0, {
    tickersProcessed: earnings.tickersProcessed,
    tickersFailed: earnings.tickersFailed,
  });

  const newsStartedAt = new Date();
  const news = addDurationMetadata(
    await ingestPortfolioNews(normalizedPortfolioId, {
      limitPerTicker: newsLimitPerTicker,
    }),
    newsStartedAt,
    new Date(),
  );
  logSlowSection("news", news.durationMs ?? 0, {
    tickersProcessed: news.tickersProcessed,
    tickersFailed: news.tickersFailed,
  });

  let analystData: PortfolioFmpFullRefreshResult["analystData"];
  if (includeAnalystData) {
    const analystStartedAt = new Date();

    try {
      analystData = addDurationMetadata(
        await ingestPortfolioAnalystData(normalizedPortfolioId),
        analystStartedAt,
        new Date(),
      );
    } catch (error) {
      analystData = addDurationMetadata(
        {
          portfolioId: normalizedPortfolioId,
          startedAt: analystStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          tickersProcessed: 0,
          tickersFailed: 0,
          snapshotsCreated: 0,
          snapshotsUpdated: 0,
          actionsCreated: 0,
          actionsUpdated: 0,
          results: [],
          failedTickers: [],
          analystWarningsSummary: {
            entitlementIssuesCount: 0,
            noDataCount: 0,
            noRecordsCount: 0,
            affectedTickers: [],
            examples: [],
          },
          rawWarnings: [toErrorReason(error)],
          warnings: [toErrorReason(error)],
        },
        analystStartedAt,
        new Date(),
      );
    }

    logSlowSection("analystData", analystData.durationMs ?? 0, {
      tickersProcessed: analystData.tickersProcessed,
      tickersFailed: analystData.tickersFailed,
      snapshotsCreated: analystData.snapshotsCreated,
      snapshotsUpdated: analystData.snapshotsUpdated,
      actionsCreated: analystData.actionsCreated,
      actionsUpdated: analystData.actionsUpdated,
      warnings: analystData.warnings.length,
    });
  }

  let economics: PortfolioFmpFullRefreshResult["economics"];
  if (includeEconomics) {
    const economicsStartedAt = new Date();

    try {
      const now = new Date();

      economics = addDurationMetadata(
        await ingestFmpEconomicsDefaultSet({
          calendarFrom: new Date(now.getTime() - economicsCalendarPastDays * DAY_MS),
          calendarTo: new Date(now.getTime() + economicsCalendarFutureDays * DAY_MS),
        }),
        economicsStartedAt,
        new Date(),
      );
    } catch (error) {
      economics = addDurationMetadata(
        {
          startedAt: economicsStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          treasuryRates: {
            recordsCreated: 0,
            recordsUpdated: 0,
            recordsSkipped: 0,
            warnings: [],
          },
          economicIndicators: {
            recordsCreated: 0,
            recordsUpdated: 0,
            recordsSkipped: 0,
            warnings: [],
          },
          economicCalendar: {
            recordsCreated: 0,
            recordsUpdated: 0,
            recordsSkipped: 0,
            warnings: [],
          },
          marketRiskPremium: {
            recordsCreated: 0,
            recordsUpdated: 0,
            recordsSkipped: 0,
            warnings: [],
          },
          warnings: [toErrorReason(error)],
        },
        economicsStartedAt,
        new Date(),
      );
    }

    const economicsRecords =
      economics.treasuryRates.recordsCreated +
      economics.treasuryRates.recordsUpdated +
      economics.economicIndicators.recordsCreated +
      economics.economicIndicators.recordsUpdated +
      economics.economicCalendar.recordsCreated +
      economics.economicCalendar.recordsUpdated +
      economics.marketRiskPremium.recordsCreated +
      economics.marketRiskPremium.recordsUpdated;

    logSlowSection("economics", economics.durationMs ?? 0, {
      recordsTouched: economicsRecords,
      warnings: economics.warnings.length,
    });
  }

  let macro: PortfolioFmpFullRefreshResult["macro"];
  let bankOfCanada: PortfolioFmpFullRefreshResult["bankOfCanada"];
  let fred: PortfolioFmpFullRefreshResult["fred"];

  if (includeBankOfCanada || includeFred) {
    const macroStartedAt = new Date();

    try {
      const macroWindowDays = refreshMode === "full" ? 730 : 365;
      const macroWindowTo = new Date();
      const macroWindowFrom = new Date(macroWindowTo.getTime() - macroWindowDays * DAY_MS);

      const macroResult = addDurationMetadata(
        await ingestDefaultMacroAndFx({
          includeBankOfCanada,
          includeFred,
          from: macroWindowFrom,
          to: macroWindowTo,
          bankOfCanadaLimit: bocObservationLimit,
          fredObservationLimit,
          maxFredSeries: macroMaxSeries,
        }),
        macroStartedAt,
        new Date(),
      );

      macro = macroResult;

      if (includeBankOfCanada) {
        const sectionStartedAt = parseOptionalIsoTimestamp(macroResult.bankOfCanada.startedAt) ??
          macroStartedAt;
        const sectionFinishedAt = parseOptionalIsoTimestamp(macroResult.bankOfCanada.finishedAt) ??
          new Date();

        bankOfCanada = addDurationMetadata(
          macroResult.bankOfCanada,
          sectionStartedAt,
          sectionFinishedAt,
        );
      }

      if (includeFred) {
        const sectionStartedAt = parseOptionalIsoTimestamp(macroResult.fred.startedAt) ??
          macroStartedAt;
        const sectionFinishedAt = parseOptionalIsoTimestamp(macroResult.fred.finishedAt) ??
          new Date();

        fred = addDurationMetadata(
          macroResult.fred,
          sectionStartedAt,
          sectionFinishedAt,
        );
      }
    } catch (error) {
      const warning = toErrorReason(error);
      const macroFinishedAt = new Date();

      macro = addDurationMetadata(
        {
          startedAt: macroStartedAt.toISOString(),
          finishedAt: macroFinishedAt.toISOString(),
          bankOfCanada: emptyMacroIngestionSection(),
          fred: emptyMacroIngestionSection(),
          warnings: [warning],
        },
        macroStartedAt,
        macroFinishedAt,
      );

      if (includeBankOfCanada) {
        bankOfCanada = addDurationMetadata(
          emptyMacroIngestionSection(warning),
          macroStartedAt,
          macroFinishedAt,
        );
      }

      if (includeFred) {
        fred = addDurationMetadata(
          emptyMacroIngestionSection(warning),
          macroStartedAt,
          macroFinishedAt,
        );
      }
    }

    if (bankOfCanada) {
      logSlowSection("bankOfCanada", bankOfCanada.durationMs ?? 0, {
        recordsCreated: bankOfCanada.recordsCreated,
        recordsUpdated: bankOfCanada.recordsUpdated,
        recordsSkipped: bankOfCanada.recordsSkipped,
        warnings: bankOfCanada.warnings.length,
      });
    }

    if (fred) {
      logSlowSection("fred", fred.durationMs ?? 0, {
        recordsCreated: fred.recordsCreated,
        recordsUpdated: fred.recordsUpdated,
        recordsSkipped: fred.recordsSkipped,
        warnings: fred.warnings.length,
        failedSeries: fred.failedSeries?.length,
      });
    }

    if (macro) {
      logSlowSection("macro", macro.durationMs ?? 0, {
        warnings: macro.warnings.length,
      });
    }
  }

  let geopolitical: PortfolioFmpFullRefreshResult["geopolitical"];
  if (includeGdelt) {
    const geopoliticalStartedAt = new Date();

    try {
      geopolitical = addDurationMetadata(
        await ingestDefaultGdeltRiskSet({
          from: new Date(Date.now() - gdeltLookbackDays * DAY_MS),
          to: new Date(),
          maxRecordsPerQuery: options.gdeltMaxRecordsPerQuery,
          mode: "quick",
        }),
        geopoliticalStartedAt,
        new Date(),
      );
    } catch (error) {
      geopolitical = addDurationMetadata(
        {
          startedAt: geopoliticalStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          queriesProcessed: 0,
          queriesFailed: 1,
          eventsCreated: 0,
          eventsUpdated: 0,
          eventsSkipped: 0,
          warnings: [toErrorReason(error)],
          failedQueries: [
            {
              query: "DEFAULT_GLOBAL_RISK_SET",
              reason: toErrorReason(error),
            },
          ],
          results: [],
        },
        geopoliticalStartedAt,
        new Date(),
      );
    }

    logSlowSection("geopolitical", geopolitical.durationMs ?? 0, {
      queriesProcessed: geopolitical.queriesProcessed,
      queriesFailed: geopolitical.queriesFailed,
      eventsCreated: geopolitical.eventsCreated,
      eventsUpdated: geopolitical.eventsUpdated,
      eventsSkipped: geopolitical.eventsSkipped,
      warnings: geopolitical.warnings.length,
    });
  }

  let analysis: PortfolioFmpFullRefreshResult["analysis"];
  if (options.runAnalysis) {
    const analysisStartedAt = new Date();
    analysis = addDurationMetadata(
      await runPortfolioAnalysis(normalizedPortfolioId),
      analysisStartedAt,
      new Date(),
    );

    logSlowSection("analysis", analysis.durationMs ?? 0, {
      holdingsAnalyzed: analysis.holdingsAnalyzed,
      reportsCreated: analysis.reportsCreated,
      predictionsCreated: analysis.predictionsCreated,
      failedTickers: analysis.failedTickers.length,
    });
  }

  const warnings: string[] = [];

  if (marketData.tickersFailed > 0) {
    warnings.push(
      `Market-data ingestion had ${marketData.tickersFailed} ticker failure(s).`,
    );
  }

  if (fundamentals.tickersFailed > 0) {
    warnings.push(
      `Fundamentals ingestion had ${fundamentals.tickersFailed} ticker failure(s).`,
    );
  }

  if (earnings.tickersFailed > 0) {
    warnings.push(
      `Earnings ingestion had ${earnings.tickersFailed} ticker failure(s).`,
    );
  }

  if (news.tickersFailed > 0) {
    warnings.push(`News ingestion had ${news.tickersFailed} ticker failure(s).`);
  }

  if (analystData && analystData.tickersFailed > 0) {
    warnings.push(
      `Analyst-data ingestion had ${analystData.tickersFailed} ticker failure(s).`,
    );
  }

  if (analystData && analystData.warnings.length > 0) {
    warnings.push(
      `Analyst-data ingestion completed with ${analystData.warnings.length} warning(s).`,
    );
  }

  if (economics && economics.warnings.length > 0) {
    warnings.push(
      `Economics ingestion completed with ${economics.warnings.length} warning(s).`,
    );
  }

  if (bankOfCanada && bankOfCanada.warnings.length > 0) {
    warnings.push(
      `Bank of Canada macro/FX ingestion completed with ${bankOfCanada.warnings.length} warning(s).`,
    );
  }

  if (fred && fred.warnings.length > 0) {
    warnings.push(
      `FRED macro ingestion completed with ${fred.warnings.length} warning(s).`,
    );
  }

  if (macro && macro.warnings.length > 0) {
    warnings.push(`Macro ingestion completed with ${macro.warnings.length} warning(s).`);
  }

  if (geopolitical && geopolitical.warnings.length > 0) {
    warnings.push(
      `GDELT ingestion completed with ${geopolitical.warnings.length} warning(s).`,
    );
  }

  const finishedAtDate = new Date();
  const durationMs = calculateDurationMs(startedAtDate, finishedAtDate);

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs,
    marketData,
    fundamentals,
    earnings,
    news,
    analystData,
    analystWarningsSummary: analystData?.analystWarningsSummary,
    geopolitical,
    economics,
    bankOfCanada,
    fred,
    macro,
    analysis,
    warnings,
  };
}