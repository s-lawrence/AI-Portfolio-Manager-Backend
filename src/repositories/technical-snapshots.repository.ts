import { Prisma, TechnicalSnapshot } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createTechnicalSnapshot(
  input: Prisma.TechnicalSnapshotUncheckedCreateInput,
): Promise<TechnicalSnapshot> {
  return prisma.technicalSnapshot.create({ data: input });
}

export async function getLatestTechnicalSnapshot(
  stockId: string,
): Promise<TechnicalSnapshot | null> {
  return prisma.technicalSnapshot.findFirst({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listTechnicalSnapshotsByStockId(
  stockId: string,
  limit?: number,
): Promise<TechnicalSnapshot[]> {
  return prisma.technicalSnapshot.findMany({
    where: { stockId },
    orderBy: { capturedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}
