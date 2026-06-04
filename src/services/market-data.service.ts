import { PriceSnapshot, Prisma } from "@prisma/client";

import {
  createPriceSnapshot,
  findPriceSnapshotByStockIdAndCapturedAt,
  findPriceSnapshotsForStockOnUtcDay,
  getLatestMarketSnapshotForStock,
  listPriceSnapshotsByStockId,
  listPriceSnapshotsByStockIdByCreatedAt,
  updatePriceSnapshot,
} from "../repositories/price-snapshots.repository";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { fmpMarketDataProvider } from "../providers/fmp";
import {
  normalizeListLimit,
  normalizeTickerOrThrow,
  startOfUtcDay,
} from "../types/common";
import { MarketDataSnapshotInput } from "../types/services";
import { ensureStockExists, getStockProfile } from "./stocks.service";

function normalizeBigInt(value?: bigint | number | null): bigint | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (!Number.isFinite(value)) {
    throw new Error("Numeric bigint-compatible values must be finite.");
  }

  return BigInt(Math.trunc(value));
}

export function calculateDailyChange(
  price: number,
  previousClose?: number | null,
): number | null {
  if (previousClose == null || previousClose === 0) {
    return null;
  }

  return ((price - previousClose) / previousClose) * 100;
}

export async function recordPriceSnapshot(
  ticker: string,
  input: MarketDataSnapshotInput,
): Promise<PriceSnapshot> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);
  const capturedAt = input.capturedAt ?? new Date();

  const changePercent =
    input.changePercent ?? calculateDailyChange(input.price, input.previousClose);

  return createPriceSnapshot({
    stockId: stock.id,
    source: input.source ?? null,
    price: input.price,
    open: input.open ?? null,
    high: input.high ?? null,
    low: input.low ?? null,
    close: input.close ?? null,
    previousClose: input.previousClose ?? null,
    volume: normalizeBigInt(input.volume),
    marketCap: normalizeBigInt(input.marketCap),
    changePercent,
    capturedAt,
  });
}

export type UpsertHistoricalPriceSnapshotForDayResult = {
  snapshot: PriceSnapshot;
  created: boolean;
  updated: boolean;
  skipped: boolean;
};

export type UpsertHistoricalPriceSnapshotForDayOptions = {
  cleanupLegacyDuplicates?: boolean;
};

function isPriceSnapshotUniqueCapturedAtError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function canonicalHistoricalCapturedAtForMarketDate(marketDate: Date): Date {
  return startOfUtcDay(marketDate);
}

function isSameNumberOrNull(left: number | null, right: number | null): boolean {
  if (left == null && right == null) {
    return true;
  }

  if (left == null || right == null) {
    return false;
  }

  return left === right;
}

function isSameBigIntOrNull(left: bigint | null, right: bigint | null): boolean {
  if (left == null && right == null) {
    return true;
  }

  if (left == null || right == null) {
    return false;
  }

  return left === right;
}

function isIdenticalHistoricalPayload(
  existing: PriceSnapshot,
  incoming: {
    source: string;
    price: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    previousClose: number | null;
    volume: bigint | null;
    marketCap: bigint | null;
    changePercent: number | null;
  },
): boolean {
  return (
    existing.source === incoming.source &&
    existing.price === incoming.price &&
    isSameNumberOrNull(existing.open, incoming.open) &&
    isSameNumberOrNull(existing.high, incoming.high) &&
    isSameNumberOrNull(existing.low, incoming.low) &&
    isSameNumberOrNull(existing.close, incoming.close) &&
    isSameNumberOrNull(existing.previousClose, incoming.previousClose) &&
    isSameBigIntOrNull(existing.volume, incoming.volume) &&
    isSameBigIntOrNull(existing.marketCap, incoming.marketCap) &&
    isSameNumberOrNull(existing.changePercent, incoming.changePercent)
  );
}

async function deleteLegacyDuplicatesForUtcDay(
  stockId: string,
  marketDate: Date,
  keepSnapshotId: string,
): Promise<void> {
  const sameDayRows = await findPriceSnapshotsForStockOnUtcDay(stockId, marketDate);
  const duplicateIds = sameDayRows
    .filter(
      (snapshot) =>
        snapshot.id !== keepSnapshotId &&
        (snapshot.source === null || snapshot.source === "DEMO"),
    )
    .map((snapshot) => snapshot.id);

  if (duplicateIds.length === 0) {
    return;
  }

  await prisma.priceSnapshot.deleteMany({
    where: {
      id: {
        in: duplicateIds,
      },
    },
  });
}

