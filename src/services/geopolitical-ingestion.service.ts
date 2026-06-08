import { Prisma } from "@prisma/client";

import { gdeltProvider } from "../providers/gdelt";
import {
  ProviderGeopoliticalEvent,
  ProviderGeopoliticalSearchOptions,
} from "../providers/types";
import {
  countRecentGeopoliticalEvents,
  getLatestGeopoliticalEvents,
  upsertGeopoliticalEvent,
} from "../repositories/geopolitical-events.repository";
import {
  GdeltDefaultRiskIngestionOptions,
  GdeltIngestionOptions,
  GeopoliticalSummaryResult,
  IngestDefaultGdeltRiskSetResult,
  IngestGeopoliticalQueryResult,
  LatestGeopoliticalContextResult,
} from "../types/services";

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_SUMMARY_EVENTS = 250;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function calculateDurationMs(startedAtDate: Date, finishedAtDate: Date): number {
  return Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }

  return normalized;
}

function resolveTimeWindow(options: { from?: Date; to?: Date; days?: number }): {
  from: Date;
  to: Date;
} {
  const to = options.to ?? new Date();

  if (options.from) {
    return {
      from: options.from,
      to,
    };
  }

  const lookbackDays = normalizePositiveInteger(options.days, DEFAULT_LOOKBACK_DAYS);

  return {
    from: new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000),
    to,
  };
}

function toPersistedJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}

