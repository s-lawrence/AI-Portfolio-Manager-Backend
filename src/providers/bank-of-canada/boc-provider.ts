import { env } from "../../config/env";
import {
  FxRateProvider,
  MacroProvider,
  ProviderDateRangeOptions,
  ProviderFxRate,
  ProviderMacroObservation,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import {
  BANK_OF_CANADA_PROVIDER_NAME,
  BocClient,
  BocJsonClient,
} from "./boc-client";
import { BocObservationItem, BocObservationsResponse } from "./boc.types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractObservations(payload: unknown): BocObservationItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.observations)) {
    return [];
  }

  return payload.observations.filter((item): item is BocObservationItem => isRecord(item));
}

function extractSeriesValue(observation: BocObservationItem, seriesId: string): number | undefined {
  const raw = observation[seriesId];

  if (isRecord(raw)) {
    return toFiniteNumber(raw.v);
  }

  return toFiniteNumber(raw);
}

function applyRecentLimitAscending<T>(rows: T[], limit?: number): T[] {
  const normalizedLimit = normalizeLimit(limit);
  if (!normalizedLimit || rows.length <= normalizedLimit) {
    return rows;
  }

  return rows.slice(rows.length - normalizedLimit);
}

function inferCategory(seriesId: string): string {
  if (seriesId.toUpperCase().startsWith("FX")) {
    return "currency";
  }

  return "rates";
}

function inferUnit(seriesId: string): string | null {
  const normalized = seriesId.toUpperCase();
  if (normalized === env.BANK_OF_CANADA_USD_CAD_SERIES_ID.toUpperCase()) {
    return "cad_per_usd";
  }

  if (normalized.startsWith("FX")) {
    return "fx_rate";
  }

  return null;
}

export class BankOfCanadaProvider implements MacroProvider, FxRateProvider {
  constructor(private readonly client: BocJsonClient = new BocClient()) {}

  async getSeriesObservations(
    seriesId: string,
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderMacroObservation[]> {
    const normalizedSeriesId = seriesId.trim().toUpperCase();
    if (!normalizedSeriesId) {
      throw new Error("seriesId is required.");
    }

    const query = {
      ...(options.from ? { start_date: formatDateOnly(options.from) } : {}),
      ...(options.to ? { end_date: formatDateOnly(options.to) } : {}),
    };

    let payload: BocObservationsResponse;

    try {
      payload = await this.client.getJson<BocObservationsResponse>(
        `/observations/${encodeURIComponent(normalizedSeriesId)}/json`,
        query,
      );
    } catch (error) {
      return this.handleProviderError(error, normalizedSeriesId);
    }

    const mapped = extractObservations(payload)
      .reduce<ProviderMacroObservation[]>((rows, observation) => {
        const observedAt = parseObservedAt(observation.d);
        if (!observedAt) {
          return rows;
        }

        const value = extractSeriesValue(observation, normalizedSeriesId);
        if (value === undefined) {
          return rows;
        }

        rows.push({
          provider: "BANK_OF_CANADA",
          seriesId: normalizedSeriesId,
          name: normalizedSeriesId,
          country: "CA",
          category: inferCategory(normalizedSeriesId),
          value,
          unit: inferUnit(normalizedSeriesId),
          observedAt,
          source: BANK_OF_CANADA_PROVIDER_NAME,
        });

        return rows;
      }, [])
      .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());

    return applyRecentLimitAscending(mapped, options.limit);
  }

  async getUsdCadRate(
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderFxRate[]> {
    const seriesId = env.BANK_OF_CANADA_USD_CAD_SERIES_ID;

    const observations = await this.getSeriesObservations(seriesId, options);

    return observations.map((observation) => ({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: observation.value,
      capturedAt: observation.observedAt,
      source: `${BANK_OF_CANADA_PROVIDER_NAME}:${seriesId}`,
    }));
  }

  private handleProviderError(error: unknown, seriesId: string): [] {
    if (error instanceof ProviderRequestError) {
      if (error.statusCode === 404) {
        return [];
      }

      if (error.statusCode === 401 || error.statusCode === 403) {
        throw new ProviderConfigurationError(
          BANK_OF_CANADA_PROVIDER_NAME,
          `${BANK_OF_CANADA_PROVIDER_NAME} request was not authorized.`,
          {
            endpoint: seriesId,
            statusCode: error.statusCode,
            cause: error,
          },
        );
      }

      if (error.statusCode === 429) {
        throw new ProviderRateLimitError(
          BANK_OF_CANADA_PROVIDER_NAME,
          `${BANK_OF_CANADA_PROVIDER_NAME} rate limit exceeded.`,
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
