import { Prisma } from "@prisma/client";

import { fmpAnalystProvider } from "../providers/fmp";
import { ProviderConfigurationError } from "../providers/errors";
import {
  ProviderAnalystSnapshot,
  normalizeProviderTickerOrThrow,
} from "../providers/types";
import {
  getLatestAnalystSnapshot,
  listAnalystSnapshots,
  upsertAnalystSnapshot,
} from "../repositories/analyst-snapshots.repository";
import {
  listAnalystActionsByStock,
  upsertAnalystActionEvent,
} from "../repositories/analyst-action-events.repository";
import { getWatchlistWithItems } from "../repositories/watchlists.repository";
import {
  IngestPortfolioAnalystDataResult,
  IngestTickerAnalystDataResult,
  IngestWatchlistAnalystDataResult,
} from "../types/services";
import { FmpAnalystTickerAuditResult } from "../providers/fmp/fmp-analyst.provider";
import { normalizeListLimit } from "../types/common";
import { getLatestMarketSnapshotForStock } from "../repositories/price-snapshots.repository";
import { getPortfolioOverview } from "./portfolios.service";
import { ensureStockExists, getStockProfile } from "./stocks.service";

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

function pickFirstNumber(
  values: Array<number | undefined>,
): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function pickFirstString(
  values: Array<string | undefined>,
): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return undefined;
}

function toBigIntOrNull(value: number | undefined): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return BigInt(Math.trunc(value));
}

function mergeSnapshotParts(
  ticker: string,
  summary: ProviderAnalystSnapshot | null,
  consensus: Partial<ProviderAnalystSnapshot> | null,
  ratings: Partial<ProviderAnalystSnapshot> | null,
  latestPrice: number | null,
): ProviderAnalystSnapshot | null {
  const merged: ProviderAnalystSnapshot = {
    ticker,
    capturedAt:
      summary?.capturedAt ??
      consensus?.capturedAt ??
      ratings?.capturedAt ??
      new Date(),
    source: pickFirstString([
      summary?.source,
      consensus?.source,
      ratings?.source,
      "FMP",
    ]),
    priceTargetAverage: pickFirstNumber([
      summary?.priceTargetAverage,
      consensus?.priceTargetAverage,
      ratings?.priceTargetAverage,
    ]),
    priceTargetHigh: pickFirstNumber([
      summary?.priceTargetHigh,
      consensus?.priceTargetHigh,
      ratings?.priceTargetHigh,
    ]),
    priceTargetLow: pickFirstNumber([
      summary?.priceTargetLow,
      consensus?.priceTargetLow,
      ratings?.priceTargetLow,
    ]),
    priceTargetConsensus: pickFirstNumber([
      summary?.priceTargetConsensus,
      consensus?.priceTargetConsensus,
      ratings?.priceTargetConsensus,
    ]),
    analystCount: pickFirstNumber([
      ratings?.analystCount,
      summary?.analystCount,
      consensus?.analystCount,
    ]) as number | undefined,
    ratingConsensus: pickFirstString([
      ratings?.ratingConsensus,
      consensus?.ratingConsensus,
      summary?.ratingConsensus,
    ]),
    strongBuyCount: pickFirstNumber([
      ratings?.strongBuyCount,
      summary?.strongBuyCount,
    ]) as number | undefined,
    buyCount: pickFirstNumber([
      ratings?.buyCount,
      summary?.buyCount,
    ]) as number | undefined,
    holdCount: pickFirstNumber([
      ratings?.holdCount,
      summary?.holdCount,
    ]) as number | undefined,
    sellCount: pickFirstNumber([
      ratings?.sellCount,
      summary?.sellCount,
    ]) as number | undefined,
    strongSellCount: pickFirstNumber([
      ratings?.strongSellCount,
      summary?.strongSellCount,
    ]) as number | undefined,
    upsidePercent: pickFirstNumber([
      summary?.upsidePercent,
      consensus?.upsidePercent,
      ratings?.upsidePercent,
    ]),
    raw: {
      priceTargetSummary: summary?.raw ?? null,
      priceTargetConsensus: consensus?.raw ?? null,
      analystRatings: ratings?.raw ?? null,
    },
  };

  if (
    merged.priceTargetAverage === undefined &&
    merged.priceTargetHigh === undefined &&
    merged.priceTargetLow === undefined &&
    merged.priceTargetConsensus === undefined &&
    merged.analystCount === undefined &&
    merged.ratingConsensus === undefined &&
    merged.strongBuyCount === undefined &&
    merged.buyCount === undefined &&
    merged.holdCount === undefined &&
    merged.sellCount === undefined &&
    merged.strongSellCount === undefined &&
    merged.upsidePercent === undefined
  ) {
    return null;
  }

  if (merged.upsidePercent === undefined && latestPrice != null && latestPrice > 0) {
    const target = pickFirstNumber([
      merged.priceTargetConsensus,
      merged.priceTargetAverage,
      merged.priceTargetHigh,
      merged.priceTargetLow,
    ]);

    if (target !== undefined) {
      merged.upsidePercent = ((target - latestPrice) / latestPrice) * 100;
    }
  }

  return merged;
}

