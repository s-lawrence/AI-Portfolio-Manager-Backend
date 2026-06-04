import {
  NewsProvider,
  ProviderDateRangeOptions,
  ProviderNewsArticle,
  normalizeProviderTickerOrThrow,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import { FmpJsonClient, FMP_PROVIDER_NAME, FmpClient } from "./fmp-client";
import { FmpStockNewsItem } from "./fmp.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed.replace(/[,_\s]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseDateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }

  return undefined;
}

function extractRecordArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is T => isRecord(item));
  }

  if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      return payload.data.filter((item): item is T => isRecord(item));
    }

    return [payload as T];
  }

  return [];
}

function formatDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeLimit(limit?: number): number | undefined {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return undefined;
  }

  const normalized = Math.floor(limit);
  if (normalized <= 0) {
    return undefined;
  }

  return normalized;
}

function sortNewestFirst(left: ProviderNewsArticle, right: ProviderNewsArticle): number {
  return right.publishedAt.getTime() - left.publishedAt.getTime();
}

export class FmpNewsProvider implements NewsProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async getCompanyNews(
    ticker: string,
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderNewsArticle[]> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const query: Record<string, string | number> = {
      symbols: normalizedTicker,
    };

    if (options.from) {
      query.from = formatDateOnly(options.from);
    }

    if (options.to) {
      query.to = formatDateOnly(options.to);
    }

    const normalizedLimit = normalizeLimit(options.limit);
    if (normalizedLimit) {
      query.limit = normalizedLimit;
    }

    const items = await this.fetchEndpointItems<FmpStockNewsItem>(
      "/news/stock",
      query,
    );

    const deduped = new Map<string, ProviderNewsArticle>();

    for (const item of items) {
      const mapped = this.mapNewsItem(item, normalizedTicker);
      if (!mapped) {
        continue;
      }

      if (!deduped.has(mapped.url)) {
        deduped.set(mapped.url, mapped);
      }
    }

    const mapped = Array.from(deduped.values()).sort(sortNewestFirst);

    if (!normalizedLimit || mapped.length <= normalizedLimit) {
      return mapped;
    }

    return mapped.slice(0, normalizedLimit);
  }

  private async fetchEndpointItems<T>(
    endpoint: string,
    query: Record<string, string | number>,
  ): Promise<T[]> {
    try {
      const payload = await this.client.getJson<unknown>(endpoint, query);
      return extractRecordArray<T>(payload);
    } catch (error) {
      return this.handleEndpointFailure(error, endpoint);
    }
  }

  private handleEndpointFailure(error: unknown, endpoint: string): [] {
    if (error instanceof ProviderRequestError) {
      if (error.statusCode === 404) {
        return [];
      }

      if (error.statusCode === 401 || error.statusCode === 403) {
        throw new ProviderConfigurationError(
          FMP_PROVIDER_NAME,
          `${FMP_PROVIDER_NAME} API key is invalid or unauthorized.`,
          {
            endpoint,
            statusCode: error.statusCode,
            cause: error,
          },
        );
      }

      if (error.statusCode === 429) {
        throw new ProviderRateLimitError(
          FMP_PROVIDER_NAME,
          `${FMP_PROVIDER_NAME} rate limit exceeded.`,
          {
            endpoint,
            statusCode: error.statusCode,
            cause: error,
          },
        );
      }

      throw error;
    }

    if (error instanceof ProviderConfigurationError || error instanceof ProviderRateLimitError) {
      throw error;
    }

    throw error;
  }

  private mapNewsItem(
    item: FmpStockNewsItem,
    ticker: string,
  ): ProviderNewsArticle | null {
    const headline = toStringOrUndefined(item.headline ?? item.title);
    const url = toStringOrUndefined(item.url);
    const publishedAt = parseDateValue(item.publishedAt ?? item.publishedDate ?? item.date);

    if (!headline || !url || !publishedAt) {
      return null;
    }

    return {
      ticker,
      headline,
      source: toStringOrUndefined(item.source ?? item.site),
      author: toStringOrUndefined(item.author),
      url,
      publishedAt,
      summary: toStringOrUndefined(item.text ?? item.content),
      rawExcerpt: toStringOrUndefined(item.content ?? item.text),
      sentiment: toStringOrUndefined(item.sentiment),
      sentimentScore: toFiniteNumber(item.sentimentScore),
      isDemo: false,
    };
  }
}
