import { env } from "../config/env";
import { bankOfCanadaProvider } from "../providers/bank-of-canada";
import { FRED_DEFAULT_SERIES_IDS, fredProvider } from "../providers/fred";
import {
  IngestDefaultFredMacroSetOptions,
  IngestDefaultMacroAndFxOptions,
  IngestDefaultMacroAndFxResult,
  MacroIngestionDateRangeOptions,
  MacroIngestionSectionResult,
} from "../types/services";
import { upsertFxRateSnapshot } from "./fx-rates.service";
import { upsertMacroSeriesObservation } from "./macro-series.service";

const BANK_OF_CANADA_PROVIDER = "BANK_OF_CANADA";
const FRED_BATCH_SIZE = 3;

interface MutableSectionCounter {
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  warnings: string[];
  failedSeries: string[];
}

function emptySection(): MutableSectionCounter {
  return {
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    warnings: [],
    failedSeries: [],
  };
}

function asSection(counter: MutableSectionCounter): MacroIngestionSectionResult {
  const failedSeries = [...new Set(counter.failedSeries)];

  return {
    recordsCreated: counter.recordsCreated,
    recordsUpdated: counter.recordsUpdated,
    recordsSkipped: counter.recordsSkipped,
    warnings: [...counter.warnings],
    ...(failedSeries.length > 0 ? { failedSeries } : {}),
  };
}

function withSectionTiming(
  section: MacroIngestionSectionResult,
  startedAtDate: Date,
  finishedAtDate: Date,
): MacroIngestionSectionResult {
  return {
    ...section,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
  };
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback?: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }

  return normalized;
}

function buildSkippedSection(
  startedAtDate: Date,
  message?: string,
): MacroIngestionSectionResult {
  const finishedAtDate = new Date();

  return withSectionTiming(
    {
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      warnings: message ? [message] : [],
    },
    startedAtDate,
    finishedAtDate,
  );
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function normalizeSeriesId(seriesId: string): string {
  const normalized = seriesId.trim().toUpperCase();
  if (!normalized) {
    throw new Error("seriesId is required.");
  }

  return normalized;
}

function mergeSection(target: MutableSectionCounter, section: MacroIngestionSectionResult): void {
  target.recordsCreated += section.recordsCreated;
  target.recordsUpdated += section.recordsUpdated;
  target.recordsSkipped += section.recordsSkipped;
  target.warnings.push(...section.warnings);
  if (section.failedSeries) {
    target.failedSeries.push(...section.failedSeries);
  }
}

export async function ingestBankOfCanadaUsdCad(
  options: MacroIngestionDateRangeOptions = {},
): Promise<MacroIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter = emptySection();
  const seriesId = env.BANK_OF_CANADA_USD_CAD_SERIES_ID;

  try {
    const rates = await bankOfCanadaProvider.getUsdCadRate(options);

    if (rates.length === 0) {
      counter.warnings.push(`No Bank of Canada USD/CAD records returned for series ${seriesId}.`);
      return asSection(counter);
    }

    for (const rate of rates) {
      if (!Number.isFinite(rate.rate)) {
        counter.recordsSkipped += 1;
        continue;
      }

      const upsert = await upsertFxRateSnapshot({
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: rate.rate,
        capturedAt: rate.capturedAt,
        source: rate.source ?? BANK_OF_CANADA_PROVIDER,
      });

      if (upsert.created) {
        counter.recordsCreated += 1;
      } else if (upsert.updated) {
        counter.recordsUpdated += 1;
      } else {
        counter.recordsSkipped += 1;
      }
    }
  } catch (error) {
    counter.warnings.push(
      `Bank of Canada USD/CAD ingestion failed (${seriesId}): ${toErrorReason(error)}`,
    );
    counter.failedSeries.push(seriesId);
  }

  const finishedAtDate = new Date();

  return withSectionTiming(asSection(counter), startedAtDate, finishedAtDate);
}

export async function ingestBankOfCanadaSeries(
  seriesId: string,
  options: MacroIngestionDateRangeOptions = {},
): Promise<MacroIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter = emptySection();
  const normalizedSeriesId = normalizeSeriesId(seriesId);

  try {
    const observations = await bankOfCanadaProvider.getSeriesObservations(
      normalizedSeriesId,
      options,
    );

    if (observations.length === 0) {
      counter.warnings.push(
        `No Bank of Canada observations returned for series ${normalizedSeriesId}.`,
      );
      return asSection(counter);
    }

    for (const observation of observations) {
      if (!Number.isFinite(observation.value)) {
        counter.recordsSkipped += 1;
        continue;
      }

      const upsert = await upsertMacroSeriesObservation({
        provider: observation.provider,
        seriesId: observation.seriesId,
        observedAt: observation.observedAt,
        value: observation.value,
        name: observation.name ?? null,
        country: observation.country ?? null,
        category: observation.category ?? null,
        unit: observation.unit ?? null,
      });

      if (upsert.created) {
        counter.recordsCreated += 1;
      } else if (upsert.updated) {
        counter.recordsUpdated += 1;
      } else {
        counter.recordsSkipped += 1;
      }
    }
  } catch (error) {
    counter.warnings.push(
      `Bank of Canada ingestion failed for series ${normalizedSeriesId}: ${toErrorReason(error)}`,
    );
    counter.failedSeries.push(normalizedSeriesId);
  }

  const finishedAtDate = new Date();

  return withSectionTiming(asSection(counter), startedAtDate, finishedAtDate);
}