async function safeOptionalCall<T>(
  label: string,
  callback: () => Promise<T>,
): Promise<{
  value: T | null;
  status: IngestTickerAnalystDataResult["priceTargetSummaryStatus"];
  warnings: string[];
}> {
  try {
    const value = await callback();

    if (value == null) {
      return {
        value: null,
        status: "EMPTY",
        warnings: [`${label} returned no data.`],
      };
    }

    if (Array.isArray(value) && value.length === 0) {
      return {
        value,
        status: "EMPTY",
        warnings: [`${label} returned no records.`],
      };
    }

    return {
      value,
      status: "SUCCESS",
      warnings: [],
    };
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      return {
        value: null,
        status: "ENTITLEMENT",
        warnings: [`${label} entitlement/configuration issue: ${toErrorReason(error)}`],
      };
    }

    return {
      value: null,
      status: "ERROR",
      warnings: [`${label} unavailable: ${toErrorReason(error)}`],
    };
  }
}

export async function ingestTickerAnalystData(
  ticker: string,
): Promise<IngestTickerAnalystDataResult> {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const subsourceWarnings: IngestTickerAnalystDataResult["subsourceWarnings"] = {
    priceTargetSummary: [],
    priceTargetConsensus: [],
    analystRatings: [],
    analystActions: [],
  };

  await ensureStockExists(normalizedTicker);

  const stock = await getStockProfile(normalizedTicker);
  if (!stock) {
    throw new Error(`Unable to resolve stock for ticker ${normalizedTicker}.`);
  }

  const latestPriceSnapshot = await getLatestMarketSnapshotForStock(stock.id);
  const latestPrice = latestPriceSnapshot?.price ?? null;

  const summaryCall = await safeOptionalCall("Price-target summary", () =>
    fmpAnalystProvider.getPriceTargetSummary(normalizedTicker),
  );
  const consensusCall = await safeOptionalCall("Price-target consensus", () =>
    fmpAnalystProvider.getPriceTargetConsensus(normalizedTicker),
  );
  const ratingsCall = await safeOptionalCall("Analyst ratings", () =>
    fmpAnalystProvider.getAnalystRatings(normalizedTicker),
  );

  subsourceWarnings.priceTargetSummary.push(...summaryCall.warnings);
  subsourceWarnings.priceTargetConsensus.push(...consensusCall.warnings);
  subsourceWarnings.analystRatings.push(...ratingsCall.warnings);

  const mergedSnapshot = mergeSnapshotParts(
    normalizedTicker,
    summaryCall.value,
    consensusCall.value,
    ratingsCall.value,
    latestPrice,
  );

  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;

  if (mergedSnapshot) {
    const snapshotResult = await upsertAnalystSnapshot({
      stockId: stock.id,
      source: mergedSnapshot.source ?? "FMP",
      capturedAt: mergedSnapshot.capturedAt,
      priceTargetAverage: mergedSnapshot.priceTargetAverage,
      priceTargetHigh: mergedSnapshot.priceTargetHigh,
      priceTargetLow: mergedSnapshot.priceTargetLow,
      priceTargetConsensus: mergedSnapshot.priceTargetConsensus,
      analystCount: mergedSnapshot.analystCount,
      ratingConsensus: mergedSnapshot.ratingConsensus,
      strongBuyCount: mergedSnapshot.strongBuyCount,
      buyCount: mergedSnapshot.buyCount,
      holdCount: mergedSnapshot.holdCount,
      sellCount: mergedSnapshot.sellCount,
      strongSellCount: mergedSnapshot.strongSellCount,
      upsidePercent: mergedSnapshot.upsidePercent,
      raw: (mergedSnapshot.raw ?? Prisma.DbNull) as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput,
    });

    snapshotsCreated = snapshotResult.created ? 1 : 0;
    snapshotsUpdated = snapshotResult.updated ? 1 : 0;
  } else {
    if (
      summaryCall.status === "EMPTY" &&
      consensusCall.status === "EMPTY" &&
      ratingsCall.status === "EMPTY"
    ) {
      subsourceWarnings.priceTargetSummary.push(
        `No analyst snapshot data returned for ticker ${normalizedTicker}.`,
      );
    }
  }

  const actionsCall = await safeOptionalCall("Upgrades/downgrades", () =>
    fmpAnalystProvider.getUpgradesDowngrades(normalizedTicker, { limit: 100 }),
  );
  subsourceWarnings.analystActions.push(...actionsCall.warnings);

  let actionsCreated = 0;
  let actionsUpdated = 0;

  if (actionsCall.value && actionsCall.value.length > 0) {
    for (const action of actionsCall.value) {
      const eventResult = await upsertAnalystActionEvent({
        stockId: stock.id,
        source: action.source ?? "FMP",
        actionType: action.actionType,
        firm: action.firm,
        analystName: action.analystName,
        previousRating: action.previousRating,
        newRating: action.newRating,
        previousPriceTarget: action.previousPriceTarget,
        newPriceTarget: action.newPriceTarget,
        eventDate: action.eventDate,
        headline: action.headline,
        url: action.url,
        raw: (action.raw ?? Prisma.DbNull) as
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput,
      });

      if (eventResult.created) {
        actionsCreated += 1;
      } else if (eventResult.updated) {
        actionsUpdated += 1;
      }
    }
  } else if (actionsCall.status === "SUCCESS") {
    subsourceWarnings.analystActions.push(
      `No analyst action events returned for ticker ${normalizedTicker}.`,
    );
  }

  const warnings = [
    ...subsourceWarnings.priceTargetSummary,
    ...subsourceWarnings.priceTargetConsensus,
    ...subsourceWarnings.analystRatings,
    ...subsourceWarnings.analystActions,
  ];

  return {
    ticker: normalizedTicker,
    snapshotsCreated,
    snapshotsUpdated,
    actionsCreated,
    actionsUpdated,
    priceTargetSummaryStatus: summaryCall.status,
    priceTargetConsensusStatus: consensusCall.status,
    analystRatingsStatus: ratingsCall.status,
    analystActionsStatus:
      actionsCall.status === "SUCCESS" && actionsCreated + actionsUpdated === 0
        ? "EMPTY"
        : actionsCall.status,
    subsourceWarnings,
    warnings,
  };
}

