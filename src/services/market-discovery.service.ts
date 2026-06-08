import { Prisma } from "@prisma/client";

import { fmpAnalystProvider } from "../providers/fmp";
import {
  createMarketDiscoverySnapshot,
  listLatestDiscoveryByCategory,
} from "../repositories/market-discovery-snapshots.repository";
import {
  DiscoveryCandidatesResult,
  IngestDefaultMarketDiscoverySetResult,
  IngestMarketDiscoveryResult,
  ListDiscoveryCandidatesOptions,
} from "../types/services";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";
import { ensureStockExists } from "./stocks.service";

const DEFAULT_DISCOVERY_CATEGORIES = [
  "GAINERS",
  "LOSERS",
  "ACTIVE",
  "ANALYST_UPGRADES",
  "ANALYST_DOWNGRADES",
] as const;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function calculateDurationMs(startedAtDate: Date, finishedAtDate: Date): number {
  return Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
}

function toBigIntOrNull(value: number | undefined): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return BigInt(Math.trunc(value));
}

export async function ingestMarketDiscovery(
  category: string,
  options: ListDiscoveryCandidatesOptions = {},
): Promise<IngestMarketDiscoveryResult> {
  const normalizedCategory = assertNonBlank(category, "category").toUpperCase();

  const warnings: string[] = [];
  const movers = await fmpAnalystProvider.getMarketMovers(normalizedCategory, {
    limit: options.limit,
  });

  if (movers.length === 0) {
    warnings.push(`No discovery results returned for category ${normalizedCategory}.`);
  }

  let recordsCreated = 0;

  for (const mover of movers) {
    const normalizedTicker = normalizeTickerOrThrow(mover.ticker);

    const stock = await ensureStockExists(normalizedTicker, {
      companyName: mover.companyName,
    });

    await createMarketDiscoverySnapshot({
      source: mover.source ?? "FMP",
      category: normalizedCategory,
      ticker: normalizedTicker,
      stockId: stock.id,
      companyName: mover.companyName ?? stock.companyName ?? null,
      price: mover.price ?? null,
      changePercent: mover.changePercent ?? null,
      volume: toBigIntOrNull(mover.volume),
      marketCap: toBigIntOrNull(mover.marketCap),
      capturedAt: mover.capturedAt,
      raw: (mover.raw ?? Prisma.DbNull) as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput,
    });

    recordsCreated += 1;
  }

  return {
    category: normalizedCategory,
    capturedAt: (movers[0]?.capturedAt ?? new Date()).toISOString(),
    recordsCreated,
    warnings,
  };
}

export async function ingestDefaultMarketDiscoverySet(
  options: ListDiscoveryCandidatesOptions = {},
): Promise<IngestDefaultMarketDiscoverySetResult> {
  const startedAtDate = new Date();
  const categories: IngestMarketDiscoveryResult[] = [];
  const warnings: string[] = [];

  for (const category of DEFAULT_DISCOVERY_CATEGORIES) {
    try {
      const result = await ingestMarketDiscovery(category, options);
      categories.push(result);
      warnings.push(
        ...result.warnings.map((warning) => `${category}: ${warning}`),
      );
    } catch (error) {
      const reason = toErrorReason(error);
      warnings.push(`${category}: ${reason}`);
      categories.push({
        category,
        capturedAt: new Date().toISOString(),
        recordsCreated: 0,
        warnings: [reason],
      });
    }
  }

  const finishedAtDate = new Date();

  return {
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
    categories,
    warnings,
  };
}

export async function listDiscoveryCandidates(
  category: string,
  options: ListDiscoveryCandidatesOptions = {},
): Promise<DiscoveryCandidatesResult> {
  const normalizedCategory = assertNonBlank(category, "category").toUpperCase();

  const items = await listLatestDiscoveryByCategory(
    normalizedCategory,
    normalizeListLimit(options.limit),
  );

  return {
    category: normalizedCategory,
    items,
  };
}
