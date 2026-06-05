import { ProviderConfigurationError, ProviderError } from "../providers/errors";
import { fmpEconomicsProvider } from "../providers/fmp";
import {
  upsertMacroEventByProviderIdentity,
  upsertMacroSeriesObservation,
} from "../repositories";
import {
  FmpEconomicsIngestionSectionResult,
  IngestFmpEconomicCalendarOptions,
  IngestFmpEconomicIndicatorsOptions,
  IngestFmpEconomicsDefaultSetOptions,
  IngestFmpEconomicsDefaultSetResult,
  IngestFmpMarketRiskPremiumOptions,
  IngestFmpTreasuryRatesOptions,
} from "../types/services";

const FMP_PROVIDER = "FMP";
const TREASURY_CATEGORY = "Treasury Rates";
const ECONOMIC_INDICATORS_CATEGORY = "Economic Indicators";
const MARKET_RISK_PREMIUM_CATEGORY = "Market Risk Premium";
const ECONOMIC_CALENDAR_CATEGORY = "Economic Calendar";

const DEFAULT_INDICATOR_NAMES: string[] = ["GDP", "CPI", "UNEMPLOYMENT", "FED FUNDS RATE"];

interface MutableSectionCounter {
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  warnings: string[];
}

function emptySection(): FmpEconomicsIngestionSectionResult {
  return {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: [],
  };
}

function asSection(counter: MutableSectionCounter): FmpEconomicsIngestionSectionResult {
  return {
    recordsCreated: counter.recordsCreated,
    recordsUpdated: counter.recordsUpdated,
    recordsSkipped: counter.recordsSkipped,
    warnings: [...counter.warnings],
  };
}

function withSectionTiming(
  section: FmpEconomicsIngestionSectionResult,
  startedAtDate: Date,
  finishedAtDate: Date,
): FmpEconomicsIngestionSectionResult {
  return {
    ...section,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
  };
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function normalizeOptionalText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeImportance(value?: string | null): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function seriesIdForTreasuryTenor(tenor: string): string {
  return `FMP_TREASURY_${tenor}`;
}

function seriesNameForTreasuryTenor(tenor: string): string {
  return `US Treasury ${tenor}`;
}

async function writeObservation(
  counter: MutableSectionCounter,
  payload: {
    seriesId: string;
    name?: string | null;
    country?: string | null;
    category?: string | null;
    value: number;
    unit?: string | null;
    observedAt: Date;
  },
): Promise<void> {
  const result = await upsertMacroSeriesObservation({
    provider: FMP_PROVIDER,
    ...payload,
  });

  if (result.created) {
    counter.recordsCreated += 1;
  } else if (result.updated) {
    counter.recordsUpdated += 1;
  } else {
    counter.recordsSkipped += 1;
  }
}

export async function ingestFmpTreasuryRates(
  options: IngestFmpTreasuryRatesOptions = {},
): Promise<FmpEconomicsIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter: MutableSectionCounter = {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: [],
  };

  const rates = await fmpEconomicsProvider.getTreasuryRates({
    from: options.from,
    to: options.to,
    limit: options.limit,
  });

  if (rates.length === 0) {
    counter.warnings.push("No treasury rates returned by FMP.");
    return withSectionTiming(asSection(counter), startedAtDate, new Date());
  }

  for (const rate of rates) {
    const entries: Array<[string, number | undefined]> = [
      ["1M", rate.month1],
      ["2M", rate.month2],
      ["3M", rate.month3],
      ["6M", rate.month6],
      ["1Y", rate.year1],
      ["2Y", rate.year2],
      ["3Y", rate.year3],
      ["5Y", rate.year5],
      ["7Y", rate.year7],
      ["10Y", rate.year10],
      ["20Y", rate.year20],
      ["30Y", rate.year30],
    ];

    for (const [tenor, value] of entries) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        counter.recordsSkipped += 1;
        continue;
      }

      await writeObservation(counter, {
        seriesId: seriesIdForTreasuryTenor(tenor),
        name: seriesNameForTreasuryTenor(tenor),
        country: "US",
        category: TREASURY_CATEGORY,
        value,
        unit: "%",
        observedAt: rate.date,
      });
    }
  }

  return withSectionTiming(asSection(counter), startedAtDate, new Date());
}

