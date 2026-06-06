import { Prisma, Watchlist } from "@prisma/client";

import { prisma } from "../db/prisma";

export type WatchlistWithItems = Prisma.WatchlistGetPayload<{
  include: {
    items: {
      include: {
        stock: true;
      };
      orderBy: {
        createdAt: "desc";
      };
    };
  };
}>;

export async function createWatchlist(
  input: Prisma.WatchlistUncheckedCreateInput,
): Promise<Watchlist> {
  return prisma.watchlist.create({ data: input });
}

export async function getWatchlistById(id: string): Promise<Watchlist | null> {
  return prisma.watchlist.findUnique({ where: { id } });
}

export async function getWatchlistWithItems(
  id: string,
): Promise<WatchlistWithItems | null> {
  return prisma.watchlist.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          stock: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function getWatchlistsByUserId(userId: string): Promise<Watchlist[]> {
  return prisma.watchlist.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function getDefaultWatchlistByUserId(
  userId: string,
): Promise<Watchlist | null> {
  return prisma.watchlist.findFirst({
    where: { userId, isDefault: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function updateWatchlist(
  id: string,
  input: Prisma.WatchlistUpdateInput,
): Promise<Watchlist> {
  return prisma.watchlist.update({
    where: { id },
    data: input,
  });
}

export async function deleteWatchlist(id: string): Promise<Watchlist> {
  return prisma.watchlist.delete({ where: { id } });
}
