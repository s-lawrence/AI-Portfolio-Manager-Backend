import { MacroSeriesObservation, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createMacroSeriesObservation(
  input: Prisma.MacroSeriesObservationCreateInput,
): Promise<MacroSeriesObservation> {
  return prisma.macroSeriesObservation.create({ data: input });
}

export async function updateMacroSeriesObservation(
  id: string,
  input: Prisma.MacroSeriesObservationUpdateInput,
): Promise<MacroSeriesObservation> {
  return prisma.macroSeriesObservation.update({
    where: { id },
    data: input,
  });
}

export async function upsertMacroSeriesObservation(
  input: {
    provider: string;
    seriesId: string;
    observedAt: Date;
    value: number;
    name?: string | null;
    country?: string | null;
    category?: string | null;
    unit?: string | null;
  },
): Promise<{ observation: MacroSeriesObservation; created: boolean }> {
  const existing = await prisma.macroSeriesObservation.findUnique({
    where: {
      provider_seriesId_observedAt: {
        provider: input.provider,
        seriesId: input.seriesId,
        observedAt: input.observedAt,
      },
    },
  });

  if (existing) {
    const updated = await prisma.macroSeriesObservation.update({
      where: { id: existing.id },
      data: {
        value: input.value,
        name: input.name ?? null,
        country: input.country ?? null,
        category: input.category ?? null,
        unit: input.unit ?? null,
      },
    });

    return {
      observation: updated,
      created: false,
    };
  }

  const created = await prisma.macroSeriesObservation.create({
    data: {
      provider: input.provider,
      seriesId: input.seriesId,
      observedAt: input.observedAt,
      value: input.value,
      name: input.name ?? null,
      country: input.country ?? null,
      category: input.category ?? null,
      unit: input.unit ?? null,
    },
  });

  return {
    observation: created,
    created: true,
  };
}

export async function listMacroSeriesObservations(
  options: {
    provider?: string;
    seriesId?: string;
    country?: string;
    category?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {},
): Promise<MacroSeriesObservation[]> {
  return prisma.macroSeriesObservation.findMany({
    where: {
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.seriesId ? { seriesId: options.seriesId } : {}),
      ...(options.country ? { country: options.country } : {}),
      ...(options.category ? { category: options.category } : {}),
      observedAt:
        options.from || options.to
          ? {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            }
          : undefined,
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(options.limit),
  });
}

export async function getLatestMacroSeriesObservation(
  provider: string,
  seriesId: string,
): Promise<MacroSeriesObservation | null> {
  return prisma.macroSeriesObservation.findFirst({
    where: {
      provider,
      seriesId,
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
  });
}