export async function upsertHistoricalPriceSnapshotByMarketDate(
  stockId: string,
  marketDate: Date,
  input: MarketDataSnapshotInput,
  options: UpsertHistoricalPriceSnapshotForDayOptions = {},
): Promise<UpsertHistoricalPriceSnapshotForDayResult> {
  const canonicalCapturedAt = canonicalHistoricalCapturedAtForMarketDate(marketDate);
  const source = input.source ?? "FMP_HISTORICAL";

  const open = input.open ?? null;
  const high = input.high ?? null;
  const low = input.low ?? null;
  const close = input.close ?? null;
  const previousClose = input.previousClose ?? null;
  const volume = normalizeBigInt(input.volume);
  const marketCap = normalizeBigInt(input.marketCap);
  const changePercent =
    input.changePercent ?? calculateDailyChange(input.price, input.previousClose);

  const incomingPayload = {
    source,
    price: input.price,
    open,
    high,
    low,
    close,
    previousClose,
    volume,
    marketCap,
    changePercent,
  };

  const sameDayRows = await findPriceSnapshotsForStockOnUtcDay(stockId, canonicalCapturedAt);

  const exactCanonicalRow = sameDayRows.find(
    (snapshot) => snapshot.capturedAt.getTime() === canonicalCapturedAt.getTime(),
  );

  if (exactCanonicalRow) {
    // Avoid converting canonical quote rows into historical rows.
    if (exactCanonicalRow.source === "FMP_QUOTE" && source === "FMP_HISTORICAL") {
      return {
        snapshot: exactCanonicalRow,
        created: false,
        updated: false,
        skipped: true,
      };
    }

    if (isIdenticalHistoricalPayload(exactCanonicalRow, incomingPayload)) {
      return {
        snapshot: exactCanonicalRow,
        created: false,
        updated: false,
        skipped: true,
      };
    }

    const snapshot = await updatePriceSnapshot(exactCanonicalRow.id, {
      source,
      price: input.price,
      open,
      high,
      low,
      close,
      previousClose,
      volume,
      marketCap,
      changePercent,
    });

    if (options.cleanupLegacyDuplicates) {
      await deleteLegacyDuplicatesForUtcDay(stockId, canonicalCapturedAt, snapshot.id);
    }

    return {
      snapshot,
      created: false,
      updated: true,
      skipped: false,
    };
  }

  try {
    const snapshot = await createPriceSnapshot({
      stockId,
      source,
      price: input.price,
      open,
      high,
      low,
      close,
      previousClose,
      volume,
      marketCap,
      changePercent,
      capturedAt: canonicalCapturedAt,
    });

    if (options.cleanupLegacyDuplicates) {
      await deleteLegacyDuplicatesForUtcDay(stockId, canonicalCapturedAt, snapshot.id);
    }

    return {
      snapshot,
      created: true,
      updated: false,
      skipped: false,
    };
  } catch (error) {
    if (!isPriceSnapshotUniqueCapturedAtError(error)) {
      throw error;
    }

    const canonicalExisting = await findPriceSnapshotByStockIdAndCapturedAt(
      stockId,
      canonicalCapturedAt,
    );

    if (!canonicalExisting) {
      throw error;
    }

    if (canonicalExisting.source === "FMP_QUOTE" && source === "FMP_HISTORICAL") {
      return {
        snapshot: canonicalExisting,
        created: false,
        updated: false,
        skipped: true,
      };
    }

    if (isIdenticalHistoricalPayload(canonicalExisting, incomingPayload)) {
      return {
        snapshot: canonicalExisting,
        created: false,
        updated: false,
        skipped: true,
      };
    }

    const snapshot = await updatePriceSnapshot(canonicalExisting.id, {
      source,
      price: input.price,
      open,
      high,
      low,
      close,
      previousClose,
      volume,
      marketCap,
      changePercent,
    });

    if (options.cleanupLegacyDuplicates) {
      await deleteLegacyDuplicatesForUtcDay(stockId, canonicalCapturedAt, snapshot.id);
    }

    return {
      snapshot,
      created: false,
      updated: true,
      skipped: false,
    };
  }
}

