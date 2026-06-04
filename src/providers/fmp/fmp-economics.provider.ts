import {
  EconomicsProvider,
  ProviderDateRangeOptions,
  ProviderEconomicCalendarEvent,
  ProviderEconomicIndicator,
  ProviderMarketRiskPremium,
  ProviderTreasuryRate,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import { FmpJsonClient, FMP_PROVIDER_NAME, FmpClient } from "./fmp-client";
import {
  FmpEconomicCalendarItem,
  FmpEconomicIndicatorItem,
  FmpMarketRiskPremiumItem,
  FmpTreasuryRatesItem,
} from "./fmp.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractRecordArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is T => isRecord(item));
  }

  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data.filter((item): item is T => isRecord(item));
  }

  return [];
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
  if (typeof value !== "string") {
    return undefined;
  }

  const timestamp = Date.parse(value);
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

  return Math.max(1, Math.min(1000, Math.floor(limit)));
}

function sortByDateDescending<T extends { date: Date }>(left: T, right: T): number {
  return right.date.getTime() - left.date.getTime();
}

function sortByEventDateAscending<T extends { eventDate: Date }>(left: T, right: T): number {
  return left.eventDate.getTime() - right.eventDate.getTime();
}

export class FmpEconomicsProvider implements EconomicsProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async getTreasuryRates(options: ProviderDateRangeOptions = {}): Promise<ProviderTreasuryRate[]> {
    const query = {
      ...(options.from ? { from: formatDateOnly(options.from) } : {}),
      ...(options.to ? { to: formatDateOnly(options.to) } : {}),
      ...(normalizeLimit(options.limit) ? { limit: normalizeLimit(options.limit) } : {}),
    };

    const items = await this.fetchEndpointItems<FmpTreasuryRatesItem>("/treasury-rates", query);