export async function ingestFmpEconomicIndicators(
  options: IngestFmpEconomicIndicatorsOptions = {},
): Promise<FmpEconomicsIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter: MutableSectionCounter = {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: [],
  };

  const names =
    options.namesOrSeries && options.namesOrSeries.length > 0
      ? options.namesOrSeries
      : [undefined];

  for (const nameOrSeries of names) {
    const indicators = await fmpEconomicsProvider.getEconomicIndicators(nameOrSeries, {
      from: options.from,
      to: options.to,
      limit: options.limit,
    });

    if (indicators.length === 0) {
      const label = nameOrSeries ? ` for '${nameOrSeries}'` : "";
      counter.warnings.push(`No economic indicators returned by FMP${label}.`);
      continue;
    }

    for (const indicator of indicators) {
      if (!Number.isFinite(indicator.value)) {
        counter.recordsSkipped += 1;
        continue;
      }

      const rawSeriesId = normalizeOptionalText(indicator.seriesId);
      const fallbackSeries = indicator.name
        .trim()
        .replace(/\s+/g, "_")
        .toUpperCase();

      await writeObservation(counter, {
        seriesId: rawSeriesId ?? `FMP_INDICATOR_${fallbackSeries}`,
        name: normalizeOptionalText(indicator.name),
        country: normalizeOptionalText(indicator.country),
        category: normalizeOptionalText(indicator.category) ?? ECONOMIC_INDICATORS_CATEGORY,
        value: indicator.value,
        unit: normalizeOptionalText(indicator.unit),
        observedAt: indicator.date,
      });
    }
  }

  return withSectionTiming(asSection(counter), startedAtDate, new Date());
}

export async function ingestFmpEconomicCalendar(
  options: IngestFmpEconomicCalendarOptions,
): Promise<FmpEconomicsIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter: MutableSectionCounter = {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: [],
  };

  const events = await fmpEconomicsProvider.getEconomicCalendar({
    from: options.from,
    to: options.to,
  });

  if (events.length === 0) {
    counter.warnings.push("No economic calendar events returned by FMP.");
    return withSectionTiming(asSection(counter), startedAtDate, new Date());
  }

  for (const event of events) {
    const title = event.title.trim();
    if (!title) {
      counter.recordsSkipped += 1;
      continue;
    }

    const result = await upsertMacroEventByProviderIdentity(
      {
        provider: FMP_PROVIDER,
        title,
        eventDate: event.eventDate,
        country: normalizeOptionalText(event.country),
      },
      {
        eventType: "economic-release",
        category: normalizeOptionalText(event.category) ?? ECONOMIC_CALENDAR_CATEGORY,
        importance: normalizeImportance(event.importance),
        actual: event.actual ?? null,
        estimate: event.estimate ?? null,
        previous: event.previous ?? null,
        unit: normalizeOptionalText(event.unit),
        source: "FMP",
        sourceUrl: normalizeOptionalText(event.source),
      },
    );

    if (result.created) {
      counter.recordsCreated += 1;
    } else if (result.updated) {
      counter.recordsUpdated += 1;
    } else {
      counter.recordsSkipped += 1;
    }
  }

  return withSectionTiming(asSection(counter), startedAtDate, new Date());
}

export async function ingestFmpMarketRiskPremium(
  options: IngestFmpMarketRiskPremiumOptions = {},
): Promise<FmpEconomicsIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter: MutableSectionCounter = {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: [],
  };

  const records = await fmpEconomicsProvider.getMarketRiskPremium({
    from: options.from,
    to: options.to,
  });

  if (records.length === 0) {
    counter.warnings.push("No market risk premium records returned by FMP.");
    return withSectionTiming(asSection(counter), startedAtDate, new Date());
  }

  for (const record of records) {
    const country = normalizeOptionalText(record.country) ?? "GLOBAL";
    const suffix = country.replace(/\s+/g, "_").toUpperCase();

    const entries: Array<[string, string, number | undefined]> = [
      [
        `FMP_MRP_EQUITY_${suffix}`,
        `${country} Equity Risk Premium`,
        record.equityRiskPremium,
      ],
      [
        `FMP_MRP_COUNTRY_${suffix}`,
        `${country} Country Risk Premium`,
        record.countryRiskPremium,
      ],
      [
        `FMP_MRP_TOTAL_${suffix}`,
        `${country} Total Risk Premium`,
        record.totalRiskPremium,
      ],
    ];

    for (const [seriesId, name, value] of entries) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        counter.recordsSkipped += 1;
        continue;
      }

      await writeObservation(counter, {
        seriesId,
        name,
        country,
        category: MARKET_RISK_PREMIUM_CATEGORY,
        value,
        unit: "%",
        observedAt: record.date,
      });
    }
  }

  return withSectionTiming(asSection(counter), startedAtDate, new Date());
}

