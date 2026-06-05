import { FxRateSnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function upsertFxRateSnapshot(input: {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  capturedAt: Date;
  source?: string | null;
}): Promise<{ snapshot: FxRateSnapshot; created: boolean; updated: boolean }> {
  const baseCurrency = input.baseCurrency.trim().toUpperCase();
  const quoteCurrency = input.quoteCurrency.trim().toUpperCase();

  const existing = await prisma.fxRateSnapshot.findUnique({
    where: {
      baseCurrency_quoteCurrency_capturedAt: {
        baseCurrency,
        quoteCurrency,
        capturedAt: input.capturedAt,
      },
    },
  });

  if (existing) {
    const nextSource = input.source ?? null;
    const unchanged = existing.rate === input.rate && existing.source === nextSource;

    if (unchanged) {
      return {
        snapshot: existing,
        created: false,
        updated: false,
      };
    }

    const snapshot = await prisma.fxRateSnapshot.update({
      where: { id: existing.id },
      data: {
        rate: input.rate,
        source: nextSource,
      },
    });

    return {
      snapshot,
      created: false,
      updated: true,
    };
  }

  const snapshot = await prisma.fxRateSnapshot.create({
    data: {
      baseCurrency,
      quoteCurrency,
      rate: input.rate,
      source: input.source ?? null,
      capturedAt: input.capturedAt,
    },
  });

  return {
    snapshot,
    created: true,
    updated: false,
  };
}

export async function getLatestFxRateSnapshot(
  baseCurrency: string,
  quoteCurrency: string,
): Promise<FxRateSnapshot | null> {
  return prisma.fxRateSnapshot.findFirst({
    where: {
      baseCurrency: baseCurrency.trim().toUpperCase(),
      quoteCurrency: quoteCurrency.trim().toUpperCase(),
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listFxRateSnapshots(
  baseCurrency: string,
  quoteCurrency: string,
  limit?: number,
): Promise<FxRateSnapshot[]> {
  return prisma.fxRateSnapshot.findMany({
    where: {
      baseCurrency: baseCurrency.trim().toUpperCase(),
      quoteCurrency: quoteCurrency.trim().toUpperCase(),
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}

export async function createFxRateSnapshot(
  input: Prisma.FxRateSnapshotUncheckedCreateInput,
): Promise<FxRateSnapshot> {
  return prisma.fxRateSnapshot.create({ data: input });
}
