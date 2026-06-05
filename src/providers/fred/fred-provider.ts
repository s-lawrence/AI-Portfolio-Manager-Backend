import {
  MacroProvider,
  ProviderDateRangeOptions,
  ProviderMacroObservation,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import { FRED_PROVIDER_NAME, FredClient, FredJsonClient } from "./fred-client";
import { FredSeriesObservationsResponse } from "./fred.types";

export interface FredSeriesMetadata {
  name: string;
  country: string;
  category: string;
  unit: string;
}

export const FRED_DEFAULT_SERIES_IDS: string[] = [
  "FEDFUNDS",
  "DGS10",
  "DGS2",
  "T10Y2Y",
  "CPIAUCSL",
  "CPILFESL",
  "UNRATE",
  "PAYEMS",
  "ICSA",
  "GDP",
  "BAMLH0A0HYM2",
  "VIXCLS",
  "DTWEXBGS",
  "DCOILWTICO",
];

export const FRED_SERIES_METADATA: Record<string, FredSeriesMetadata> = {
  FEDFUNDS: {
    name: "Federal Funds Effective Rate",
    country: "US",
    category: "rates",
    unit: "percent",
  },
  DGS10: {
    name: "10-Year Treasury Constant Maturity Rate",
    country: "US",
    category: "rates",
    unit: "percent",
  },
  DGS2: {
    name: "2-Year Treasury Constant Maturity Rate",
    country: "US",
    category: "rates",
    unit: "percent",
  },
  T10Y2Y: {
    name: "10-Year Minus 2-Year Treasury Yield Spread",
    country: "US",
    category: "rates",
    unit: "percent",
  },
  CPIAUCSL: {
    name: "Consumer Price Index: All Urban Consumers",
    country: "US",
    category: "inflation",
    unit: "index",
  },
  CPILFESL: {
    name: "Consumer Price Index Less Food and Energy",
    country: "US",
    category: "inflation",
    unit: "index",
  },
  UNRATE: {
    name: "Civilian Unemployment Rate",
    country: "US",
    category: "labor",
    unit: "percent",
  },
  PAYEMS: {
    name: "Total Nonfarm Payrolls",
    country: "US",
    category: "labor",
    unit: "thousands",
  },
  ICSA: {
    name: "Initial Claims",
    country: "US",
    category: "labor",
    unit: "count",
  },
  GDP: {
    name: "Gross Domestic Product",
    country: "US",
    category: "growth",
    unit: "billions_usd",
  },
  BAMLH0A0HYM2: {
    name: "US High Yield Option-Adjusted Spread",
    country: "US",
    category: "credit",
    unit: "percent",
  },
  VIXCLS: {
    name: "CBOE Volatility Index",
    country: "US",
    category: "volatility",
    unit: "index",
  },
  DTWEXBGS: {
    name: "Trade Weighted US Dollar Index",
    country: "US",
    category: "currency",
    unit: "index",
  },
  DCOILWTICO: {
    name: "Crude Oil Prices: West Texas Intermediate",
    country: "US",
    category: "commodities",
    unit: "usd_per_barrel",
  },
};

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

function parseObservedAt(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === ".") {
      return undefined;
    }

    const parsed = Number(trimmed.replace(/[,_\s]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function applyRecentLimitAscending<T>(rows: T[], limit?: number): T[] {
  const normalizedLimit = normalizeLimit(limit);
  if (!normalizedLimit || rows.length <= normalizedLimit) {
    return rows;
  }

  return rows.slice(rows.length - normalizedLimit);
}

export class FredProvider implements MacroProvider {
  constructor(private readonly client: FredJsonClient = new FredClient()) {}

  async getSeriesObservations(
    seriesId: string,
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderMacroObservation[]> {
    const normalizedSeriesId = seriesId.trim().toUpperCase();
    if (!normalizedSeriesId) {
      throw new Error("seriesId is required.");
    }

    const query = {
      series_id: normalizedSeriesId,
      file_type: "json",
      sort_order: "asc",
      ...(options.from ? { observation_start: formatDateOnly(options.from) } : {}),
      ...(options.to ? { observation_end: formatDateOnly(options.to) } : {}),
    };

    let payload: FredSeriesObservationsResponse;

    try {
      payload = await this.client.getJson<FredSeriesObservationsResponse>(
        "/series/observations",
        query,
      );
    } catch (error) {
      return this.handleProviderError(error, normalizedSeriesId);
    }

    const metadata = FRED_SERIES_METADATA[normalizedSeriesId];

    const mapped = (Array.isArray(payload.observations) ? payload.observations : [])
      .reduce<ProviderMacroObservation[]>((rows, observation) => {
        const observedAt = parseObservedAt(observation.date);
        if (!observedAt) {
          return rows;
        }

        const value = toFiniteNumber(observation.value);
        if (value === undefined) {
          return rows;
        }

        rows.push({
          provider: "FRED",
          seriesId: normalizedSeriesId,
          name: metadata?.name ?? normalizedSeriesId,
          country: metadata?.country ?? null,
          category: metadata?.category ?? null,
          value,
          unit: metadata?.unit ?? null,
          observedAt,
          source: FRED_PROVIDER_NAME,
        });

        return rows;
      }, [])
      .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());

    return applyRecentLimitAscending(mapped, options.limit);
  }

  private handleProviderError(error: unknown, seriesId: string): [] {
    if (error instanceof ProviderRequestError) {
      if (error.statusCode === 404) {
        return [];
      }

      if (error.statusCode === 401 || error.statusCode === 403) {
        throw new ProviderConfigurationError(
          FRED_PROVIDER_NAME,
          `${FRED_PROVIDER_NAME} API key is invalid or unauthorized.`,
          {
            endpoint: seriesId,
            statusCode: error.statusCode,
            cause: error,
          },
        );
      }

      if (error.statusCode === 429) {
        throw new ProviderRateLimitError(
          FRED_PROVIDER_NAME,
          `${FRED_PROVIDER_NAME} rate limit exceeded.`,
          {
            endpoint: seriesId,
            statusCode: error.statusCode,
            cause: error,
          },
        );
      }
    }

    throw error;
  }
}
