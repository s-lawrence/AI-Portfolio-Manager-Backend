import {
  FundamentalsProvider,
  ProviderFundamentalSnapshot,
  normalizeProviderTickerOrThrow,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import { FmpJsonClient, FMP_PROVIDER_NAME, FmpClient } from "./fmp-client";

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

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
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

function parseYearValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeFiscalQuarter(period?: string): string | undefined {
  if (!period) {
    return undefined;
  }

  const normalized = period.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  if (/^Q[1-4]$/.test(normalized)) {
    return normalized;
  }

  return undefined;
}

function recordDate(record: Record<string, unknown>): Date | undefined {
  const candidate =
    record.date ??
    record.filingDate ??
    record.acceptedDate ??
    record.asOfDate;

  return parseDateValue(candidate);
}

function extractRecordArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => isRecord(item));
  }

  if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      return payload.data.filter((item): item is Record<string, unknown> =>
        isRecord(item),
      );
    }

    return [payload];
  }

  return [];
}

function latestRecord(records: Record<string, unknown>[]): Record<string, unknown> | null {
  if (records.length === 0) {
    return null;
  }

  if (records.length === 1) {
    return records[0];
  }

  const sorted = [...records].sort((left, right) => {
    const leftDate = recordDate(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightDate = recordDate(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightDate - leftDate;
  });

  return sorted[0] ?? null;
}

function pickNumber(
  candidates: Array<{
    record: Record<string, unknown> | null;
    fields: string[];
  }>,
): number | undefined {
  for (const candidate of candidates) {
    if (!candidate.record) {
      continue;
    }

    for (const field of candidate.fields) {
      const value = toFiniteNumber(candidate.record[field]);
      if (value !== undefined) {
        return value;
      }
    }
  }

  return undefined;
}

export function normalizePercentLike(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  // FMP responses can be either decimal fractions (0.054) or percentage-form values (5.4).
  if (Math.abs(value) >= 1) {
    return value / 100;
  }

  return value;
}

function pickString(
  candidates: Array<{
    record: Record<string, unknown> | null;
    fields: string[];
  }>,
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate.record) {
      continue;
    }

    for (const field of candidate.fields) {
      const value = toStringOrUndefined(candidate.record[field]);
      if (value !== undefined) {
        return value;
      }
    }
  }

  return undefined;
}

function hasUsefulFundamentals(snapshot: ProviderFundamentalSnapshot): boolean {
  const { ticker: _ignoredTicker, source: _ignoredSource, ...rest } = snapshot;
  return Object.values(rest).some((value) => value !== undefined && value !== null);
}

function pickAsOfDate(records: Array<Record<string, unknown> | null>): Date | undefined {
  for (const record of records) {
    if (!record) {
      continue;
    }

    const resolvedDate = recordDate(record);
    if (resolvedDate) {
      return resolvedDate;
    }
  }

  return undefined;
}

