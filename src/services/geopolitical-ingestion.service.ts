import { Prisma } from "@prisma/client";

import { env } from "../config/env";
import { gdeltProvider } from "../providers/gdelt";
import {
  GDELT_FAILURE_CODES,
  GdeltFailureCode,
} from "../providers/gdelt/gdelt-client";
import { ProviderRequestError, ProviderResponseError } from "../providers/errors";
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
  GdeltQueryProfile,
  GdeltQueryAuditResult,
  GdeltQueryFailureDetail,
  GdeltResponseDiagnosticItem,
  GeopoliticalSummaryResult,
  IngestDefaultGdeltRiskSetResult,
  IngestGeopoliticalQueryResult,
  LatestGeopoliticalContextResult,
} from "../types/services";

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_SUMMARY_EVENTS = 250;
const DEFAULT_GDELT_MAX_RECORDS_PER_QUERY = 10;
const NON_PRODUCTION = env.NODE_ENV !== "production";

type GdeltErrorCause = {
  failureCode?: string;
  retryAttempted?: boolean;
  responseDiagnostics?: {
    statusCode?: number;
    contentType?: string | null;
    contentLength?: number;
    responsePreview?: string;
    retryAttempted?: boolean;
  };
};

const QUERY_PROFILE_USE_CASES = {
  portfolioRisk: "Broad market and geopolitical risk context for portfolio-level exposure.",
  macroRisk: "Macro/economic risk context for rates, inflation, growth, and energy pressure.",
  tickerCompanyRisk: "Company-specific risk context for one issuer using name/ticker + risk terms.",
  sectorRisk: "Sector-specific risk context for industry-level risk monitoring.",
} as const;

const PORTFOLIO_RISK_QUERY =
  "sanctions OR conflict OR war OR tariffs OR supply chain OR central bank OR inflation OR oil prices";
const MACRO_RISK_QUERY =
  "Federal Reserve OR inflation OR interest rates OR oil prices OR recession OR unemployment";

function quoteForGdeltQuery(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\"/g, "")
    .replace(/[()]/g, "")
    .trim();
}

function toTickerCompanyRiskQuery(ticker?: string, companyName?: string): string {
  const identity = quoteForGdeltQuery(companyName?.trim() || ticker?.trim() || "");
  if (!identity) {
    throw new Error("ticker or companyName is required for tickerCompanyRisk profile.");
  }

  return `"${identity}" AND (risk OR lawsuit OR investigation OR downgrade OR debt OR strike OR recall OR disruption OR sanctions)`;
}

function toSectorRiskQuery(sector?: string): string {
  const normalized = quoteForGdeltQuery(sector?.trim() ?? "");
  if (!normalized) {
    throw new Error("sector is required for sectorRisk profile.");
  }

  return `"${normalized}" AND (risk OR regulation OR disruption OR demand shock OR supply chain OR layoffs)`;
}

export function buildGdeltQueryProfiles(options: {
  lookbackDays?: number;
  maxRecordsPerQuery?: number;
  includePortfolioRisk?: boolean;
  includeMacroRisk?: boolean;
  ticker?: string;
  companyName?: string;
  sector?: string;
} = {}): GdeltQueryProfile[] {
  const lookbackDays = normalizePositiveInteger(options.lookbackDays, DEFAULT_LOOKBACK_DAYS);
  const maxRecords = normalizePositiveInteger(
    options.maxRecordsPerQuery,
    DEFAULT_GDELT_MAX_RECORDS_PER_QUERY,
  );

  const includePortfolioRisk = options.includePortfolioRisk ?? true;
  const includeMacroRisk = options.includeMacroRisk ?? true;
  const profiles: GdeltQueryProfile[] = [];

  if (includePortfolioRisk) {
    profiles.push({
      queryProfile: "portfolioRisk",
      query: PORTFOLIO_RISK_QUERY,
      lookbackDays,
      maxRecords,
      expectedUseCase: QUERY_PROFILE_USE_CASES.portfolioRisk,
    });
  }

  if (includeMacroRisk) {
    profiles.push({
      queryProfile: "macroRisk",
      query: MACRO_RISK_QUERY,
      lookbackDays,
      maxRecords,
      expectedUseCase: QUERY_PROFILE_USE_CASES.macroRisk,
    });
  }

  if ((options.ticker && options.ticker.trim()) || (options.companyName && options.companyName.trim())) {
    profiles.push({
      queryProfile: "tickerCompanyRisk",
      query: toTickerCompanyRiskQuery(options.ticker, options.companyName),
      lookbackDays,
      maxRecords,
      expectedUseCase: QUERY_PROFILE_USE_CASES.tickerCompanyRisk,
    });
  }

  if (options.sector && options.sector.trim()) {
    profiles.push({
      queryProfile: "sectorRisk",
      query: toSectorRiskQuery(options.sector),
      lookbackDays,
      maxRecords,
      expectedUseCase: QUERY_PROFILE_USE_CASES.sectorRisk,
    });
  }

  return profiles;
}

