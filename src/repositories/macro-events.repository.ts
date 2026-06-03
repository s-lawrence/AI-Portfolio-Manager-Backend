import { MacroEvent, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";

export async function createMacroEvent(
  input: Prisma.MacroEventCreateInput,
): Promise<MacroEvent> {
  return prisma.macroEvent.create({ data: input });
}

export async function updateMacroEvent(
  id: string,
  input: Prisma.MacroEventUpdateInput,
): Promise<MacroEvent> {
  return prisma.macroEvent.update({
    where: { id },
    data: input,
  });
}

export async function getMacroEventById(id: string): Promise<MacroEvent | null> {
  return prisma.macroEvent.findUnique({ where: { id } });
}

export async function listRecentMacroEvents(limit?: number): Promise<MacroEvent[]> {
  return prisma.macroEvent.findMany({
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}

/**
 * Filters macro events where the ticker appears in the affectedTickers array.
 */
export async function listMacroEventsByAffectedTicker(
  ticker: string,
  limit?: number,
): Promise<MacroEvent[]> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);

  return prisma.macroEvent.findMany({
    where: {
      affectedTickers: {
        has: normalizedTicker,
      },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}
