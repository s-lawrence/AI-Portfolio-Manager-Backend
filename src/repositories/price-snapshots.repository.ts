import { PriceSnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import {
  addUtcDays,
  normalizeListLimit,
  normalizeTickerOrThrow,
  startOfUtcDay,
} from "../types/common";

export async function createPriceSnapshot(
  input: Prisma.PriceSnapshotUncheckedCreateInput,
): Promise<PriceSnapshot> {
  return prisma.priceSnapshot.create({ data: input });
}

export async function updatePriceSnapshot(
  id: string,
  input: Prisma.PriceSnapshotUncheckedUpdateInput,
): Promise<PriceSnapshot> {
  return prisma.priceSnapshot.update({
    where: { id },
    data: input,
  });
}

export async function getLatestPriceSnapshot(
  stockId: string,
): Promise<PriceSnapshot | null> {
  return prisma.priceSnapshot.findFirst({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
}

function isIntradaySnapshot(snapshot: PriceSnapshot): boolean {
  const capturedAt = snapshot.capturedAt;

  return !(
    capturedAt.getUTCHours() === 0 &&
    capturedAt.getUTCMinutes() === 0 &&
    capturedAt.getUTCSeconds() === 0 &&
    capturedAt.getUTCMilliseconds() === 0
  );
}

function sourcePriority(source: string | null): number {
  if (source === "FMP_QUOTE") {
    return 5;
  }

  if (source === "FMP_HISTORICAL") {
    return 4;
  }

  if (source === "DEMO") {
    return 1;
  }

  if (source == null) {
    return 2;
  }

  return 3;
}

function historicalSourcePriority(source: string | null): number {
  if (source === "FMP_HISTORICAL") {
    return 5;
  }

  if (source === "FMP_QUOTE") {
    return 4;
  }

  if (source == null) {
    return 2;
  }

  if (source === "DEMO") {
    return 1;
  }

  return 3;
}

function compareLatestSnapshotPriority(left: PriceSnapshot, right: PriceSnapshot): number {
  const sourceDiff = sourcePriority(right.source) - sourcePriority(left.source);
  if (sourceDiff !== 0) {
    return sourceDiff;
  }

  const capturedDiff = right.capturedAt.getTime() - left.capturedAt.getTime();
  if (capturedDiff !== 0) {
    return capturedDiff;
  }

  const intradayLeft = isIntradaySnapshot(left) ? 1 : 0;
  const intradayRight = isIntradaySnapshot(right) ? 1 : 0;
  if (intradayRight !== intradayLeft) {
    return intradayRight - intradayLeft;
  }

  const createdDiff = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return right.id.localeCompare(left.id);
}

function compareUtcDaySnapshotPriority(left: PriceSnapshot, right: PriceSnapshot): number {
  const sourceDiff = historicalSourcePriority(right.source) - historicalSourcePriority(left.source);
  if (sourceDiff !== 0) {
    return sourceDiff;
  }

  const createdDiff = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  const capturedDiff = right.capturedAt.getTime() - left.capturedAt.getTime();
  if (capturedDiff !== 0) {
    return capturedDiff;
  }

  return right.id.localeCompare(left.id);
}

export async function getLatestMarketSnapshotForStock(
  stockId: string,
): Promise<PriceSnapshot | null> {
  const candidates = await prisma.priceSnapshot.findMany({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort(compareLatestSnapshotPriority);
  return sorted[0] ?? null;
}

export async function listPriceSnapshotsByStockId(
  stockId: string,
  limit?: number,
): Promise<PriceSnapshot[]> {
  return prisma.priceSnapshot.findMany({
    where: { stockId },
    orderBy: { capturedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function findPriceSnapshotsByStockIdAndCapturedAtRange(
  stockId: string,
  from: Date,
  to: Date,
): Promise<PriceSnapshot[]> {
  return prisma.priceSnapshot.findMany({
    where: {
      stockId,
      capturedAt: {
        gte: from,
        lte: to,
      },
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function findPriceSnapshotsForStockOnUtcDay(
  stockId: string,
  date: Date,
): Promise<PriceSnapshot[]> {
  const dayStart = startOfUtcDay(date);
  const nextDay = addUtcDays(dayStart, 1);

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      stockId,
      capturedAt: {
        gte: dayStart,
        lt: nextDay,
      },
    },
  });

  return [...snapshots].sort(compareUtcDaySnapshotPriority);
}

export async function findPriceSnapshotByStockIdAndCapturedAt(
  stockId: string,
  capturedAt: Date,
): Promise<PriceSnapshot | null> {
  return prisma.priceSnapshot.findFirst({
    where: {
      stockId,
      capturedAt,
    },
  });
}

export async function listPriceSnapshotsByStockIdByCreatedAt(
  stockId: string,
  limit?: number,
): Promise<PriceSnapshot[]> {
  return prisma.priceSnapshot.findMany({
    where: { stockId },
    orderBy: [{ createdAt: "desc" }, { capturedAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}

export async function listPriceSnapshotsByTicker(
  ticker: string,
  limit?: number,
): Promise<PriceSnapshot[]> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);

  return prisma.priceSnapshot.findMany({
    where: {
      stock: {
        ticker: normalizedTicker,
      },
    },
    orderBy: { capturedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function deletePriceSnapshotsByStockId(
  stockId: string,
): Promise<Prisma.BatchPayload> {
  return prisma.priceSnapshot.deleteMany({ where: { stockId } });
}
