import { Prisma, WatchlistItem, WatchlistItemStatus } from "@prisma/client";

import { prisma } from "../db/prisma";

export type WatchlistItemWithStock = Prisma.WatchlistItemGetPayload<{
  include: {
    stock: true;
  };
}>;

export async function createWatchlistItem(
  input: Prisma.WatchlistItemUncheckedCreateInput,
): Promise<WatchlistItem> {
  return prisma.watchlistItem.create({ data: input });
}

export async function getWatchlistItemById(id: string): Promise<WatchlistItem | null> {
  return prisma.watchlistItem.findUnique({ where: { id } });
}

export async function getWatchlistItemWithStock(
  id: string,
): Promise<WatchlistItemWithStock | null> {
  return prisma.watchlistItem.findUnique({
    where: { id },
    include: {
      stock: true,
    },
  });
}

export async function getWatchlistItemsByWatchlistId(
  watchlistId: string,
): Promise<WatchlistItem[]> {
  return prisma.watchlistItem.findMany({
    where: { watchlistId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getWatchlistItemByWatchlistAndStock(
  watchlistId: string,
  stockId: string,
): Promise<WatchlistItem | null> {
  return prisma.watchlistItem.findUnique({
    where: {
      watchlistId_stockId: {
        watchlistId,
        stockId,
      },
    },
  });
}

export async function updateWatchlistItem(
  id: string,
  input: Prisma.WatchlistItemUncheckedUpdateInput,
): Promise<WatchlistItem> {
  return prisma.watchlistItem.update({
    where: { id },
    data: input,
  });
}

export async function deleteWatchlistItem(id: string): Promise<WatchlistItem> {
  return prisma.watchlistItem.delete({ where: { id } });
}

export async function listWatchlistItemsByStatus(
  watchlistId: string,
  status: WatchlistItemStatus,
): Promise<WatchlistItem[]> {
  return prisma.watchlistItem.findMany({
    where: { watchlistId, status },
    orderBy: { createdAt: "desc" },
  });
}