export async function getFmpAnalystAudit(
  ticker: string,
): Promise<FmpAnalystTickerAuditResult> {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  return fmpAnalystProvider.auditTicker(normalizedTicker);
}

export async function ingestPortfolioAnalystData(
  portfolioId: string,
): Promise<IngestPortfolioAnalystDataResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const startedAtDate = new Date();

  const overview = await getPortfolioOverview(normalizedPortfolioId);
  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const uniqueTickers = Array.from(
    new Set(overview.holdings.map((holding) => holding.stock.ticker)),
  );

  const results: IngestTickerAnalystDataResult[] = [];
  const failedTickers: IngestPortfolioAnalystDataResult["failedTickers"] = [];
  const warnings: string[] = [];

  for (const ticker of uniqueTickers) {
    try {
      const result = await ingestTickerAnalystData(ticker);
      results.push(result);
      warnings.push(...result.warnings.map((warning) => `${ticker}: ${warning}`));
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
    tickersProcessed: uniqueTickers.length,
    tickersFailed: failedTickers.length,
    snapshotsCreated: results.reduce((sum, item) => sum + item.snapshotsCreated, 0),
    snapshotsUpdated: results.reduce((sum, item) => sum + item.snapshotsUpdated, 0),
    actionsCreated: results.reduce((sum, item) => sum + item.actionsCreated, 0),
    actionsUpdated: results.reduce((sum, item) => sum + item.actionsUpdated, 0),
    results,
    failedTickers,
    warnings,
  };
}

export async function ingestWatchlistAnalystData(
  watchlistId: string,
): Promise<IngestWatchlistAnalystDataResult> {
  const normalizedWatchlistId = assertNonBlank(watchlistId, "watchlistId");
  const startedAtDate = new Date();

  const watchlist = await getWatchlistWithItems(normalizedWatchlistId);
  if (!watchlist) {
    throw new Error("Watchlist not found.");
  }

  const uniqueTickers = Array.from(new Set(watchlist.items.map((item) => item.stock.ticker)));

  const results: IngestTickerAnalystDataResult[] = [];
  const failedTickers: IngestWatchlistAnalystDataResult["failedTickers"] = [];
  const warnings: string[] = [];

  for (const ticker of uniqueTickers) {
    try {
      const result = await ingestTickerAnalystData(ticker);
      results.push(result);
      warnings.push(...result.warnings.map((warning) => `${ticker}: ${warning}`));
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: toErrorReason(error),
      });
    }
  }

  const finishedAtDate = new Date();

  return {
    watchlistId: normalizedWatchlistId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    tickersProcessed: uniqueTickers.length,
    tickersFailed: failedTickers.length,
    snapshotsCreated: results.reduce((sum, item) => sum + item.snapshotsCreated, 0),
    snapshotsUpdated: results.reduce((sum, item) => sum + item.snapshotsUpdated, 0),
    actionsCreated: results.reduce((sum, item) => sum + item.actionsCreated, 0),
    actionsUpdated: results.reduce((sum, item) => sum + item.actionsUpdated, 0),
    results,
    failedTickers,
    warnings,
  };
}

export async function getLatestTickerAnalystSnapshot(
  ticker: string,
) {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  return getLatestAnalystSnapshot(stock.id);
}

export async function listTickerAnalystActions(
  ticker: string,
  limit?: number,
) {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return [];
  }

  return listAnalystActionsByStock(stock.id, normalizeListLimit(limit));
}

export async function listTickerAnalystSnapshots(
  ticker: string,
  limit?: number,
) {
  const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return [];
  }

  return listAnalystSnapshots(stock.id, normalizeListLimit(limit));
}
