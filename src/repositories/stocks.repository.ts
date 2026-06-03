import { Prisma, Stock } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";

export type UpsertStockByTickerInput = Omit<
  Prisma.StockUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "ticker"
> & {
  ticker: string;
};

export async function getStockById(id: string): Promise<Stock | null> {
  return prisma.stock.findUnique({ where: { id } });
}

export async function getStockByTicker(ticker: string): Promise<Stock | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  return prisma.stock.findUnique({ where: { ticker: normalizedTicker } });
}

export async function listStocks(): Promise<Stock[]> {
  return prisma.stock.findMany({
    orderBy: { ticker: "asc" },
  });
}

export async function searchStocks(query: string): Promise<Stock[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const limit = normalizeListLimit();

  return prisma.stock.findMany({
    where: {
      OR: [
        { ticker: { contains: trimmedQuery, mode: "insensitive" } },
        { companyName: { contains: trimmedQuery, mode: "insensitive" } },
        { sector: { contains: trimmedQuery, mode: "insensitive" } },
        { industry: { contains: trimmedQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { ticker: "asc" },
    take: limit,
  });
}

export async function upsertStockByTicker(
  input: UpsertStockByTickerInput,
): Promise<Stock> {
  const normalizedTicker = normalizeTickerOrThrow(input.ticker);
  const { ticker: _ignored, ...rest } = input;

  return prisma.stock.upsert({
    where: { ticker: normalizedTicker },
    create: {
      ...rest,
      ticker: normalizedTicker,
    },
    update: rest,
  });
}

export async function updateStock(
  id: string,
  input: Prisma.StockUpdateInput,
): Promise<Stock> {
  return prisma.stock.update({
    where: { id },
    data: input,
  });
}

export async function deleteStock(id: string): Promise<Stock> {
  return prisma.stock.delete({ where: { id } });
}