export class FmpFundamentalsProvider implements FundamentalsProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async getFundamentals(
    ticker: string,
  ): Promise<ProviderFundamentalSnapshot | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const [
      keyMetrics,
      ratios,
      profile,
      financialGrowth,
      incomeStatement,
      cashFlowStatement,
    ] = await Promise.all([
      this.fetchLatestEndpointRecord("/key-metrics", normalizedTicker),
      this.fetchLatestEndpointRecord("/ratios", normalizedTicker),
      this.fetchLatestEndpointRecord("/profile", normalizedTicker),
      this.fetchLatestEndpointRecord("/financial-growth", normalizedTicker),
      this.fetchLatestEndpointRecord("/income-statement", normalizedTicker),
      this.fetchLatestEndpointRecord("/cash-flow-statement", normalizedTicker),
    ]);

    if (
      !keyMetrics &&
      !ratios &&
      !profile &&
      !financialGrowth &&
      !incomeStatement &&
      !cashFlowStatement
    ) {
      return null;
    }

    const period = pickString([
      { record: keyMetrics, fields: ["period"] },
      { record: ratios, fields: ["period"] },
      { record: financialGrowth, fields: ["period"] },
      { record: incomeStatement, fields: ["period"] },
      { record: cashFlowStatement, fields: ["period"] },
    ]);

    const asOfDate = pickAsOfDate([
      keyMetrics,
      ratios,
      financialGrowth,
      incomeStatement,
      cashFlowStatement,
    ]);

    const fiscalYear =
      parseYearValue(keyMetrics?.calendarYear) ??
      parseYearValue(ratios?.calendarYear) ??
      parseYearValue(financialGrowth?.calendarYear) ??
      parseYearValue(incomeStatement?.calendarYear) ??
      parseYearValue(cashFlowStatement?.calendarYear) ??
      undefined;

    const fundamentals: ProviderFundamentalSnapshot = {
      ticker: normalizedTicker,
      asOfDate,
      period,
      fiscalYear,
      fiscalQuarter: normalizeFiscalQuarter(period),
      marketCap: pickNumber([
        { record: keyMetrics, fields: ["marketCap"] },
        { record: profile, fields: ["marketCap", "mktCap"] },
      ]),
      peRatio: pickNumber([
        { record: ratios, fields: ["priceEarningsRatio"] },
        { record: keyMetrics, fields: ["peRatio"] },
      ]),
      forwardPeRatio: pickNumber([
        { record: ratios, fields: ["forwardPERatio"] },
      ]),
      pegRatio: pickNumber([
        { record: ratios, fields: ["pegRatio"] },
      ]),
      priceToSales: pickNumber([
        { record: ratios, fields: ["priceToSalesRatio"] },
        { record: keyMetrics, fields: ["priceToSalesRatio"] },
      ]),
      priceToBook: pickNumber([
        { record: ratios, fields: ["priceToBookRatio"] },
        { record: keyMetrics, fields: ["pbRatio"] },
      ]),
      evToEbitda: pickNumber([
        { record: keyMetrics, fields: ["enterpriseValueOverEBITDA"] },
      ]),
      eps: pickNumber([
        { record: incomeStatement, fields: ["eps"] },
      ]),
      revenueGrowth:
        normalizePercentLike(
          pickNumber([{ record: financialGrowth, fields: ["revenueGrowth"] }]),
        ) ?? undefined,
      grossMargin:
        normalizePercentLike(
          pickNumber([{ record: ratios, fields: ["grossProfitMargin"] }]),
        ) ?? undefined,
      operatingMargin:
        normalizePercentLike(
          pickNumber([{ record: ratios, fields: ["operatingProfitMargin"] }]),
        ) ?? undefined,
      netMargin:
        normalizePercentLike(
          pickNumber([{ record: ratios, fields: ["netProfitMargin"] }]),
        ) ?? undefined,
      debtToEquity: pickNumber([
        { record: ratios, fields: ["debtEquityRatio"] },
        { record: keyMetrics, fields: ["debtToEquity"] },
      ]),
      currentRatio: pickNumber([
        { record: ratios, fields: ["currentRatio"] },
        { record: keyMetrics, fields: ["currentRatio"] },
      ]),
      freeCashFlow: pickNumber([
        { record: cashFlowStatement, fields: ["freeCashFlow"] },
      ]),
      dividendYield:
        normalizePercentLike(
          pickNumber([
            { record: ratios, fields: ["dividendYield"] },
            { record: keyMetrics, fields: ["dividendYield"] },
          ]),
        ) ?? undefined,
      analystConsensus: pickString([
        { record: profile, fields: ["analystRating", "consensus", "recommendation"] },
      ]),
      source: "FMP",
    };

    return hasUsefulFundamentals(fundamentals) ? fundamentals : null;
  }

  private async fetchLatestEndpointRecord(
    endpoint: string,
    ticker: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const payload = await this.client.getJson<unknown>(endpoint, {
        symbol: ticker,
      });

      return latestRecord(extractRecordArray(payload));
    } catch (error) {
      return this.handleEndpointFailure(error, endpoint);
    }
  }

  private handleEndpointFailure(
    error: unknown,
    endpoint: string,
  ): null {
    if (error instanceof ProviderRequestError) {
      if (error.statusCode === 404) {
        return null;
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
}