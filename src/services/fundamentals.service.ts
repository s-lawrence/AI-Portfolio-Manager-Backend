import { FundamentalSnapshot, Prisma, Stock } from "@prisma/client";

import {
  createFundamentalSnapshot,
  getLatestFundamentalSnapshot,
  listFundamentalSnapshotsByStockId,
} from "../repositories/fundamental-snapshots.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { ensureStockExists, getStockProfile } from "./stocks.service";

export type RecordFundamentalSnapshotInput = Omit<
  Prisma.FundamentalSnapshotUncheckedCreateInput,
  "id" | "stockId" | "capturedAt" | "createdAt"
> & {
  capturedAt?: Date;
};

const FUNDAMENTAL_METRICS = [
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
] as const;

type FundamentalMetricKey = (typeof FUNDAMENTAL_METRICS)[number];

export interface FundamentalMetricDelta {
  current: number | null;
  previous: number | null;
  delta: number | null;
}

export interface FundamentalComparisonResult {
  stock: Stock;
  current: FundamentalSnapshot;
  previous: FundamentalSnapshot | null;
  deltas: Record<FundamentalMetricKey, FundamentalMetricDelta>;
}

function normalizeNumeric(value: number | bigint | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  return typeof value === "bigint" ? Number(value) : value;
}

export async function recordFundamentalSnapshot(
  ticker: string,
  input: RecordFundamentalSnapshotInput,
): Promise<FundamentalSnapshot> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  return createFundamentalSnapshot({
    stockId: stock.id,
    capturedAt: input.capturedAt ?? new Date(),
    marketCap: input.marketCap ?? null,
    peRatio: input.peRatio ?? null,
    forwardPeRatio: input.forwardPeRatio ?? null,
    pegRatio: input.pegRatio ?? null,
    priceToSales: input.priceToSales ?? null,
    priceToBook: input.priceToBook ?? null,
    evToEbitda: input.evToEbitda ?? null,
    eps: input.eps ?? null,
    revenueGrowth: input.revenueGrowth ?? null,
    grossMargin: input.grossMargin ?? null,
    operatingMargin: input.operatingMargin ?? null,
    netMargin: input.netMargin ?? null,
    debtToEquity: input.debtToEquity ?? null,
    currentRatio: input.currentRatio ?? null,
    freeCashFlow: input.freeCashFlow ?? null,
    dividendYield: input.dividendYield ?? null,
    analystConsensus: input.analystConsensus ?? null,
    source: input.source ?? null,
  });
}

export async function getLatestFundamentals(
  ticker: string,
): Promise<FundamentalSnapshot | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  return getLatestFundamentalSnapshot(stock.id);
}

/**
 * Compares the latest two fundamental snapshots and returns per-metric deltas.
 */
export async function compareFundamentalsToPrevious(
  ticker: string,
): Promise<FundamentalComparisonResult | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  const snapshots = await listFundamentalSnapshotsByStockId(stock.id, 2);
  const current = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;

  if (!current) {
    return null;
  }

  const deltas = {} as Record<FundamentalMetricKey, FundamentalMetricDelta>;
  for (const metric of FUNDAMENTAL_METRICS) {
    const currentValue = normalizeNumeric(current[metric]);
    const previousValue = normalizeNumeric(previous?.[metric]);

    deltas[metric] = {
      current: currentValue,
      previous: previousValue,
      delta:
        currentValue != null && previousValue != null
          ? currentValue - previousValue
          : null,
    };
  }

  return {
    stock,
    current,
    previous,
    deltas,
  };
}
