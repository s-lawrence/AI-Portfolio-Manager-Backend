import { Holding, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

export type HoldingWithStock = Prisma.HoldingGetPayload<{
  include: {
    stock: true;
  };
}>;

export async function getHoldingById(id: string): Promise<Holding | null> {
  return prisma.holding.findUnique({ where: { id } });
}

export async function listHoldingsByPortfolioId(
  portfolioId: string,
): Promise<Holding[]> {
  return prisma.holding.findMany({
    where: { portfolioId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createHolding(
  input: Prisma.HoldingUncheckedCreateInput,
): Promise<Holding> {
  return prisma.holding.create({ data: input });
}

export async function updateHolding(
  id: string,
  input: Prisma.HoldingUpdateInput,
): Promise<Holding> {
  return prisma.holding.update({
    where: { id },
    data: input,
  });
}

export async function deleteHolding(id: string): Promise<Holding> {
  return prisma.holding.delete({ where: { id } });
}

export async function getHoldingByPortfolioAndStock(
  portfolioId: string,
  stockId: string,
): Promise<Holding | null> {
  return prisma.holding.findUnique({
    where: {
      portfolioId_stockId: {
        portfolioId,
        stockId,
      },
    },
  });
}

export async function getHoldingWithStock(
  id: string,
): Promise<HoldingWithStock | null> {
  return prisma.holding.findUnique({
    where: { id },
    include: { stock: true },
  });
}