export async function ingestFredSeries(
  seriesId: string,
  options: MacroIngestionDateRangeOptions = {},
): Promise<MacroIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter = emptySection();
  const normalizedSeriesId = normalizeSeriesId(seriesId);

  try {
    const observations = await fredProvider.getSeriesObservations(normalizedSeriesId, options);

    if (observations.length === 0) {
      counter.warnings.push(`No FRED observations returned for series ${normalizedSeriesId}.`);
      return asSection(counter);
    }

    for (const observation of observations) {
      if (!Number.isFinite(observation.value)) {
        counter.recordsSkipped += 1;
        continue;
      }

      const upsert = await upsertMacroSeriesObservation({
        provider: observation.provider,
        seriesId: observation.seriesId,
        observedAt: observation.observedAt,
        value: observation.value,
        name: observation.name ?? null,
        country: observation.country ?? null,
        category: observation.category ?? null,
        unit: observation.unit ?? null,
      });

      if (upsert.created) {
        counter.recordsCreated += 1;
      } else if (upsert.updated) {
        counter.recordsUpdated += 1;
      } else {
        counter.recordsSkipped += 1;
      }
    }
  } catch (error) {
    counter.warnings.push(`FRED ingestion failed for series ${normalizedSeriesId}: ${toErrorReason(error)}`);
    counter.failedSeries.push(normalizedSeriesId);
  }

  const finishedAtDate = new Date();

  return withSectionTiming(asSection(counter), startedAtDate, finishedAtDate);
}

export async function ingestDefaultFredMacroSet(
  options: IngestDefaultFredMacroSetOptions = {},
): Promise<MacroIngestionSectionResult> {
  const startedAtDate = new Date();
  const counter = emptySection();
  const maxSeries = normalizePositiveInteger(options.maxSeries);
  const seriesIds =
    options.seriesIds && options.seriesIds.length > 0
      ? options.seriesIds
      : FRED_DEFAULT_SERIES_IDS;
  const selectedSeriesIds = maxSeries ? seriesIds.slice(0, maxSeries) : seriesIds;

  if (selectedSeriesIds.length === 0) {
    const finishedAtDate = new Date();
    return withSectionTiming(
      {
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        warnings: ["FRED default set skipped because no series IDs were selected."],
      },
      startedAtDate,
      finishedAtDate,
    );
  }

  for (let index = 0; index < selectedSeriesIds.length; index += FRED_BATCH_SIZE) {
    const batch = selectedSeriesIds.slice(index, index + FRED_BATCH_SIZE);

    const sections = await Promise.all(
      batch.map((seriesId) =>
        ingestFredSeries(seriesId, {
          from: options.from,
          to: options.to,
          limit: options.limit,
        }),
      ),
    );

    for (const section of sections) {
      mergeSection(counter, section);
    }
  }

  if (
    counter.recordsCreated === 0 &&
    counter.recordsUpdated === 0 &&
    counter.recordsSkipped === 0 &&
    counter.warnings.length === 0
  ) {
    counter.warnings.push("FRED default set completed with no observations.");
  }

  const finishedAtDate = new Date();

  return withSectionTiming(asSection(counter), startedAtDate, finishedAtDate);
}

export async function ingestDefaultMacroAndFx(
  options: IngestDefaultMacroAndFxOptions = {},
): Promise<IngestDefaultMacroAndFxResult> {
  const startedAtDate = new Date();

  const includeBankOfCanada = options.includeBankOfCanada ?? true;
  const includeFred = options.includeFred ?? true;

  const bankLimit = normalizePositiveInteger(options.bankOfCanadaLimit, options.limit);
  const fredLimit = normalizePositiveInteger(options.fredObservationLimit, options.limit);
  const maxFredSeries = normalizePositiveInteger(options.maxFredSeries);

  const bankOfCanada = includeBankOfCanada
    ? await ingestBankOfCanadaUsdCad({
        from: options.from,
        to: options.to,
        limit: bankLimit,
      })
    : buildSkippedSection(startedAtDate);

  const fred = includeFred
    ? await ingestDefaultFredMacroSet({
        from: options.from,
        to: options.to,
        limit: fredLimit,
        seriesIds: options.fredSeriesIds,
        maxSeries: maxFredSeries,
      })
    : buildSkippedSection(startedAtDate);

  const warnings: string[] = [];

  if (bankOfCanada.warnings.length > 0) {
    warnings.push(`Bank of Canada macro/FX ingestion completed with ${bankOfCanada.warnings.length} warning(s).`);
  }

  if (fred.warnings.length > 0) {
    warnings.push(`FRED macro ingestion completed with ${fred.warnings.length} warning(s).`);
  }

  if (!includeBankOfCanada && !includeFred) {
    warnings.push("Default macro ingestion skipped because all macro providers were disabled.");
  }

  const finishedAtDate = new Date();

  return {
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
    bankOfCanada,
    fred,
    warnings,
  };
}
