import {
  MarketDataProvider,
  ProviderDateRangeOptions,
  ProviderHistoricalPrice,
  ProviderQuote,
  normalizeProviderTickerOrThrow,
} from "../types";
import { ProviderNotFoundError, ProviderResponseError } from "../errors";
import { FmpJsonClient, FmpJsonQuery, FMP_PROVIDER_NAME, FmpClient } from "./fmp-client";
import {
  FmpHistoricalPriceFullResponse,
  FmpHistoricalPriceItem,
  FmpQuoteResponseItem,
} from "./fmp.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

    const parsed = Number(trimmed.replace(/[%(),]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }

  return undefined;
}

function toDateOnly(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const timestamp = Date.parse(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Date(timestamp);
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

function parseQuotePercent(item: FmpQuoteResponseItem): number | undefined {
  return toFiniteNumber(item.changesPercentage);
}

function isQuoteLikeRecord(value: unknown): value is FmpQuoteResponseItem {
  return isRecord(value) && (
    "symbol" in value ||
    "price" in value ||
    "close" in value ||
    "open" in value
  );
}

function extractQuoteItem(response: unknown): FmpQuoteResponseItem | null {
  if (Array.isArray(response)) {
    const first = response[0];
    return isQuoteLikeRecord(first) ? first : null;
  }

  if (isQuoteLikeRecord(response)) {
    return response;
  }

  return null;
}

function isHistoricalRowLike(value: unknown): value is FmpHistoricalPriceItem {
  return isRecord(value) && (
    "date" in value ||
    "close" in value ||
    "adjClose" in value ||
    "open" in value
  );
}

function extractHistoricalRows(response: unknown): FmpHistoricalPriceItem[] {
  if (Array.isArray(response)) {
    if (response.every((item) => isHistoricalRowLike(item))) {
      return response;
    }

    const first = response[0];
    if (isRecord(first)) {
      const firstWrapped = first as FmpHistoricalPriceFullResponse;
      if (Array.isArray(firstWrapped.historical)) {
        return firstWrapped.historical;
      }
    }

    return [];
  }

  if (isRecord(response)) {
    const wrapped = response as FmpHistoricalPriceFullResponse & { data?: unknown };

    if (Array.isArray(wrapped.historical)) {
      return wrapped.historical;
    }

    if (Array.isArray(wrapped.data)) {
      return wrapped.data.filter((item): item is FmpHistoricalPriceItem =>
        isHistoricalRowLike(item),
      );
    }
  }

  return [];
}

function mapHistoricalPrice(
  ticker: string,
  item: FmpHistoricalPriceItem,
): ProviderHistoricalPrice | null {
  const date = toDateOnly(item.date);
  const close = toFiniteNumber(item.close);

  if (!date || close === undefined) {
    return null;
  }

  return {
    ticker,
    date,
    open: toFiniteNumber(item.open),
    high: toFiniteNumber(item.high),
    low: toFiniteNumber(item.low),
    close,
    adjustedClose: toFiniteNumber(item.adjClose),
    volume: toFiniteNumber(item.volume),
  };
}

export class FmpMarketDataProvider implements MarketDataProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async getQuote(ticker: string): Promise<ProviderQuote> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const endpoint = "/quote";

    const response = await this.client.getJson<unknown>(endpoint, {
      symbol: normalizedTicker,
    });
    const item = extractQuoteItem(response);

    if (!item) {
      throw new ProviderNotFoundError(
        FMP_PROVIDER_NAME,
        `Quote not found for ticker ${normalizedTicker}.`,
        { endpoint },
      );
    }
    const price = toFiniteNumber(item.price);

    if (price === undefined) {
      throw new ProviderResponseError(
        FMP_PROVIDER_NAME,
        `Quote response for ticker ${normalizedTicker} did not include a valid price.`,
        { endpoint },
      );
    }

    const timestamp = toFiniteNumber(item.timestamp);
    const asOf = timestamp == null ? undefined : toDate(timestamp * 1000);

    return {
      ticker: normalizedTicker,
      price,
      open: toFiniteNumber(item.open),
      high: toFiniteNumber(item.dayHigh),
      low: toFiniteNumber(item.dayLow),
      close: price,
      previousClose: toFiniteNumber(item.previousClose),
      change: toFiniteNumber(item.change),
      changePercent: parseQuotePercent(item),
      volume: toFiniteNumber(item.volume),
      marketCap: toFiniteNumber(item.marketCap),
      exchange: item.exchange,
      asOf,
    };
  }

  async getHistoricalDailyPrices(
    ticker: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderHistoricalPrice[]> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const endpoint = "/historical-price-eod/full";

    const query: FmpJsonQuery = {
      symbol: normalizedTicker,
    };
    if (options?.from) {
      query.from = formatDateOnly(options.from);
    }

    if (options?.to) {
      query.to = formatDateOnly(options.to);
    }

    const response = await this.client.getJson<unknown>(endpoint, query);

    const historicalRows = extractHistoricalRows(response);

    const mapped = historicalRows
      .map((row) => mapHistoricalPrice(normalizedTicker, row))
      .filter((row): row is ProviderHistoricalPrice => row !== null)
      .sort((left, right) => left.date.getTime() - right.date.getTime());

    const limit = normalizeLimit(options?.limit);
    if (!limit || mapped.length <= limit) {
      return mapped;
    }

    return mapped.slice(mapped.length - limit);
  }
}