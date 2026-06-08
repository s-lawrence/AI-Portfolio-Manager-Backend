import { AnalystActionEvent, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";

export type UpsertAnalystActionEventInput = Omit<
  Prisma.AnalystActionEventUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

export interface ListRecentAnalystActionsFilters {
  stockId?: string;
  ticker?: string;
  actionType?: string;
  from?: Date;
  to?: Date;
}

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

export async function upsertAnalystActionEvent(
  input: UpsertAnalystActionEventInput,
): Promise<{ event: AnalystActionEvent; created: boolean; updated: boolean }> {
  const existing = await prisma.analystActionEvent.findFirst({
    where: {
      stockId: input.stockId,
      eventDate: input.eventDate,
      actionType: input.actionType,
      firm: input.firm ?? null,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const nextSource = input.source ?? null;
  const nextFirm = input.firm ?? null;
  const nextAnalystName = input.analystName ?? null;
  const nextPreviousRating = input.previousRating ?? null;
  const nextNewRating = input.newRating ?? null;
  const nextHeadline = input.headline ?? null;
  const nextUrl = input.url ?? null;
  const nextRawComparable = toComparableJson(input.raw);
  const nextRaw = toPersistedJson(input.raw);

  if (existing) {
    const unchanged =
      existing.source === nextSource &&
      existing.firm === nextFirm &&
      existing.analystName === nextAnalystName &&
      existing.previousRating === nextPreviousRating &&
      existing.newRating === nextNewRating &&
      existing.previousPriceTarget === (input.previousPriceTarget ?? null) &&
      existing.newPriceTarget === (input.newPriceTarget ?? null) &&
      existing.headline === nextHeadline &&
      existing.url === nextUrl &&
      isSameJson(existing.raw as Prisma.JsonValue | null, nextRawComparable);

    if (unchanged) {
      return {
        event: existing,
        created: false,
        updated: false,
      };
    }

    const event = await prisma.analystActionEvent.update({
      where: { id: existing.id },
      data: {
        source: nextSource,
        firm: nextFirm,
        analystName: nextAnalystName,
        previousRating: nextPreviousRating,
        newRating: nextNewRating,
        previousPriceTarget: input.previousPriceTarget ?? null,
        newPriceTarget: input.newPriceTarget ?? null,
        headline: nextHeadline,
        url: nextUrl,
        raw: nextRaw,
      },
    });

    return {
      event,
      created: false,
      updated: true,
    };
  }

  const event = await prisma.analystActionEvent.create({
    data: {
      stockId: input.stockId,
      source: nextSource,
      actionType: input.actionType,
      firm: nextFirm,
      analystName: nextAnalystName,
      previousRating: nextPreviousRating,
      newRating: nextNewRating,
      previousPriceTarget: input.previousPriceTarget ?? null,
      newPriceTarget: input.newPriceTarget ?? null,
      eventDate: input.eventDate,
      headline: nextHeadline,
      url: nextUrl,
      raw: nextRaw,
    },
  });

  return {
    event,
    created: true,
    updated: false,
  };
}

export async function listAnalystActionsByStock(
  stockId: string,
  limit?: number,
): Promise<AnalystActionEvent[]> {
  return prisma.analystActionEvent.findMany({
    where: { stockId },
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}

export async function listRecentAnalystActions(
  limit?: number,
  filters: ListRecentAnalystActionsFilters = {},
): Promise<AnalystActionEvent[]> {
  return prisma.analystActionEvent.findMany({
    where: {
      ...(filters.stockId ? { stockId: filters.stockId } : {}),
      ...(filters.ticker
        ? {
            stock: {
              ticker: normalizeTickerOrThrow(filters.ticker),
            },
          }
        : {}),
      ...(filters.actionType ? { actionType: filters.actionType.trim().toUpperCase() } : {}),
      eventDate:
        filters.from || filters.to
          ? {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            }
          : undefined,
    },
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}
