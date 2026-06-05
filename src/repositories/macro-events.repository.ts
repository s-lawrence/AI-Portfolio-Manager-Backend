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

export interface MacroEventIdentityInput {
  provider?: string | null;
  title: string;
  eventDate?: Date | null;
  country?: string | null;
}

export async function findMacroEventByProviderIdentity(
  identity: MacroEventIdentityInput,
): Promise<MacroEvent | null> {
  const trimmedTitle = identity.title.trim();
  if (!trimmedTitle) {
    return null;
  }

  return prisma.macroEvent.findFirst({
    where: {
      provider: identity.provider ?? null,
      title: trimmedTitle,
      eventDate: identity.eventDate ?? null,
      country: identity.country ?? null,
    },
  });
}

export async function upsertMacroEventByProviderIdentity(
  identity: MacroEventIdentityInput,
  payload: {
    eventType?: string | null;
    category?: string | null;
    importance?: string | null;
    actual?: number | null;
    estimate?: number | null;
    previous?: number | null;
    unit?: string | null;
    source?: string | null;
    sourceUrl?: string | null;
  },
): Promise<{ event: MacroEvent; created: boolean; updated: boolean }> {
  const existing = await findMacroEventByProviderIdentity(identity);

  if (existing) {
    const nextEventType = payload.eventType ?? null;
    const nextCategory = payload.category ?? null;
    const nextImportance = payload.importance ?? null;
    const nextActual = payload.actual ?? null;
    const nextEstimate = payload.estimate ?? null;
    const nextPrevious = payload.previous ?? null;
    const nextUnit = payload.unit ?? null;
    const nextSource = payload.source ?? null;
    const nextSourceUrl = payload.sourceUrl ?? null;

    const unchanged =
      existing.eventType === nextEventType &&
      existing.category === nextCategory &&
      existing.importance === nextImportance &&
      existing.actual === nextActual &&
      existing.estimate === nextEstimate &&
      existing.previous === nextPrevious &&
      existing.unit === nextUnit &&
      existing.source === nextSource &&
      existing.sourceUrl === nextSourceUrl;

    if (unchanged) {
      return {
        event: existing,
        created: false,
        updated: false,
      };
    }

    const updated = await prisma.macroEvent.update({
      where: { id: existing.id },
      data: {
        eventType: nextEventType,
        category: nextCategory,
        importance: nextImportance,
        actual: nextActual,
        estimate: nextEstimate,
        previous: nextPrevious,
        unit: nextUnit,
        source: nextSource,
        sourceUrl: nextSourceUrl,
      },
    });

    return {
      event: updated,
      created: false,
      updated: true,
    };
  }

  const created = await prisma.macroEvent.create({
    data: {
      provider: identity.provider ?? null,
      title: identity.title.trim(),
      eventDate: identity.eventDate ?? null,
      country: identity.country ?? null,
      eventType: payload.eventType ?? null,
      category: payload.category ?? null,
      importance: payload.importance ?? null,
      actual: payload.actual ?? null,
      estimate: payload.estimate ?? null,
      previous: payload.previous ?? null,
      unit: payload.unit ?? null,
      source: payload.source ?? null,
      sourceUrl: payload.sourceUrl ?? null,
    },
  });

  return {
    event: created,
    created: true,
    updated: false,
  };
}

export async function listUpcomingMacroEventsByProvider(
  provider: string,
  options: {
    from?: Date;
    to?: Date;
    importanceLevels?: string[];
    limit?: number;
  } = {},
): Promise<MacroEvent[]> {
  const normalizedProvider = provider.trim();
  if (!normalizedProvider) {
    return [];
  }

  const normalizedImportanceLevels = (options.importanceLevels ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const from = options.from ?? new Date();
  const where: Prisma.MacroEventWhereInput = {
    provider: normalizedProvider,
    eventDate: {
      gte: from,
      ...(options.to ? { lte: options.to } : {}),
    },
    ...(normalizedImportanceLevels.length > 0
      ? {
          importance: {
            in: normalizedImportanceLevels,
            mode: "insensitive",
          },
        }
      : {}),
  };

  return prisma.macroEvent.findMany({
    where,
    orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
    take: normalizeListLimit(options.limit),
  });
}
