import { PriceSnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";

export async function createPriceSnapshot(
  input: Prisma.PriceSnapshotUncheckedCreateInput,
): Promise<PriceSnapshot> {
  return prisma.priceSnapshot.create({ data: input });
}

export async function getLatestPriceSnapshot(
  stockId: string,
): Promise<PriceSnapshot | null> {
  return prisma.priceSnapshot.findFirst({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
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
