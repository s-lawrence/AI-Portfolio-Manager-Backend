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

function sortRecordsByDateDesc(
  records: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...records].sort((left, right) => {
    const leftDate = recordDate(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightDate = recordDate(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightDate - leftDate;
  });
}

function isFiscalYearRecord(record: Record<string, unknown>): boolean {
  const period = toStringOrUndefined(record.period);
  return period?.trim().toUpperCase() === "FY";
}

function latestAnnualOrLatestRecord(
  records: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (records.length === 0) {
    return null;
  }

  const sorted = sortRecordsByDateDesc(records);
  return sorted.find((record) => isFiscalYearRecord(record)) ?? sorted[0] ?? null;
}

function safeDivide(
  numerator: number | undefined,
  denominator: number | undefined,
): number | undefined {
  if (
    numerator === undefined ||
    denominator === undefined ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return undefined;
  }

  return numerator / denominator;
}

function calculateRevenueGrowthFromIncomeStatements(
  incomeStatements: Record<string, unknown>[],
): number | undefined {
  const sorted = sortRecordsByDateDesc(incomeStatements);
  const revenues: number[] = [];

  for (const statement of sorted) {
    const revenue = toFiniteNumber(statement.revenue);
    if (revenue === undefined) {
      continue;
    }

    revenues.push(revenue);
    if (revenues.length === 2) {
      break;
    }
  }

  if (revenues.length < 2) {
    return undefined;
  }

  const currentRevenue = revenues[0];
  const previousRevenue = revenues[1];

  return safeDivide(currentRevenue - previousRevenue, previousRevenue);
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
      keyMetricsRecords,
      ratiosRecords,
      profile,
      financialGrowth,
      incomeStatementRecords,
      cashFlowStatement,
      balanceSheet,
      quote,
    ] = await Promise.all([
      this.fetchEndpointRecordsWithFallback(
        ["/stable/key-metrics", "/key-metrics"],
        normalizedTicker,
      ),
      this.fetchEndpointRecordsWithFallback(
        ["/stable/ratios", "/ratios"],
        normalizedTicker,
      ),
      this.fetchLatestEndpointRecord("/profile", normalizedTicker),
      this.fetchLatestEndpointRecord("/financial-growth", normalizedTicker),
      this.fetchEndpointRecords("/income-statement", normalizedTicker),
      this.fetchLatestEndpointRecord("/cash-flow-statement", normalizedTicker),
      this.fetchLatestEndpointRecord("/balance-sheet-statement", normalizedTicker),
      this.fetchLatestEndpointRecord("/quote", normalizedTicker),
    ]);

    const keyMetrics = latestAnnualOrLatestRecord(keyMetricsRecords);
    const ratios = latestAnnualOrLatestRecord(ratiosRecords);
    const incomeStatement = latestRecord(incomeStatementRecords);

    if (
      !keyMetrics &&
      !ratios &&
      !profile &&
      !financialGrowth &&
      !incomeStatement &&
      !cashFlowStatement &&
      !balanceSheet
    ) {
      return null;
    }

    const period = pickString([
      { record: keyMetrics, fields: ["period"] },
      { record: ratios, fields: ["period"] },
      { record: financialGrowth, fields: ["period"] },
      { record: incomeStatement, fields: ["period"] },
      { record: cashFlowStatement, fields: ["period"] },
      { record: balanceSheet, fields: ["period"] },
    ]);

    const asOfDate = pickAsOfDate([
      keyMetrics,
      ratios,
      financialGrowth,
      incomeStatement,
      cashFlowStatement,
      balanceSheet,
    ]);

    const fiscalYear =
      parseYearValue(keyMetrics?.fiscalYear) ??
      parseYearValue(keyMetrics?.calendarYear) ??
      parseYearValue(ratios?.fiscalYear) ??
      parseYearValue(ratios?.calendarYear) ??
      parseYearValue(financialGrowth?.fiscalYear) ??
      parseYearValue(financialGrowth?.calendarYear) ??
      parseYearValue(incomeStatement?.fiscalYear) ??
      parseYearValue(incomeStatement?.calendarYear) ??
      parseYearValue(cashFlowStatement?.fiscalYear) ??
      parseYearValue(cashFlowStatement?.calendarYear) ??
      parseYearValue(balanceSheet?.fiscalYear) ??
      parseYearValue(balanceSheet?.calendarYear) ??
      undefined;

    const eps = pickNumber([
      { record: incomeStatement, fields: ["eps"] },
      { record: ratios, fields: ["netIncomePerShare"] },
    ]);

    const peRatioFromProvider = pickNumber([
      { record: ratios, fields: ["priceToEarningsRatio", "priceEarningsRatio"] },
      { record: keyMetrics, fields: ["peRatio"] },
    ]);

    const quotePrice = pickNumber([{ record: quote, fields: ["price"] }]);
    const peRatioFallback =
      eps !== undefined && eps > 0 ? safeDivide(quotePrice, eps) : undefined;

    const dividendYieldRaw = pickNumber([
      { record: ratios, fields: ["dividendYield"] },
      { record: keyMetrics, fields: ["dividendYield"] },
    ]);

    const dividendYieldPercentageRaw =
      dividendYieldRaw === undefined
        ? pickNumber([{ record: ratios, fields: ["dividendYieldPercentage"] }])
        : undefined;

    const normalizedDividendYield =
      dividendYieldRaw !== undefined
        ? normalizePercentLike(dividendYieldRaw)
        : dividendYieldPercentageRaw !== undefined
          ? normalizePercentLike(dividendYieldPercentageRaw / 100)
          : null;

    const debtToEquityFallback = safeDivide(
      pickNumber([{ record: balanceSheet, fields: ["totalDebt"] }]),
      pickNumber([
        {
          record: balanceSheet,
          fields: ["totalStockholdersEquity", "totalShareholderEquity"],
        },
      ]),
    );

    const revenueGrowthFromProvider = normalizePercentLike(
      pickNumber([{ record: financialGrowth, fields: ["revenueGrowth"] }]),
    );

    const revenueGrowthFallback = normalizePercentLike(
      calculateRevenueGrowthFromIncomeStatements(incomeStatementRecords),
    );

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
      peRatio: peRatioFromProvider ?? peRatioFallback,
      forwardPeRatio: pickNumber([
        { record: ratios, fields: ["forwardPERatio", "forwardPeRatio"] },
        { record: keyMetrics, fields: ["forwardPERatio", "forwardPeRatio"] },
      ]),
      pegRatio: pickNumber([
        { record: ratios, fields: ["priceToEarningsGrowthRatio", "pegRatio"] },
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
        { record: keyMetrics, fields: ["evToEBITDA", "enterpriseValueOverEBITDA"] },
        { record: ratios, fields: ["enterpriseValueMultiple"] },
      ]),
      eps,
      revenueGrowth: revenueGrowthFromProvider ?? revenueGrowthFallback ?? undefined,
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
      debtToEquity:
        pickNumber([
          { record: ratios, fields: ["debtToEquityRatio", "debtEquityRatio"] },
          { record: keyMetrics, fields: ["debtToEquity"] },
        ]) ?? debtToEquityFallback,
      currentRatio: pickNumber([
        { record: ratios, fields: ["currentRatio"] },
        { record: keyMetrics, fields: ["currentRatio"] },
      ]),
      freeCashFlow: pickNumber([
        { record: cashFlowStatement, fields: ["freeCashFlow"] },
      ]),
      dividendYield: normalizedDividendYield ?? undefined,
      analystConsensus: pickString([
        { record: profile, fields: ["analystRating", "consensus", "recommendation"] },
      ]),
      source: "FMP",
    };

    return hasUsefulFundamentals(fundamentals) ? fundamentals : null;
  }

  private async fetchEndpointRecords(
    endpoint: string,
    ticker: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      const payload = await this.client.getJson<unknown>(endpoint, {
        symbol: ticker,
      });

      return extractRecordArray(payload);
    } catch (error) {
      this.handleEndpointFailure(error, endpoint);
      return [];
    }
  }

  private async fetchEndpointRecordsWithFallback(
    endpoints: string[],
    ticker: string,
  ): Promise<Record<string, unknown>[]> {
    for (const endpoint of endpoints) {
      try {
        const payload = await this.client.getJson<unknown>(endpoint, {
          symbol: ticker,
        });

        return extractRecordArray(payload);
      } catch (error) {
        if (error instanceof ProviderRequestError && error.statusCode === 404) {
          continue;
        }

        this.handleEndpointFailure(error, endpoint);
      }
    }

    return [];
  }

  private async fetchLatestEndpointRecord(
    endpoint: string,
    ticker: string,
  ): Promise<Record<string, unknown> | null> {
    const records = await this.fetchEndpointRecords(endpoint, ticker);
    return latestRecord(records);
  }

  private handleEndpointFailure(
    error: unknown,
    endpoint: string,
  ): void {
    if (error instanceof ProviderRequestError) {
      if (error.statusCode === 404) {
        return;
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