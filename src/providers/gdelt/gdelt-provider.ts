import {
  GeopoliticalProvider,
  ProviderGeopoliticalEvent,
  ProviderGeopoliticalSearchOptions,
} from "../types";
import { GdeltJsonClient, GDELT_PROVIDER_NAME, GdeltClient } from "./gdelt-client";
import { GdeltDocArticle, GdeltDocResponse } from "./gdelt.types";

const DEFAULT_QUERY_LIMIT = 25;
const MAX_QUERY_LIMIT = 100;

const DEFAULT_GLOBAL_RISK_QUERIES = [
  "geopolitical risk",
  "war OR conflict OR sanctions",
  "oil supply disruption OR energy crisis",
  "central bank OR inflation OR recession",
  "trade war OR tariffs",
  "cyber attack OR critical infrastructure",
  "Canada economy OR Canadian dollar",
  "United States economy OR Federal Reserve",
] as const;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parsePublishedAt(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string") {
    const compact = value.trim();

    if (/^\d{14}$/.test(compact)) {
      const year = Number(compact.slice(0, 4));
      const month = Number(compact.slice(4, 6)) - 1;
      const day = Number(compact.slice(6, 8));
      const hours = Number(compact.slice(8, 10));
      const minutes = Number(compact.slice(10, 12));
      const seconds = Number(compact.slice(12, 14));
      const parsed = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const timestamp = Date.parse(compact);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }

  return null;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }

  return Math.min(normalized, MAX_QUERY_LIMIT);
}

function formatGdeltDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function sentimentFromTone(tone: number | null): "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null {
  if (tone == null) {
    return null;
  }

  if (tone > 1) {
    return "POSITIVE";
  }

  if (tone < -1) {
    return "NEGATIVE";
  }

  return "NEUTRAL";
}

function inferThemeFromQuery(query: string): string {
  const normalized = query.toLowerCase();

  if (normalized.includes("sanction") || normalized.includes("war") || normalized.includes("conflict")) {
    return "GEOPOLITICAL_CONFLICT";
  }

  if (normalized.includes("oil") || normalized.includes("energy")) {
    return "ENERGY_SUPPLY";
  }

  if (normalized.includes("inflation") || normalized.includes("recession") || normalized.includes("central bank") || normalized.includes("federal reserve")) {
    return "MACRO_POLICY";
  }

  if (normalized.includes("trade") || normalized.includes("tariff")) {
    return "TRADE_POLICY";
  }

  if (normalized.includes("cyber") || normalized.includes("infrastructure")) {
    return "CYBER_RISK";
  }

  if (normalized.includes("canada") || normalized.includes("canadian dollar") || normalized.includes("united states")) {
    return "NORTH_AMERICA_MACRO";
  }

  return "GLOBAL_RISK";
}

function inferCategoryFromQuery(query: string): string {
  const normalized = query.toLowerCase();

  if (normalized.includes("war") || normalized.includes("conflict") || normalized.includes("sanction")) {
    return "CONFLICT";
  }

  if (normalized.includes("oil") || normalized.includes("energy")) {
    return "ENERGY";
  }

  if (normalized.includes("inflation") || normalized.includes("recession") || normalized.includes("central bank") || normalized.includes("federal reserve")) {
    return "MACRO";
  }

  if (normalized.includes("trade") || normalized.includes("tariff")) {
    return "TRADE";
  }

  if (normalized.includes("cyber") || normalized.includes("infrastructure")) {
    return "CYBER";
  }

  return "GEOPOLITICAL";
}

function normalizeQueryList(options: ProviderGeopoliticalSearchOptions): string[] {
  const all = [
    ...(options.query ? [options.query] : []),
    ...(Array.isArray(options.queries) ? options.queries : []),
  ];

  const dedup = new Set<string>();
  for (const query of all) {
    const normalized = query.trim();
    if (normalized) {
      dedup.add(normalized);
    }
  }

  return Array.from(dedup);
}

function mapDocArticle(
  query: string,
  article: GdeltDocArticle,
): ProviderGeopoliticalEvent | null {
  const title = typeof article.title === "string" ? article.title.trim() : "";
  if (!title) {
    return null;
  }

  const publishedAt = parsePublishedAt(article.seendate);
  if (!publishedAt) {
    return null;
  }

  const tone = toFiniteNumber(article.tone);
  const sentiment = sentimentFromTone(tone);
  const rawSubset = {
    title: article.title,
    url: article.url,
    domain: article.domain,
    seendate: article.seendate,
    sourcecountry: article.sourcecountry,
    language: article.language,
    tone: article.tone,
    socialimage: article.socialimage,
  };

  return {
    provider: "GDELT",
    source: article.domain ?? null,
    sourceCountry: article.sourcecountry ?? null,
    title,
    url: article.url ?? null,
    domain: article.domain ?? null,
    language: article.language ?? null,
    publishedAt,
    query,
    theme: inferThemeFromQuery(query),
    category: inferCategoryFromQuery(query),
    tone,
    sentiment,
    relevanceScore: null,
    raw: rawSubset,
  };
}

export class GdeltProvider implements GeopoliticalProvider {
  constructor(private readonly client: GdeltJsonClient = new GdeltClient()) {}

  async searchDocArticles(
    options: ProviderGeopoliticalSearchOptions,
  ): Promise<ProviderGeopoliticalEvent[]> {
    const queries = normalizeQueryList(options);
    if (queries.length === 0) {
      throw new Error("At least one GDELT query is required.");
    }

    const to = options.to ?? new Date();
    const from = options.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const perQueryLimit = normalizeLimit(
      options.maxRecordsPerQuery ?? options.maxRecords,
      DEFAULT_QUERY_LIMIT,
    );

    const all: ProviderGeopoliticalEvent[] = [];

    for (const query of queries) {
      const payload = await this.client.getJson<GdeltDocResponse>("/doc/doc", {
        query,
        mode: "ArtList",
        format: "json",
        maxrecords: perQueryLimit,
        startdatetime: formatGdeltDate(from),
        enddatetime: formatGdeltDate(to),
        sort: "HybridRel",
      });

      const articles = Array.isArray(payload.articles) ? payload.articles : [];
      for (const article of articles) {
        const mapped = mapDocArticle(query, article);
        if (mapped) {
          all.push(mapped);
        }
      }
    }

    const dedupeByUrl = new Map<string, ProviderGeopoliticalEvent>();
    const withoutUrl: ProviderGeopoliticalEvent[] = [];

    for (const item of all) {
      const url = item.url?.trim();
      if (url) {
        if (!dedupeByUrl.has(url)) {
          dedupeByUrl.set(url, item);
        }
        continue;
      }

      withoutUrl.push(item);
    }

    return [...dedupeByUrl.values(), ...withoutUrl].sort(
      (left, right) => right.publishedAt.getTime() - left.publishedAt.getTime(),
    );
  }

  async getDefaultGlobalRiskEvents(
    options: Omit<ProviderGeopoliticalSearchOptions, "query" | "queries"> = {},
  ): Promise<ProviderGeopoliticalEvent[]> {
    const events = await this.searchDocArticles({
      ...options,
      queries: [...DEFAULT_GLOBAL_RISK_QUERIES],
      maxRecordsPerQuery: normalizeLimit(options.maxRecordsPerQuery, DEFAULT_QUERY_LIMIT),
    });

    const maxRecords = normalizeLimit(options.maxRecords, DEFAULT_QUERY_LIMIT * 4);
    return events.slice(0, maxRecords);
  }
}

export { DEFAULT_GLOBAL_RISK_QUERIES, GDELT_PROVIDER_NAME };
