import { PriceSnapshot } from "@prisma/client";

import {
  createPriceSnapshot,
  getLatestPriceSnapshot,
  listPriceSnapshotsByStockId,
} from "../repositories/price-snapshots.repository";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";
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

export async function getLatestMarketSnapshot(
  ticker: string,
): Promise<PriceSnapshot | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  return getLatestPriceSnapshot(stock.id);
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
