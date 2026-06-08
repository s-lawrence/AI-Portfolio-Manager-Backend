import { GeopoliticalEvent, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export type UpsertGeopoliticalEventInput = Omit<
  Prisma.GeopoliticalEventUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

export interface GeopoliticalEventFilters {
  from?: Date;
  to?: Date;
  days?: number;
  limit?: number;
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

function toNullableString(value?: string | null): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasUsableUrl(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function upsertGeopoliticalEvent(
  input: UpsertGeopoliticalEventInput,
): Promise<{ event: GeopoliticalEvent; created: boolean; updated: boolean }> {
  const url = hasUsableUrl(input.url) ? input.url.trim() : null;

  const createData: Prisma.GeopoliticalEventUncheckedCreateInput = {
    provider: input.provider,
    source: toNullableString(input.source),
    sourceCountry: toNullableString(input.sourceCountry),
    title: input.title,
    url,
    domain: toNullableString(input.domain),
    language: toNullableString(input.language),
    publishedAt: input.publishedAt,
    query: toNullableString(input.query),
    theme: toNullableString(input.theme),
    category: toNullableString(input.category),
    tone: input.tone ?? null,
    sentiment: toNullableString(input.sentiment),
    relevanceScore: input.relevanceScore ?? null,
    countries: toPersistedJson(input.countries),
    organizations: toPersistedJson(input.organizations),
    persons: toPersistedJson(input.persons),
    locations: toPersistedJson(input.locations),
    raw: toPersistedJson(input.raw),
  };

  const updateData: Prisma.GeopoliticalEventUncheckedUpdateInput = {
    source: createData.source,
    sourceCountry: createData.sourceCountry,
    title: createData.title,
    domain: createData.domain,
    language: createData.language,
    query: createData.query,
    theme: createData.theme,
    category: createData.category,
    tone: createData.tone,
    sentiment: createData.sentiment,
    relevanceScore: createData.relevanceScore,
    countries: createData.countries,
    organizations: createData.organizations,
    persons: createData.persons,
    locations: createData.locations,
    raw: createData.raw,
  };

  if (url) {
    const existingByUrl = await prisma.geopoliticalEvent.findUnique({
      where: { url },
    });

    if (existingByUrl) {
      const event = await prisma.geopoliticalEvent.update({
        where: { id: existingByUrl.id },
        data: updateData,
      });

      return {
        event,
        created: false,
        updated: true,
      };
    }
  }

  const existingByComposite = await prisma.geopoliticalEvent.findUnique({
    where: {
      provider_title_publishedAt: {
        provider: input.provider,
        title: input.title,
        publishedAt: input.publishedAt,
      },
    },
  });

  if (existingByComposite) {
    const event = await prisma.geopoliticalEvent.update({
      where: { id: existingByComposite.id },
      data: {
        ...updateData,
        url: url ?? existingByComposite.url,
      },
    });

    return {
      event,
      created: false,
      updated: true,
    };
  }

  const event = await prisma.geopoliticalEvent.create({
    data: createData,
  });

  return {
    event,
    created: true,
    updated: false,
  };
}

export async function getLatestGeopoliticalEvents(
  options: GeopoliticalEventFilters = {},
): Promise<GeopoliticalEvent[]> {
  const now = new Date();
  const from =
    options.from ??
    (typeof options.days === "number" && options.days > 0
      ? new Date(now.getTime() - Math.floor(options.days) * 24 * 60 * 60 * 1000)
      : undefined);

  return prisma.geopoliticalEvent.findMany({
    where: {
      publishedAt:
        from || options.to
          ? {
              ...(from ? { gte: from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            }
          : undefined,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(options.limit),
  });
}

export async function listGeopoliticalEventsByCategory(
  category: string,
  limit?: number,
): Promise<GeopoliticalEvent[]> {
  const normalizedCategory = category.trim().toUpperCase();

  return prisma.geopoliticalEvent.findMany({
    where: {
      category: normalizedCategory,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}

export async function listGeopoliticalEventsByTheme(
  theme: string,
  limit?: number,
): Promise<GeopoliticalEvent[]> {
  const normalizedTheme = theme.trim().toUpperCase();

  return prisma.geopoliticalEvent.findMany({
    where: {
      theme: normalizedTheme,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: normalizeListLimit(limit),
  });
}

export async function countRecentGeopoliticalEvents(
  options: GeopoliticalEventFilters = {},
): Promise<number> {
  const now = new Date();
  const from =
    options.from ??
    (typeof options.days === "number" && options.days > 0
      ? new Date(now.getTime() - Math.floor(options.days) * 24 * 60 * 60 * 1000)
      : undefined);

  return prisma.geopoliticalEvent.count({
    where: {
      publishedAt:
        from || options.to
          ? {
              ...(from ? { gte: from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            }
          : undefined,
    },
  });
}