export async function ingestFmpEconomicsDefaultSet(
  options: IngestFmpEconomicsDefaultSetOptions = {},
): Promise<IngestFmpEconomicsDefaultSetResult> {
  const startedAt = new Date();
  const warnings: string[] = [];

  const now = new Date();

  const includeTreasuryRates = options.includeTreasuryRates ?? true;
  const includeCalendar = options.includeCalendar ?? true;
  const includeMarketRiskPremium = options.includeMarketRiskPremium ?? true;
  const includeIndicators = options.includeIndicators ?? false;

  let treasuryRates = emptySection();
  let economicIndicators = emptySection();
  let economicCalendar = emptySection();
  let marketRiskPremium = emptySection();

  if (includeTreasuryRates) {
    try {
      const from =
        options.treasuryRatesFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      treasuryRates = await ingestFmpTreasuryRates({
        from,
        to: options.treasuryRatesTo ?? now,
        limit: options.treasuryRatesLimit,
      });
    } catch (error) {
      warnings.push(`Treasury-rates ingestion failed: ${toErrorReason(error)}`);
      treasuryRates.warnings.push(toErrorReason(error));
    }
  }

  if (includeIndicators) {
    try {
      economicIndicators = await ingestFmpEconomicIndicators({
        namesOrSeries: options.indicatorNamesOrSeries ?? DEFAULT_INDICATOR_NAMES,
        from: options.indicatorsFrom,
        to: options.indicatorsTo,
        limit: options.indicatorsLimit,
      });
    } catch (error) {
      warnings.push(`Economic-indicators ingestion failed: ${toErrorReason(error)}`);
      economicIndicators.warnings.push(toErrorReason(error));
    }
  }

  if (includeCalendar) {
    try {
      const from =
        options.calendarFrom ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const to =
        options.calendarTo ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      economicCalendar = await ingestFmpEconomicCalendar({ from, to });
    } catch (error) {
      warnings.push(`Economic-calendar ingestion failed: ${toErrorReason(error)}`);
      economicCalendar.warnings.push(toErrorReason(error));
    }
  }

  if (includeMarketRiskPremium) {
    try {
      const from =
        options.marketRiskPremiumFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      marketRiskPremium = await ingestFmpMarketRiskPremium({
        from,
        to: options.marketRiskPremiumTo ?? now,
      });
    } catch (error) {
      warnings.push(`Market-risk-premium ingestion failed: ${toErrorReason(error)}`);
      marketRiskPremium.warnings.push(toErrorReason(error));
    }
  }

  if (
    warnings.length === 0 &&
    treasuryRates.recordsCreated === 0 &&
    treasuryRates.recordsUpdated === 0 &&
    economicIndicators.recordsCreated === 0 &&
    economicIndicators.recordsUpdated === 0 &&
    economicCalendar.recordsCreated === 0 &&
    economicCalendar.recordsUpdated === 0 &&
    marketRiskPremium.recordsCreated === 0 &&
    marketRiskPremium.recordsUpdated === 0
  ) {
    warnings.push("FMP economics default set completed with no persisted records.");
  }

  const finishedAt = new Date();

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    treasuryRates,
    economicIndicators,
    economicCalendar,
    marketRiskPremium,
    warnings,
  };
}

export function isFmpEconomicsEntitlementError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) {
    return false;
  }

  if (error.statusCode === 402) {
    return true;
  }

  if (error instanceof ProviderConfigurationError) {
    return /current plan/i.test(error.message);
  }

  return false;
}