    return items
      .map((item) => this.mapTreasuryRatesItem(item))
      .filter((item): item is ProviderTreasuryRate => item !== null)
      .sort(sortByDateDescending);
  }

  async getEconomicIndicators(
    nameOrSeries?: string,
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderEconomicIndicator[]> {
    const normalizedNameOrSeries = nameOrSeries?.trim();

    const query = {
      ...(normalizedNameOrSeries ? { name: normalizedNameOrSeries } : {}),
      ...(options.from ? { from: formatDateOnly(options.from) } : {}),
      ...(options.to ? { to: formatDateOnly(options.to) } : {}),
      ...(normalizeLimit(options.limit) ? { limit: normalizeLimit(options.limit) } : {}),
    };

    const items = await this.fetchEndpointItems<FmpEconomicIndicatorItem>(
      "/economic-indicators",
      query,
    );

    return items
      .map((item) => this.mapEconomicIndicatorItem(item))
      .filter((item): item is ProviderEconomicIndicator => item !== null)
      .sort(sortByDateDescending);
  }

  async getEconomicCalendar(
    options: Required<Pick<ProviderDateRangeOptions, "from" | "to">>,
  ): Promise<ProviderEconomicCalendarEvent[]> {
    const query = {
      from: formatDateOnly(options.from),
      to: formatDateOnly(options.to),
    };

    const items = await this.fetchEndpointItemsWithFallback<FmpEconomicCalendarItem>(
      ["/economic-calendar", "/economics-calendar"],
      query,
    );

    return items
      .map((item) => this.mapEconomicCalendarItem(item))
      .filter((item): item is ProviderEconomicCalendarEvent => item !== null)
      .sort(sortByEventDateAscending);
  }

  async getMarketRiskPremium(
    options: Pick<ProviderDateRangeOptions, "from" | "to"> = {},
  ): Promise<ProviderMarketRiskPremium[]> {
    const query = {
      ...(options.from ? { from: formatDateOnly(options.from) } : {}),
      ...(options.to ? { to: formatDateOnly(options.to) } : {}),
    };

    const items = await this.fetchEndpointItems<FmpMarketRiskPremiumItem>(
      "/market-risk-premium",
      query,
    );

    return items
      .map((item) => this.mapMarketRiskPremiumItem(item))
      .filter((item): item is ProviderMarketRiskPremium => item !== null)
      .sort(sortByDateDescending);
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

  private async fetchEndpointItemsWithFallback<T>(
    endpoints: string[],
    query?: Record<string, string | number>,
  ): Promise<T[]> {
    let latest404: ProviderRequestError | null = null;

    for (const endpoint of endpoints) {
      try {
        const payload = await this.client.getJson<unknown>(endpoint, query);
        return extractRecordArray<T>(payload);
      } catch (error) {
        if (error instanceof ProviderRequestError && error.statusCode === 404) {
          latest404 = error;
          continue;
        }

        this.handleEndpointFailure(error, endpoint);
      }
    }

    if (latest404) {
      return [];
    }

    return [];
  }

  private handleEndpointFailure(error: unknown, endpoint: string): [] {
    if (error instanceof ProviderRequestError) {
      if (error.statusCode === 404) {
        return [];
      }

      if (error.statusCode === 402) {
        throw new ProviderConfigurationError(
          FMP_PROVIDER_NAME,
          `${FMP_PROVIDER_NAME} endpoint is not available for the current plan.`,
          {
            endpoint,
            statusCode: error.statusCode,
            cause: error,
          },
        );
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
    }

    throw error;
  }

  private mapTreasuryRatesItem(item: FmpTreasuryRatesItem): ProviderTreasuryRate | null {
    const date = parseDateValue(item.date);
    if (!date) {
      return null;
    }

    return {
      date,
      month1: toFiniteNumber(item.month1),
      month2: toFiniteNumber(item.month2),
      month3: toFiniteNumber(item.month3),
      month6: toFiniteNumber(item.month6),
      year1: toFiniteNumber(item.year1),
      year2: toFiniteNumber(item.year2),
      year3: toFiniteNumber(item.year3),
      year5: toFiniteNumber(item.year5),
      year7: toFiniteNumber(item.year7),
      year10: toFiniteNumber(item.year10),
      year20: toFiniteNumber(item.year20),
      year30: toFiniteNumber(item.year30),
      source: item.source ?? "FMP",
    };
  }

  private mapEconomicIndicatorItem(
    item: FmpEconomicIndicatorItem,
  ): ProviderEconomicIndicator | null {
    const name = (item.name ?? item.indicator)?.trim();
    if (!name) {
      return null;
    }

    const date = parseDateValue(item.date);
    if (!date) {
      return null;
    }

    const value = toFiniteNumber(item.value);
    if (value === undefined) {
      return null;
    }

    return {
      name,
      seriesId: item.seriesId ?? item.series,
      country: item.country,
      category: item.category,
      value,
      unit: item.unit,
      date,
      source: item.source ?? "FMP",
    };
  }

  private mapEconomicCalendarItem(
    item: FmpEconomicCalendarItem,
  ): ProviderEconomicCalendarEvent | null {
    const title = (item.title ?? item.event)?.trim();
    if (!title) {
      return null;
    }

    const eventDate = parseDateValue(item.eventDate ?? item.date);
    if (!eventDate) {
      return null;
    }

    return {
      title,
      country: item.country,
      category: item.category,
      importance: item.importance ?? item.impact,
      eventDate,
      actual: toFiniteNumber(item.actual),
      estimate: toFiniteNumber(item.estimate),
      previous: toFiniteNumber(item.previous),
      unit: item.unit,
      source: item.source ?? item.url ?? "FMP",
    };
  }

  private mapMarketRiskPremiumItem(
    item: FmpMarketRiskPremiumItem,
  ): ProviderMarketRiskPremium | null {
    const date = parseDateValue(item.date);
    if (!date) {
      return null;
    }

    return {
      date,
      country: item.country,
      equityRiskPremium: toFiniteNumber(item.equityRiskPremium),
      countryRiskPremium: toFiniteNumber(item.countryRiskPremium),
      totalRiskPremium: toFiniteNumber(item.totalRiskPremium),
      source: item.source ?? "FMP",
    };
  }
}
