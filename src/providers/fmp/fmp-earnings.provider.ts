import {
  EarningsProvider,
  ProviderDateRangeOptions,
  ProviderEarningsEvent,
  ProviderLimitOptions,
  normalizeProviderTickerOrThrow,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import { FmpJsonClient, FMP_PROVIDER_NAME, FmpClient } from "./fmp-client";
import {
  FmpEarningsReportItem,
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

function eventDate(event: ProviderEarningsEvent): Date | undefined {
  return event.earningsDate;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeHistoryLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 100;
  }

  return Math.max(1, Math.min(1000, Math.floor(limit)));
}

function ensureMaxNinetyDayRange(from: Date, to: Date): void {
  const fromStart = startOfUtcDay(from).getTime();
  const toStart = startOfUtcDay(to).getTime();

  if (toStart < fromStart) {
    throw new Error("Earnings calendar range is invalid: 'to' must be on or after 'from'.");
  }

  const dayCount = Math.floor((toStart - fromStart) / (1000 * 60 * 60 * 24)) + 1;
  if (dayCount > 90) {
    throw new Error("Earnings calendar range cannot exceed 90 days.");
  }
}

function isUsefulEarningsRecord(item: {
  estimatedEps?: number;
  reportedEps?: number;
  estimatedRevenue?: number;
  reportedRevenue?: number;
}): boolean {
  return (
    item.estimatedEps !== undefined ||
    item.reportedEps !== undefined ||
    item.estimatedRevenue !== undefined ||
    item.reportedRevenue !== undefined
  );
}

function byNewestDate(left: ProviderEarningsEvent, right: ProviderEarningsEvent): number {
  const leftTime = eventDate(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightTime = eventDate(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

export class FmpEarningsProvider implements EarningsProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async getNextEarnings(ticker: string): Promise<ProviderEarningsEvent | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const reportItems = await this.fetchEndpointItems<FmpEarningsReportItem>(
      "/earnings",
      {
        symbol: normalizedTicker,
        limit: 100,
      },
    );

    const today = startOfUtcDay(new Date()).getTime();
    const upcoming = reportItems
      .map((item) => this.mapReportItem(item, normalizedTicker, true))
      .filter((item): item is ProviderEarningsEvent => item !== null)
      .filter((item) => (item.earningsDate?.getTime() ?? Number.NEGATIVE_INFINITY) >= today)
      .sort((left, right) => {
        const leftTime = left.earningsDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.earningsDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });

    return upcoming[0] ?? null;
  }

  async getEarningsHistory(
    ticker: string,
    options: ProviderLimitOptions = {},
  ): Promise<ProviderEarningsEvent[]> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const requestedLimit = normalizeHistoryLimit(options.limit);
    const reportItems = await this.fetchEndpointItems<FmpEarningsReportItem>(
      "/earnings",
      {
        symbol: normalizedTicker,
        limit: requestedLimit,
      },
    );

    const today = startOfUtcDay(new Date()).getTime();
    const history = reportItems
      .map((item) => this.mapReportItem(item, normalizedTicker, true))
      .filter((item): item is ProviderEarningsEvent => item !== null)
      .filter((item) => (item.earningsDate?.getTime() ?? Number.POSITIVE_INFINITY) < today)
      .sort(byNewestDate);

    return history.slice(0, requestedLimit);
  }

  async getEarningsCalendar(
    options: Required<Pick<ProviderDateRangeOptions, "from" | "to">> & { page?: number },
  ): Promise<ProviderEarningsEvent[]> {
    ensureMaxNinetyDayRange(options.from, options.to);

    const page =
      typeof options.page === "number" && Number.isFinite(options.page)
        ? Math.max(0, Math.floor(options.page))
        : 0;

    const calendarItems = await this.fetchEndpointItems<FmpEarningsReportItem>(
      "/earnings-calendar",
      {
        from: formatDateOnly(options.from),
        to: formatDateOnly(options.to),
        page,
      },
    );

    return calendarItems
      .map((item) => this.mapReportItem(item, undefined, false))
      .filter((item): item is ProviderEarningsEvent => item !== null)
      .sort((left, right) => {
        const leftTime = left.earningsDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.earningsDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });
  }

  private async fetchEndpointItems<T>(
    endpoint: string,
    query?: Record<string, string | number>,
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

  private mapReportItem(
    item: FmpEarningsReportItem,
    requestedTicker?: string,
    requireUsefulValues: boolean = true,
  ): ProviderEarningsEvent | null {
    const earningsDate = parseDateValue(item.date);
    if (!earningsDate) {
      return null;
    }

    const estimatedEps = toFiniteNumber(item.epsEstimated);
    const reportedEps = toFiniteNumber(item.epsActual);
    const estimatedRevenue = toFiniteNumber(item.revenueEstimated);
    const reportedRevenue = toFiniteNumber(item.revenueActual);

    if (
      requireUsefulValues &&
      !isUsefulEarningsRecord({
        estimatedEps,
        reportedEps,
        estimatedRevenue,
        reportedRevenue,
      })
    ) {
      return null;
    }

    const epsSurprise =
      reportedEps !== undefined && estimatedEps !== undefined
        ? reportedEps - estimatedEps
        : undefined;

    const revenueSurprise =
      reportedRevenue !== undefined && estimatedRevenue !== undefined
        ? reportedRevenue - estimatedRevenue
        : undefined;

    const tickerRaw = (item.symbol ?? requestedTicker)?.trim();
    if (!tickerRaw) {
      return null;
    }

    const ticker = normalizeProviderTickerOrThrow(tickerRaw);

    return {
      ticker,
      fiscalQuarter: undefined,
      fiscalYear: earningsDate.getUTCFullYear(),
      earningsDate,
      earningsTime: undefined,
      isDateConfirmed: false,
      estimatedEps,
      reportedEps,
      epsSurprise,
      estimatedRevenue,
      reportedRevenue,
      revenueSurprise,
      source: "FMP",
    };
  }
}