function toBoundedTopCounts(
  counts: Map<string, number>,
  limit: number,
): Array<{ key: string; count: number }> {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function toSearchOptions(args: {
  query?: string;
  queries?: string[];
  from?: Date;
  to?: Date;
  maxRecords?: number;
  maxRecordsPerQuery?: number;
}): ProviderGeopoliticalSearchOptions {
  return {
    query: args.query,
    queries: args.queries,
    from: args.from,
    to: args.to,
    maxRecords: args.maxRecords,
    maxRecordsPerQuery: args.maxRecordsPerQuery,
  };
}

async function persistGeopoliticalEvents(
  events: ProviderGeopoliticalEvent[],
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    if (!event.title?.trim()) {
      skipped += 1;
      continue;
    }

    if (!(event.publishedAt instanceof Date) || Number.isNaN(event.publishedAt.getTime())) {
      skipped += 1;
      continue;
    }

    const result = await upsertGeopoliticalEvent({
      provider: event.provider,
      source: event.source ?? null,
      sourceCountry: event.sourceCountry ?? null,
      title: event.title.trim(),
      url: event.url ?? null,
      domain: event.domain ?? null,
      language: event.language ?? null,
      publishedAt: event.publishedAt,
      query: event.query ?? null,
      theme: event.theme ? event.theme.trim().toUpperCase() : null,
      category: event.category ? event.category.trim().toUpperCase() : null,
      tone: event.tone ?? null,
      sentiment: event.sentiment ? event.sentiment.trim().toUpperCase() : null,
      relevanceScore: event.relevanceScore ?? null,
      countries: toPersistedJson(event.countries),
      organizations: toPersistedJson(event.organizations),
      persons: toPersistedJson(event.persons),
      locations: toPersistedJson(event.locations),
      raw: toPersistedJson(event.raw),
    });

    if (result.created) {
      created += 1;
    } else if (result.updated) {
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return { created, updated, skipped };
}

export async function ingestGdeltQuery(
  query: string,
  options: GdeltIngestionOptions = {},
): Promise<IngestGeopoliticalQueryResult> {
  const normalizedQuery = assertNonBlank(query, "query");

  const events = await gdeltProvider.searchDocArticles(
    toSearchOptions({
      query: normalizedQuery,
      from: options.from,
      to: options.to,
      maxRecords: options.maxRecords,
      maxRecordsPerQuery: options.maxRecords,
    }),
  );

  const persisted = await persistGeopoliticalEvents(events);
  const warnings: string[] = [];

  if (events.length === 0) {
    warnings.push(`No GDELT articles returned for query: ${normalizedQuery}`);
  }

  return {
    query: normalizedQuery,
    eventsCreated: persisted.created,
    eventsUpdated: persisted.updated,
    eventsSkipped: persisted.skipped,
    warnings,
  };
}

export async function ingestDefaultGdeltRiskSet(
  options: GdeltDefaultRiskIngestionOptions = {},
): Promise<IngestDefaultGdeltRiskSetResult> {
  const startedAtDate = new Date();
  const timeWindow = resolveTimeWindow({
    from: options.from,
    to: options.to,
    days: options.from || options.to ? undefined : DEFAULT_LOOKBACK_DAYS,
  });

  const queries = options.queries?.filter((value) => value.trim().length > 0);
  const warnings: string[] = [];
  const failedQueries: Array<{ query: string; reason: string }> = [];
  const results: IngestGeopoliticalQueryResult[] = [];

  if (queries && queries.length > 0) {
    for (const query of queries) {
      try {
        const result = await ingestGdeltQuery(query, {
          from: timeWindow.from,
          to: timeWindow.to,
          maxRecords: options.maxRecordsPerQuery,
        });
        results.push(result);
        warnings.push(...result.warnings.map((warning) => `${query}: ${warning}`));
      } catch (error) {
        failedQueries.push({ query, reason: toErrorReason(error) });
      }
    }
  } else {
    try {
      const events = await gdeltProvider.getDefaultGlobalRiskEvents(
        toSearchOptions({
          from: timeWindow.from,
          to: timeWindow.to,
          maxRecords: options.maxRecords,
          maxRecordsPerQuery: options.maxRecordsPerQuery,
        }),
      );

      const persisted = await persistGeopoliticalEvents(events);
      results.push({
        query: "DEFAULT_GLOBAL_RISK_SET",
        eventsCreated: persisted.created,
        eventsUpdated: persisted.updated,
        eventsSkipped: persisted.skipped,
        warnings: events.length === 0 ? ["No GDELT articles returned for default global risk set."] : [],
      });

      if (events.length === 0) {
        warnings.push("No GDELT articles returned for default global risk set.");
      }
    } catch (error) {
      failedQueries.push({
        query: "DEFAULT_GLOBAL_RISK_SET",
        reason: toErrorReason(error),
      });
    }
  }

  const finishedAtDate = new Date();

  return {
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    queriesProcessed: results.length + failedQueries.length,
    queriesFailed: failedQueries.length,
    eventsCreated: results.reduce((sum, item) => sum + item.eventsCreated, 0),
    eventsUpdated: results.reduce((sum, item) => sum + item.eventsUpdated, 0),
    eventsSkipped: results.reduce((sum, item) => sum + item.eventsSkipped, 0),
    warnings,
    failedQueries,
    results,
  };
}

export async function getLatestGeopoliticalContext(options: {
  limit?: number;
  from?: Date;
  to?: Date;
  days?: number;
} = {}): Promise<LatestGeopoliticalContextResult> {
  const timeWindow = resolveTimeWindow({
    from: options.from,
    to: options.to,
    days: options.days,
  });

  const items = await getLatestGeopoliticalEvents({
    from: timeWindow.from,
    to: timeWindow.to,
    limit: options.limit,
  });

  return {
    from: timeWindow.from.toISOString(),
    to: timeWindow.to.toISOString(),
    items,
  };
}

export async function getGeopoliticalSummary(options: {
  days?: number;
  limit?: number;
  from?: Date;
  to?: Date;
} = {}): Promise<GeopoliticalSummaryResult> {
  const timeWindow = resolveTimeWindow({
    from: options.from,
    to: options.to,
    days: options.days,
  });

  const totalEvents = await countRecentGeopoliticalEvents({
    from: timeWindow.from,
    to: timeWindow.to,
  });

  const items = await getLatestGeopoliticalEvents({
    from: timeWindow.from,
    to: timeWindow.to,
    limit: normalizePositiveInteger(options.limit, MAX_SUMMARY_EVENTS),
  });

  const categoryCounts = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  const sentimentMix = {
    positive: 0,
    neutral: 0,
    negative: 0,
    unknown: 0,
  };

  for (const item of items) {
    if (item.category) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
    }

    if (item.theme) {
      themeCounts.set(item.theme, (themeCounts.get(item.theme) ?? 0) + 1);
    }

    if (item.sourceCountry) {
      countryCounts.set(item.sourceCountry, (countryCounts.get(item.sourceCountry) ?? 0) + 1);
    }

    if (item.domain) {
      domainCounts.set(item.domain, (domainCounts.get(item.domain) ?? 0) + 1);
    }

    if (item.sentiment === "POSITIVE") {
      sentimentMix.positive += 1;
    } else if (item.sentiment === "NEGATIVE") {
      sentimentMix.negative += 1;
    } else if (item.sentiment === "NEUTRAL") {
      sentimentMix.neutral += 1;
    } else {
      sentimentMix.unknown += 1;
    }
  }

  const topHeadlines = items.slice(0, 5).map((item) => ({
    title: item.title,
    publishedAt: item.publishedAt.toISOString(),
    source: item.source,
    domain: item.domain,
    sentiment: item.sentiment,
  }));

  return {
    from: timeWindow.from.toISOString(),
    to: timeWindow.to.toISOString(),
    totalEvents,
    countsByCategory: toBoundedTopCounts(categoryCounts, 5),
    countsByTheme: toBoundedTopCounts(themeCounts, 5),
    sentimentMix,
    topHeadlines,
    topCountries: toBoundedTopCounts(countryCounts, 5),
    topDomains: toBoundedTopCounts(domainCounts, 5),
  };
}
