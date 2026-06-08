import { AnalystSnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export type UpsertAnalystSnapshotInput = Omit<
  Prisma.AnalystSnapshotUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

function isSameJson(
  left: Prisma.JsonValue | null,
  right: Prisma.InputJsonValue | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toComparableJson(
  value:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput
    | null
    | undefined,
): Prisma.InputJsonValue | null {
  if (value == null || value === Prisma.DbNull || value === Prisma.JsonNull) {
    return null;
  }

  return value as Prisma.InputJsonValue;
}

function toPersistedJson(
  value:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput
    | null
    | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === Prisma.DbNull || value === Prisma.JsonNull) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}

export async function upsertAnalystSnapshot(
  input: UpsertAnalystSnapshotInput,
): Promise<{ snapshot: AnalystSnapshot; created: boolean; updated: boolean }> {
  const existing = await prisma.analystSnapshot.findUnique({
    where: {
      stockId_capturedAt: {
        stockId: input.stockId,
        capturedAt: input.capturedAt,
      },
    },
  });

  const nextSource = input.source ?? null;
  const nextRatingConsensus = input.ratingConsensus ?? null;
  const nextRawComparable = toComparableJson(input.raw);
  const nextRaw = toPersistedJson(input.raw);

  if (existing) {
    const unchanged =
      existing.source === nextSource &&
      existing.priceTargetAverage === (input.priceTargetAverage ?? null) &&
      existing.priceTargetHigh === (input.priceTargetHigh ?? null) &&
      existing.priceTargetLow === (input.priceTargetLow ?? null) &&
      existing.priceTargetConsensus === (input.priceTargetConsensus ?? null) &&
      existing.targetMedian === (input.targetMedian ?? null) &&
      existing.lastMonthPriceTargetAvg === (input.lastMonthPriceTargetAvg ?? null) &&
      existing.lastMonthPriceTargetCount === (input.lastMonthPriceTargetCount ?? null) &&
      existing.lastQuarterPriceTargetAvg === (input.lastQuarterPriceTargetAvg ?? null) &&
      existing.lastQuarterPriceTargetCount === (input.lastQuarterPriceTargetCount ?? null) &&
      existing.lastYearPriceTargetAvg === (input.lastYearPriceTargetAvg ?? null) &&
      existing.lastYearPriceTargetCount === (input.lastYearPriceTargetCount ?? null) &&
      existing.allTimePriceTargetAvg === (input.allTimePriceTargetAvg ?? null) &&
      existing.allTimePriceTargetCount === (input.allTimePriceTargetCount ?? null) &&
      existing.analystCount === (input.analystCount ?? null) &&
      existing.ratingConsensus === nextRatingConsensus &&
      existing.strongBuyCount === (input.strongBuyCount ?? null) &&
      existing.buyCount === (input.buyCount ?? null) &&
      existing.holdCount === (input.holdCount ?? null) &&
      existing.sellCount === (input.sellCount ?? null) &&
      existing.strongSellCount === (input.strongSellCount ?? null) &&
      existing.upsidePercent === (input.upsidePercent ?? null) &&
      isSameJson(existing.raw as Prisma.JsonValue | null, nextRawComparable);

    if (unchanged) {
      return {
        snapshot: existing,
        created: false,
        updated: false,
      };
    }

    const snapshot = await prisma.analystSnapshot.update({
      where: { id: existing.id },
      data: {
        source: nextSource,
        priceTargetAverage: input.priceTargetAverage ?? null,
        priceTargetHigh: input.priceTargetHigh ?? null,
        priceTargetLow: input.priceTargetLow ?? null,
        priceTargetConsensus: input.priceTargetConsensus ?? null,
        targetMedian: input.targetMedian ?? null,
        lastMonthPriceTargetAvg: input.lastMonthPriceTargetAvg ?? null,
        lastMonthPriceTargetCount: input.lastMonthPriceTargetCount ?? null,
        lastQuarterPriceTargetAvg: input.lastQuarterPriceTargetAvg ?? null,
        lastQuarterPriceTargetCount: input.lastQuarterPriceTargetCount ?? null,
        lastYearPriceTargetAvg: input.lastYearPriceTargetAvg ?? null,
        lastYearPriceTargetCount: input.lastYearPriceTargetCount ?? null,
        allTimePriceTargetAvg: input.allTimePriceTargetAvg ?? null,
        allTimePriceTargetCount: input.allTimePriceTargetCount ?? null,
        analystCount: input.analystCount ?? null,
        ratingConsensus: nextRatingConsensus,
        strongBuyCount: input.strongBuyCount ?? null,
        buyCount: input.buyCount ?? null,
        holdCount: input.holdCount ?? null,
        sellCount: input.sellCount ?? null,
        strongSellCount: input.strongSellCount ?? null,
        upsidePercent: input.upsidePercent ?? null,
        raw: nextRaw,
      },
    });

    return {
      snapshot,
      created: false,
      updated: true,
    };
  }

  const snapshot = await prisma.analystSnapshot.create({
    data: {
      stockId: input.stockId,
      source: nextSource,
      capturedAt: input.capturedAt,
      priceTargetAverage: input.priceTargetAverage ?? null,
      priceTargetHigh: input.priceTargetHigh ?? null,
      priceTargetLow: input.priceTargetLow ?? null,
      priceTargetConsensus: input.priceTargetConsensus ?? null,
      targetMedian: input.targetMedian ?? null,
      lastMonthPriceTargetAvg: input.lastMonthPriceTargetAvg ?? null,
      lastMonthPriceTargetCount: input.lastMonthPriceTargetCount ?? null,
      lastQuarterPriceTargetAvg: input.lastQuarterPriceTargetAvg ?? null,
      lastQuarterPriceTargetCount: input.lastQuarterPriceTargetCount ?? null,
      lastYearPriceTargetAvg: input.lastYearPriceTargetAvg ?? null,
      lastYearPriceTargetCount: input.lastYearPriceTargetCount ?? null,
      allTimePriceTargetAvg: input.allTimePriceTargetAvg ?? null,
      allTimePriceTargetCount: input.allTimePriceTargetCount ?? null,
      analystCount: input.analystCount ?? null,
      ratingConsensus: nextRatingConsensus,
      strongBuyCount: input.strongBuyCount ?? null,
      buyCount: input.buyCount ?? null,
      holdCount: input.holdCount ?? null,
      sellCount: input.sellCount ?? null,
      strongSellCount: input.strongSellCount ?? null,
      upsidePercent: input.upsidePercent ?? null,
      raw: nextRaw,
    },
  });

  return {
    snapshot,
    created: true,
    updated: false,
  };
}

export async function getLatestAnalystSnapshot(
  stockId: string,
): Promise<AnalystSnapshot | null> {
  return prisma.analystSnapshot.findFirst({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function listAnalystSnapshots(
  stockId: string,
  limit?: number,
): Promise<AnalystSnapshot[]> {
  return prisma.analystSnapshot.findMany({
    where: { stockId },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}