export async function upsertHistoricalPriceSnapshotForDay(
  ticker: string,
  input: MarketDataSnapshotInput,
  options: UpsertHistoricalPriceSnapshotForDayOptions = {},
): Promise<UpsertHistoricalPriceSnapshotForDayResult> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);
  const capturedAt = input.capturedAt ?? new Date();

  return upsertHistoricalPriceSnapshotByMarketDate(stock.id, capturedAt, input, options);
}

export async function getLatestMarketSnapshot(
  ticker: string,
): Promise<PriceSnapshot | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  return getLatestMarketSnapshotForStock(stock.id);
}

export async function getHistoricalPrices(
  ticker: string,
  limit?: number,
): Promise<PriceSnapshot[]> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return [];
  }

  return listPriceSnapshotsByStockId(stock.id, normalizeListLimit(limit));
}

type AuditSerializableSnapshot = {
  id: string;
  stockId: string;
  source: string | null;
  capturedAt: Date;
  createdAt: Date;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  previousClose: number | null;
  changePercent: number | null;
  volume: number | string | null;
  marketCap: number | string | null;
};

type AuditFmpQuoteCheck =
  | {
      attempted: false;
      reason: string;
      quote: null;
      error: null;
    }
  | {
      attempted: true;
      reason: null;
      quote: {
        ticker: string;
        price: number | null;
        previousClose: number | null;
        close: number | null;
        changePercent: number | null;
      };
      error: null;
    }
  | {
      attempted: true;
      reason: null;
      quote: null;
      error: {
        message: string;
      };
    };

export type MarketDataAuditResult = {
  ticker: string;
  stockId: string;
  selectedLatestSnapshot: AuditSerializableSnapshot | null;
  latestByCapturedAt: AuditSerializableSnapshot[];
  latestByCreatedAt: AuditSerializableSnapshot[];
  fmpQuoteCheck: AuditFmpQuoteCheck;
};

function serializeBigInt(value: bigint | null): number | string | null {
  if (value == null) {
    return null;
  }

  const asNumber = Number(value);
  if (Number.isSafeInteger(asNumber)) {
    return asNumber;
  }

  return value.toString();
}

function serializeAuditSnapshot(snapshot: PriceSnapshot): AuditSerializableSnapshot {
  return {
    id: snapshot.id,
    stockId: snapshot.stockId,
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    createdAt: snapshot.createdAt,
    price: snapshot.price,
    open: snapshot.open,
    high: snapshot.high,
    low: snapshot.low,
    close: snapshot.close,
    previousClose: snapshot.previousClose,
    changePercent: snapshot.changePercent,
    volume: serializeBigInt(snapshot.volume),
    marketCap: serializeBigInt(snapshot.marketCap),
  };
}

export async function getMarketDataAudit(ticker: string): Promise<MarketDataAuditResult | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  const [selectedLatestSnapshot, latestByCapturedAt, latestByCreatedAt] =
    await Promise.all([
      getLatestMarketSnapshotForStock(stock.id),
      listPriceSnapshotsByStockId(stock.id, 10),
      listPriceSnapshotsByStockIdByCreatedAt(stock.id, 10),
    ]);

  let fmpQuoteCheck: AuditFmpQuoteCheck;

  if (!env.FMP_API_KEY) {
    fmpQuoteCheck = {
      attempted: false,
      reason: "FMP_API_KEY is not configured.",
      quote: null,
      error: null,
    };
  } else {
    try {
      const quote = await fmpMarketDataProvider.getQuote(normalizedTicker);
      fmpQuoteCheck = {
        attempted: true,
        reason: null,
        quote: {
          ticker: quote.ticker,
          price: quote.price ?? null,
          previousClose: quote.previousClose ?? null,
          close: quote.close ?? null,
          changePercent: quote.changePercent ?? null,
        },
        error: null,
      };
    } catch (error) {
      fmpQuoteCheck = {
        attempted: true,
        reason: null,
        quote: null,
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  return {
    ticker: normalizedTicker,
    stockId: stock.id,
    selectedLatestSnapshot: selectedLatestSnapshot
      ? serializeAuditSnapshot(selectedLatestSnapshot)
      : null,
    latestByCapturedAt: latestByCapturedAt.map(serializeAuditSnapshot),
    latestByCreatedAt: latestByCreatedAt.map(serializeAuditSnapshot),
    fmpQuoteCheck,
  };
}
