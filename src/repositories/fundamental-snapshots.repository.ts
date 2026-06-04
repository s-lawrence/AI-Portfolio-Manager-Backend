import { FundamentalSnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createFundamentalSnapshot(
  input: Prisma.FundamentalSnapshotUncheckedCreateInput,
): Promise<FundamentalSnapshot> {
  return prisma.fundamentalSnapshot.create({ data: input });
}

export async function getLatestFundamentalSnapshot(
  stockId: string,
): Promise<FundamentalSnapshot | null> {
  return prisma.fundamentalSnapshot.findFirst({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function findFundamentalSnapshotByStockIdAndCapturedAtRange(
  stockId: string,
  from: Date,
  to: Date,
): Promise<FundamentalSnapshot | null> {
  return prisma.fundamentalSnapshot.findFirst({
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

export async function updateFundamentalSnapshot(
  id: string,
  input: Prisma.FundamentalSnapshotUncheckedUpdateInput,
): Promise<FundamentalSnapshot> {
  return prisma.fundamentalSnapshot.update({
    where: { id },
    data: input,
  });
}

export async function listFundamentalSnapshotsByStockId(
  stockId: string,
  limit?: number,
): Promise<FundamentalSnapshot[]> {
  return prisma.fundamentalSnapshot.findMany({
    where: { stockId },
    orderBy: { capturedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}
