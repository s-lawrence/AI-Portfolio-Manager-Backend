import { Prisma } from "@prisma/client";

import {
  fmpFundamentalsProvider,
  fmpMarketDataProvider,
  fmpProfileProvider,
} from "../providers/fmp";
import {
  ProviderFundamentalSnapshot,
  normalizeProviderTickerOrThrow,
} from "../providers/types";
import {
  IngestPortfolioFullBasicOptions,
  IngestPortfolioFullBasicResult,
  IngestPortfolioFundamentalsResult,
  IngestPortfolioMarketDataOptions,
  IngestPortfolioMarketDataResult,
  IngestTickerFundamentalsResult,
  IngestTickerMarketDataOptions,
  IngestTickerMarketDataResult,
} from "../types/services";
import { normalizeListLimit } from "../types/common";
import {
  getLatestFundamentals,
  recordFundamentalSnapshot,
} from "./fundamentals.service";
import { recordPriceSnapshot } from "./market-data.service";
import { runPortfolioAnalysis } from "./portfolio-analysis.service";
import { getPortfolioOverview } from "./portfolios.service";
import {
  StockMetadataInput,
  ensureStockExists,
} from "./stocks.service";
import {
  calculateTechnicalSnapshot,
  recordTechnicalSnapshot,
} from "./technical-analysis.service";

const DEFAULT_HISTORICAL_LIMIT = 250;

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

function isSameUtcCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
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

    try {
      await recordPriceSnapshot(normalizedTicker, {
        price: resolvedClose,
        open: normalizeFiniteNumber(historical.open),
        high: normalizeFiniteNumber(historical.high),
        low: normalizeFiniteNumber(historical.low),
        close: normalizeFiniteNumber(historical.close) ?? resolvedClose,
        previousClose,
        volume: normalizeFiniteNumber(historical.volume),
        capturedAt: new Date(historical.date.getTime()),
      });

      historicalSnapshotsCreated += 1;
    } catch (error) {
      if (isDuplicateCapturedAtError(error)) {
        historicalSnapshotsSkipped += 1;
      } else {
        throw error;
      }
    }

    previousClose = resolvedClose;
  }

  const technicalInput = await calculateTechnicalSnapshot(normalizedTicker);

  let technicalSnapshotCreated = false;
  if (technicalInput) {
    await recordTechnicalSnapshot(normalizedTicker, technicalInput);
    technicalSnapshotCreated = true;
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
      fieldsPopulated: [],
      warnings,
    };
  }

  const fieldsPopulated = getPopulatedFundamentalFields(fundamentals);

  const now = new Date();
  const latestFundamentals = await getLatestFundamentals(normalizedTicker);
  if (latestFundamentals && isSameUtcCalendarDay(latestFundamentals.capturedAt, now)) {
    warnings.push(
      `Skipped fundamentals snapshot for ${normalizedTicker}; a snapshot already exists for today.`,
    );

    return {
      ticker: normalizedTicker,
      snapshotCreated: false,
      fieldsPopulated,
      warnings,
    };
  }

  try {
    await recordFundamentalSnapshot(normalizedTicker, {
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
  } catch (error) {
    if (isDuplicateCapturedAtError(error)) {
      warnings.push(
        `Skipped fundamentals snapshot for ${normalizedTicker}; duplicate timestamp detected.`,
      );

      return {
        ticker: normalizedTicker,
        snapshotCreated: false,
        fieldsPopulated,
        warnings,
      };
    }

    throw error;
  }

  return {
    ticker: normalizedTicker,
    snapshotCreated: true,
    fieldsPopulated,
    warnings,
  };
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

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
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
    marketData,
    fundamentals,
    analysis,
  };
}