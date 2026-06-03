import { EarningsEvent, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createEarningsEvent(
  input: Prisma.EarningsEventUncheckedCreateInput,
): Promise<EarningsEvent> {
  return prisma.earningsEvent.create({ data: input });
}

export async function updateEarningsEvent(
  id: string,
  input: Prisma.EarningsEventUpdateInput,
): Promise<EarningsEvent> {
  return prisma.earningsEvent.update({
    where: { id },
    data: input,
  });
}

export async function getEarningsEventById(
  id: string,
): Promise<EarningsEvent | null> {
  return prisma.earningsEvent.findUnique({ where: { id } });
}

export async function listEarningsEventsByStockId(
  stockId: string,
): Promise<EarningsEvent[]> {
  return prisma.earningsEvent.findMany({
    where: { stockId },
    orderBy: { earningsDate: "asc" },
  });
}

/**
 * Returns the nearest upcoming earnings event for a stock.
 */
export async function getNextEarningsEvent(
  stockId: string,
): Promise<EarningsEvent | null> {
  const now = new Date();

  return prisma.earningsEvent.findFirst({
    where: {
      stockId,
      earningsDate: {
        not: null,
        gte: now,
      },
    },
    orderBy: { earningsDate: "asc" },
  });
}

export async function listUpcomingEarnings(limit?: number): Promise<EarningsEvent[]> {
  const now = new Date();

  return prisma.earningsEvent.findMany({
    where: {
      earningsDate: {
        not: null,
        gte: now,
      },
    },
    orderBy: { earningsDate: "asc" },
    take: normalizeListLimit(limit),
  });
}