function randomInt(min: number, max: number): number {
  const boundedMin = Math.ceil(min);
  const boundedMax = Math.floor(max);
  if (boundedMax <= boundedMin) {
    return boundedMin;
  }

  return Math.floor(Math.random() * (boundedMax - boundedMin + 1)) + boundedMin;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toDefaultFailureCode(error: unknown): GdeltFailureCode {
  if (error instanceof ProviderRequestError) {
    const message = error.message.toLowerCase();
    if (message.includes("timed out")) {
      return GDELT_FAILURE_CODES.TIMEOUT;
    }

    return GDELT_FAILURE_CODES.HTTP_ERROR;
  }

  if (error instanceof ProviderResponseError) {
    const message = error.message.toLowerCase();
    if (message.includes("non-json")) {
      return GDELT_FAILURE_CODES.NON_JSON_RESPONSE;
    }

    if (message.includes("empty response")) {
      return GDELT_FAILURE_CODES.EMPTY_RESPONSE;
    }

    if (message.includes("invalid json")) {
      return GDELT_FAILURE_CODES.PARSE_ERROR;
    }

    return GDELT_FAILURE_CODES.PARSE_ERROR;
  }

  return GDELT_FAILURE_CODES.HTTP_ERROR;
}

function toQueryFailureDetail(
  query: string,
  error: unknown,
): GdeltQueryFailureDetail & { responseDiagnostic?: GdeltResponseDiagnosticItem } {
  const providerStatusCode =
    error instanceof ProviderRequestError || error instanceof ProviderResponseError
      ? error.statusCode
      : undefined;
  const providerCause =
    error instanceof ProviderRequestError || error instanceof ProviderResponseError
      ? (error.cause as GdeltErrorCause | undefined)
      : undefined;

  const failureCode =
    typeof providerCause?.failureCode === "string" && providerCause.failureCode.trim().length > 0
      ? providerCause.failureCode
      : toDefaultFailureCode(error);

  const responseDiagnostic: GdeltResponseDiagnosticItem | undefined = providerCause?.responseDiagnostics
    ? {
        query,
        failureCode,
        statusCode: providerCause.responseDiagnostics.statusCode ?? providerStatusCode,
        contentType: providerCause.responseDiagnostics.contentType,
        contentLength: providerCause.responseDiagnostics.contentLength,
        responsePreview: providerCause.responseDiagnostics.responsePreview,
        retryAttempted:
          providerCause.responseDiagnostics.retryAttempted ?? providerCause.retryAttempted,
      }
    : undefined;

  return {
    query,
    reason: toErrorReason(error),
    failureCode,
    statusCode: providerStatusCode,
    retryAttempted: Boolean(providerCause?.retryAttempted),
    responseDiagnostic,
  };
}

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
  queryProfile?: string;
  queries?: string[];
  from?: Date;
  to?: Date;
  maxRecords?: number;
  maxRecordsPerQuery?: number;
}): ProviderGeopoliticalSearchOptions {
  return {
    query: args.query,
    queryProfile: args.queryProfile,
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
      queryProfile: options.queryProfile,
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
    queryProfile: options.queryProfile,
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

  const mode = options.mode ?? "full";
  const warnings: string[] = [];
  const failedQueries: GdeltQueryFailureDetail[] = [];
  const results: IngestGeopoliticalQueryResult[] = [];
  const responseDiagnostics: GdeltResponseDiagnosticItem[] = [];

  const effectivePerQueryMaxRecords = normalizePositiveInteger(
    options.maxRecordsPerQuery,
    DEFAULT_GDELT_MAX_RECORDS_PER_QUERY,
  );

  const queryProfiles: GdeltQueryProfile[] =
    options.queries && options.queries.length > 0
      ? options.queries
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .map((query, index) => ({
            queryProfile: `customQuery${index + 1}`,
            query,
            lookbackDays: DEFAULT_LOOKBACK_DAYS,
            maxRecords: effectivePerQueryMaxRecords,
            expectedUseCase: "Caller-provided GDELT query.",
          }))
      : buildGdeltQueryProfiles({
          lookbackDays: DEFAULT_LOOKBACK_DAYS,
          maxRecordsPerQuery: effectivePerQueryMaxRecords,
          includePortfolioRisk: true,
          includeMacroRisk: mode === "quick" || mode === "full",
        });

  if (queryProfiles.length === 0) {
    const fallbackQueries = gdeltProvider.getDefaultQueries(mode);
    for (const [index, query] of fallbackQueries.entries()) {
      queryProfiles.push({
        queryProfile: `legacyDefault${index + 1}`,
        query,
        lookbackDays: DEFAULT_LOOKBACK_DAYS,
        maxRecords: effectivePerQueryMaxRecords,
        expectedUseCase: "Legacy default global-risk fallback query.",
      });
    }
  }

  for (const [index, profile] of queryProfiles.entries()) {
    try {
      const result = await ingestGdeltQuery(profile.query, {
        queryProfile: profile.queryProfile,
        from: timeWindow.from,
        to: timeWindow.to,
        maxRecords: effectivePerQueryMaxRecords,
      });
      results.push(result);

      const eventsPersisted = result.eventsCreated + result.eventsUpdated;
      if (eventsPersisted === 0) {
        const noResultsDetail: GdeltQueryFailureDetail = {
          query: profile.query,
          reason: "No GDELT results persisted for query.",
          failureCode: GDELT_FAILURE_CODES.NO_RESULTS,
        };
        failedQueries.push(noResultsDetail);
        warnings.push(`${profile.query}: ${noResultsDetail.reason}`);
      }

      warnings.push(...result.warnings.map((warning) => `${profile.query}: ${warning}`));
    } catch (error) {
      const detail = toQueryFailureDetail(profile.query, error);
      failedQueries.push(detail);
      warnings.push(
        `${profile.query}: ${detail.reason}${detail.statusCode ? ` (status ${detail.statusCode})` : ""}${detail.retryAttempted ? " [retry attempted]" : ""}`,
      );

      if (NON_PRODUCTION && detail.responseDiagnostic) {
        responseDiagnostics.push(detail.responseDiagnostic);
      }
    }

    if (index < queryProfiles.length - 1) {
      const baseDelay = Math.max(0, env.GDELT_QUERY_DELAY_MS);
      const jitter = randomInt(0, 1000);
      await delay(baseDelay + jitter);
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
    queryProfiles,
    responseDiagnostics: NON_PRODUCTION && responseDiagnostics.length > 0 ? responseDiagnostics : undefined,
  };
}

export async function runGdeltQueryAudit(
  query: string,
  options: { maxRecords?: number; from?: Date; to?: Date } = {},
): Promise<GdeltQueryAuditResult> {
  const normalizedQuery = assertNonBlank(query, "query");
  const result = await gdeltProvider.auditDocQuery({
    query: normalizedQuery,
    maxRecords: options.maxRecords,
    maxRecordsPerQuery: options.maxRecords,
    from: options.from,
    to: options.to,
  });

  return {
    query: normalizedQuery,
    url: result.url,
    statusCode: result.statusCode,
    elapsedMs: result.elapsedMs,
    rawTopLevelKeys: result.rawTopLevelKeys,
    articleCount: result.articleCount,
    firstArticleKeys: result.firstArticleKeys,
    mappedEventCount: result.mappedEventCount,
    retryAttempted: result.retryAttempted,
    warnings: result.warnings,
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
    message:
      totalEvents === 0
        ? "No persisted GDELT events are currently available in local context for this window. This does not imply global risk is absent."
        : undefined,
    suggestedActions:
      totalEvents === 0
        ? [
            "Run refreshGdeltRiskContext (confirmation required) to populate local geopolitical context.",
          ]
        : undefined,
  };
}
