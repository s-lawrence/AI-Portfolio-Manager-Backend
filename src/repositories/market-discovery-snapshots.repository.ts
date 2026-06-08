import { MarketDiscoverySnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";

export type CreateMarketDiscoverySnapshotInput = Omit<
  Prisma.MarketDiscoverySnapshotUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

export interface ListRecentDiscoveryFilters {
  category?: string;
  ticker?: string;
  stockId?: string;
  from?: Date;
  to?: Date;
}

export async function createMarketDiscoverySnapshot(
  input: CreateMarketDiscoverySnapshotInput,
): Promise<MarketDiscoverySnapshot> {
  const nextRaw =
    input.raw === undefined
      ? undefined
      : input.raw === null || input.raw === Prisma.DbNull || input.raw === Prisma.JsonNull
        ? Prisma.DbNull
        : input.raw;

  return prisma.marketDiscoverySnapshot.create({
    data: {
      source: input.source ?? null,
      category: input.category,
      ticker: normalizeTickerOrThrow(input.ticker),
      stockId: input.stockId ?? null,
      companyName: input.companyName ?? null,
      price: input.price ?? null,
      changePercent: input.changePercent ?? null,
      volume: input.volume ?? null,
      marketCap: input.marketCap ?? null,
      capturedAt: input.capturedAt,
      raw: nextRaw,
    },
  });
}

export async function listLatestDiscoveryByCategory(
  category: string,
  limit?: number,
): Promise<MarketDiscoverySnapshot[]> {
  const normalizedCategory = category.trim().toUpperCase();

  const latest = await prisma.marketDiscoverySnapshot.findFirst({
    where: {
      category: normalizedCategory,
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!latest) {
    return [];
  }

  return prisma.marketDiscoverySnapshot.findMany({
    where: {
      category: normalizedCategory,
      capturedAt: latest.capturedAt,
    },
    orderBy: [
      { changePercent: "desc" },
      { volume: "desc" },
      { createdAt: "desc" },
    ],
    take: normalizeListLimit(limit),
  });
}

export async function listRecentDiscovery(
  limit?: number,
  filters: ListRecentDiscoveryFilters = {},
): Promise<MarketDiscoverySnapshot[]> {
  return prisma.marketDiscoverySnapshot.findMany({
    where: {
      ...(filters.category ? { category: filters.category.trim().toUpperCase() } : {}),
      ...(filters.ticker ? { ticker: normalizeTickerOrThrow(filters.ticker) } : {}),
      ...(filters.stockId ? { stockId: filters.stockId } : {}),
      capturedAt:
        filters.from || filters.to
          ? {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            }
          : undefined,
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}
