import { HoldingStatus, Prisma } from "@prisma/client";

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
  RankDiscoveryCandidatesOptions,
  RankDiscoveryCandidatesResult,
  RankedDiscoveryCandidate,
  SkippedDiscoveryCandidate,
} from "../types/services";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";
import { ensureStockExists } from "./stocks.service";
import { getPortfolioOverview } from "./portfolios.service";
import { scoreTickerResearch } from "./research-scoring.service";
import { getWatchlistDetail } from "./watchlists.service";

const DEFAULT_DISCOVERY_CATEGORIES = [
  "GAINERS",
  "LOSERS",
  "ACTIVE",
  "ANALYST_UPGRADES",
  "ANALYST_DOWNGRADES",
] as const;

const DEFAULT_DISCOVERY_MIN_PRICE = 5;
const DEFAULT_DISCOVERY_MAX_CHANGE_PERCENT = 300;
const DISCOVERY_DEFAULT_RANK_LIMIT = 5;
const DISCOVERY_MAX_RANK_LIMIT = 25;
const DISCOVERY_SNAPSHOT_STALE_DAYS = 2;
const DISCOVERY_STRONG_RECOMMENDATION_SCORE = 70;
const DISCOVERY_MIN_RECOMMENDATION_SCORE = 60;
const DISCOVERY_MONITOR_ONLY_SCORE_FLOOR = 50;

const DISCOVERY_ACTION_LABELS = {
  STRONG_REVIEW: "Strong review candidate",
  REVIEW: "Review candidate",
  MONITOR_ONLY: "Monitor only",
  NOT_RECOMMENDED: "Not recommended from current snapshot",
} as const;

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

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return null;
}

function toNumberOrStringOrNull(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function ageInDays(value: Date | string | null | undefined, now: Date): number | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.floor((now.getTime() - parsed.getTime()) / DAY_MS);
}

function normalizeRankLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DISCOVERY_DEFAULT_RANK_LIMIT;
  }

  return Math.max(1, Math.min(DISCOVERY_MAX_RANK_LIMIT, Math.trunc(limit)));
}

function isHoldOffStance(stance: string): boolean {
  return stance.trim().toUpperCase() === "HOLD_OFF";
}

function toDiscoveryActionLabel(input: {
  compositeScore: number;
  suggestedStance: string;
}): string {
  if (isHoldOffStance(input.suggestedStance) || input.compositeScore < DISCOVERY_MONITOR_ONLY_SCORE_FLOOR) {
    return DISCOVERY_ACTION_LABELS.NOT_RECOMMENDED;
  }

  if (input.compositeScore >= DISCOVERY_STRONG_RECOMMENDATION_SCORE) {
    return DISCOVERY_ACTION_LABELS.STRONG_REVIEW;
  }

  if (input.compositeScore >= DISCOVERY_MIN_RECOMMENDATION_SCORE) {
    return DISCOVERY_ACTION_LABELS.REVIEW;
  }

  return DISCOVERY_ACTION_LABELS.MONITOR_ONLY;
}

function qualifiesForDiscoveryRecommendation(input: {
  compositeScore: number;
  suggestedStance: string;
}): boolean {
  return (
    input.compositeScore >= DISCOVERY_MIN_RECOMMENDATION_SCORE &&
    !isHoldOffStance(input.suggestedStance)
  );
}

function toCandidateWhy(input: {
  bullishFactors: string[];
  diversificationNotes: string[];
}): string[] {
  const reasons = dedupe([
    ...input.bullishFactors.slice(0, 2),
    ...input.diversificationNotes.slice(0, 2),
  ]).slice(0, 4);

  if (reasons.length > 0) {
    return reasons;
  }

  return [
    "Composite score reflects persisted local technical, fundamental, analyst, and news signals.",
  ];
}

function toCandidateCautions(input: {
  bearishFactors: string[];
  staleDataWarnings: string[];
  missingData: string[];
  actionLabel: string;
}): string[] {
  const cautions = dedupe([
    ...input.bearishFactors.slice(0, 2),
    ...input.staleDataWarnings.slice(0, 2),
    input.missingData.length > 0
      ? `Missing data: ${input.missingData.slice(0, 3).join(", ")}.`
      : "",
    input.actionLabel === DISCOVERY_ACTION_LABELS.NOT_RECOMMENDED
      ? "Current stance/score does not support a new-holding recommendation."
      : "",
  ]).slice(0, 4);

  if (cautions.length > 0) {
    return cautions;
  }

  return [
    "Signals are mixed; validate with refreshed snapshots before acting.",
  ];
}

function hasAnalystMainBlocker(candidate: RankedDiscoveryCandidate): boolean {
  const analystMissing = candidate.missingData
    .map((value) => value.toLowerCase())
    .some((value) => value.includes("analyst"));

  return (
    analystMissing &&
    !isHoldOffStance(candidate.suggestedStance) &&
    candidate.compositeScore >= DISCOVERY_MONITOR_ONLY_SCORE_FLOOR &&
    candidate.missingData.length <= 2
  );
}

function extractExchange(raw: unknown): string | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const exchangeCandidate = record.exchange ?? record.exchangeShortName ?? record.market;
  return typeof exchangeCandidate === "string" && exchangeCandidate.trim().length > 0
    ? exchangeCandidate.trim().toUpperCase()
    : null;
}

function extractSector(raw: unknown): string | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const sector = record.sector;
  return typeof sector === "string" && sector.trim().length > 0 ? sector.trim() : null;
}

function inferIsOtc(ticker: string, exchange: string | null): boolean {
  const normalizedTicker = ticker.trim().toUpperCase();
  const normalizedExchange = exchange?.trim().toUpperCase() ?? "";

  if (normalizedExchange.includes("OTC")) {
    return true;
  }

  return normalizedTicker.endsWith(".OTC") || normalizedTicker.endsWith(".PK");
}

function normalizeQualityFilters(options: ListDiscoveryCandidatesOptions): Required<Pick<
  ListDiscoveryCandidatesOptions,
  "excludeLowPrice" | "excludeOtc"
>> &
  Pick<
    ListDiscoveryCandidatesOptions,
    "minPrice" | "minVolume" | "minMarketCap" | "maxChangePercent" | "exchanges"
  > {
  return {
    minPrice: options.minPrice ?? DEFAULT_DISCOVERY_MIN_PRICE,
    minVolume: options.minVolume,
    minMarketCap: options.minMarketCap,
    maxChangePercent: options.maxChangePercent ?? DEFAULT_DISCOVERY_MAX_CHANGE_PERCENT,
    exchanges: options.exchanges,
    excludeOtc: options.excludeOtc ?? true,
    excludeLowPrice: options.excludeLowPrice ?? true,
  };
}

function passesDiscoveryQualityFilters(
  item: DiscoveryCandidatesResult["items"][number],
  options: ListDiscoveryCandidatesOptions,
): boolean {
  const filters = normalizeQualityFilters(options);
  const price = toNumberOrNull(item.price);
  const volume = toNumberOrNull(item.volume);
  const marketCap = toNumberOrNull(item.marketCap);
  const changePercent = toNumberOrNull(item.changePercent);
  const exchange = extractExchange(item.raw);
  const isOtc = inferIsOtc(item.ticker, exchange);

  if (filters.excludeLowPrice && filters.minPrice != null) {
    if (price == null || price < filters.minPrice) {
      return false;
    }
  }

  if (filters.minVolume != null) {
    if (volume == null || volume < filters.minVolume) {
      return false;
    }
  }

  if (filters.minMarketCap != null) {
    if (marketCap == null || marketCap < filters.minMarketCap) {
      return false;
    }
  }

  if (filters.maxChangePercent != null && changePercent != null) {
    if (Math.abs(changePercent) > filters.maxChangePercent) {
      return false;
    }
  }

  if (filters.excludeOtc && isOtc) {
    return false;
  }

  if (filters.exchanges && filters.exchanges.length > 0) {
    if (!exchange) {
      return false;
    }

    const allowed = new Set(filters.exchanges.map((value) => value.trim().toUpperCase()));
    if (!allowed.has(exchange)) {
      return false;
    }
  }

  return true;
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

  const latestBatch = await listLatestDiscoveryByCategory(
    normalizedCategory,
    normalizeListLimit(options.limit, 1000),
  );

  const filteredItems = latestBatch.filter((item) => passesDiscoveryQualityFilters(item, options));
  const items = filteredItems.slice(0, normalizeListLimit(options.limit));
  const warnings: string[] = [];
  const now = new Date();

  if (latestBatch.length === 0) {
    warnings.push(`No persisted discovery candidates found for category ${normalizedCategory}.`);
  }

  if (latestBatch.length > items.length) {
    warnings.push(
      `Quality filters removed ${latestBatch.length - items.length} candidate(s) for ${normalizedCategory}.`,
    );
  }

  const capturedAtDate = latestBatch[0]?.capturedAt ?? null;
  const snapshotAgeDays = ageInDays(capturedAtDate, now);

  if (snapshotAgeDays != null && snapshotAgeDays > DISCOVERY_SNAPSHOT_STALE_DAYS) {
    warnings.push(
      `Discovery snapshot for ${normalizedCategory} is ${snapshotAgeDays} day(s) old and may be stale.`,
    );
  }

  return {
    category: normalizedCategory,
    candidateCount: items.length,
    topTickers: items.map((item) => item.ticker).slice(0, 5),
    capturedAt: capturedAtDate?.toISOString(),
    warnings,
    items,
  };
}

function buildDiversificationNotes(input: {
  category: string;
  sector: string | null;
  alreadyHeld: boolean;
  portfolioTopSector: string | null;
  portfolioHoldingCount: number;
  hasPortfolioContext: boolean;
}): string[] {
  const notes: string[] = [];

  if (!input.hasPortfolioContext) {
    notes.push("Portfolio context was not provided; diversification fit could not be fully assessed.");
    return notes;
  }

  if (!input.alreadyHeld) {
    notes.push("Not currently held; can be evaluated as a potential diversification candidate.");
  }

  if (input.portfolioHoldingCount <= 3) {
    notes.push("Portfolio appears concentrated by holding count; size any new position conservatively.");
  }

  if (input.portfolioTopSector && input.sector) {
    if (input.portfolioTopSector.toLowerCase() === input.sector.toLowerCase()) {
      notes.push(`Matches current largest sector (${input.portfolioTopSector}) by holding count.`);
    } else {
      notes.push(`Sector differs from largest current sector (${input.portfolioTopSector}), which may improve diversification.`);
    }
  }

  if (input.category === "LOSERS") {
    notes.push("Losers-screen names can be mean-reversion setups with elevated downside volatility.");
  }

  if (input.category === "GAINERS") {
    notes.push("Gainers-screen names can carry momentum continuation potential but may be extended short term.");
  }

  return dedupe(notes).slice(0, 4);
}

function toSkipReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Ticker scoring failed.";
}

export async function rankDiscoveryCandidates(
  options: RankDiscoveryCandidatesOptions = {},
): Promise<RankDiscoveryCandidatesResult> {
  const category = assertNonBlank(options.category ?? "GAINERS", "category").toUpperCase();
  const limit = normalizeRankLimit(options.limit);
  const warnings: string[] = [];
  const refreshActions = new Set<string>();

  const discovery = await listDiscoveryCandidates(category, {
    limit: 1000,
  });

  warnings.push(...discovery.warnings);

  const portfolioOverview = options.portfolioId
    ? await getPortfolioOverview(assertNonBlank(options.portfolioId, "portfolioId"))
    : null;
  if (options.portfolioId && !portfolioOverview) {
    throw new Error("Portfolio not found.");
  }

  const watchlist = options.watchlistId
    ? await getWatchlistDetail(assertNonBlank(options.watchlistId, "watchlistId"))
    : null;
  if (options.watchlistId && !watchlist) {
    throw new Error("Watchlist not found.");
  }

  const ownedTickers = new Set(
    (portfolioOverview?.holdings ?? [])
      .filter((holding) => holding.status === HoldingStatus.OWNED)
      .map((holding) => holding.ticker.trim().toUpperCase()),
  );

  const watchlistTickers = new Set(
    (watchlist?.items ?? []).map((item) => item.stock.ticker.trim().toUpperCase()),
  );

  const portfolioTopSector = portfolioOverview?.topSectorsByCount[0]?.sector ?? null;
  const now = new Date();
  const scoredCandidates: RankedDiscoveryCandidate[] = [];
  const skippedCandidates: SkippedDiscoveryCandidate[] = [];

  for (const candidate of discovery.items) {
    const ticker = candidate.ticker.trim().toUpperCase();
    const alreadyHeld = ownedTickers.has(ticker);
    const alreadyInWatchlist = watchlistTickers.has(ticker);
    const excludeExistingHoldings = options.excludeExistingHoldings ?? true;
    const excludeExistingWatchlistItems = options.excludeExistingWatchlistItems ?? true;

    if (excludeExistingHoldings && alreadyHeld) {
      skippedCandidates.push({
        ticker,
        reason: "Ticker is already held in the portfolio.",
        missingData: [],
      });
      continue;
    }

    if (excludeExistingWatchlistItems && alreadyInWatchlist) {
      skippedCandidates.push({
        ticker,
        reason: "Ticker already exists in the target watchlist.",
        missingData: [],
      });
      continue;
    }

    try {
      const score = await scoreTickerResearch(ticker);
      const snapshotAgeDays = ageInDays(candidate.capturedAt, now);
      const discoveryStaleWarnings =
        snapshotAgeDays != null && snapshotAgeDays > DISCOVERY_SNAPSHOT_STALE_DAYS
          ? [`Discovery snapshot for ${ticker} is ${snapshotAgeDays} day(s) old.`]
          : [];
      const staleDataWarnings = dedupe([
        ...score.staleDataWarnings,
        ...discoveryStaleWarnings,
      ]);

      const sector = extractSector(candidate.raw);
      const diversificationNotes = buildDiversificationNotes({
        category,
        sector,
        alreadyHeld,
        portfolioTopSector,
        portfolioHoldingCount: portfolioOverview?.holdingCount ?? 0,
        hasPortfolioContext: Boolean(portfolioOverview),
      });

      const actionLabel = toDiscoveryActionLabel({
        compositeScore: score.compositeScore,
        suggestedStance: score.suggestedStance,
      });

      const qualifiesForRecommendation = qualifiesForDiscoveryRecommendation({
        compositeScore: score.compositeScore,
        suggestedStance: score.suggestedStance,
      });

      const why = toCandidateWhy({
        bullishFactors: score.bullishFactors,
        diversificationNotes,
      });

      const cautions = toCandidateCautions({
        bearishFactors: score.bearishFactors,
        staleDataWarnings,
        missingData: score.missingData,
        actionLabel,
      });

      scoredCandidates.push({
        rank: 0,
        ticker,
        companyName: candidate.companyName ?? null,
        category,
        price: toNumberOrNull(candidate.price),
        changePercent: toNumberOrNull(candidate.changePercent),
        marketCap: toNumberOrStringOrNull(candidate.marketCap),
        compositeScore: score.compositeScore,
        suggestedStance: score.suggestedStance,
        actionLabel,
        qualifiesForRecommendation,
        why,
        cautions,
        dataQualityScore: score.componentScores.dataQualityScore,
        bullishFactors: score.bullishFactors.slice(0, 4),
        bearishFactors: score.bearishFactors.slice(0, 4),
        missingData: score.missingData.slice(0, 6),
        staleDataWarnings: staleDataWarnings.slice(0, 6),
        diversificationNotes,
        alreadyHeld,
        alreadyInWatchlist,
      });
    } catch (error) {
      const reason = toSkipReason(error);
      const missingData = error instanceof Error && /not found/i.test(error.message)
        ? ["researchBundle"]
        : [];

      skippedCandidates.push({
        ticker,
        reason,
        missingData,
      });
      warnings.push(`Skipped ${ticker}: ${reason}`);
    }
  }

  scoredCandidates.sort((left, right) => {
    if (right.compositeScore !== left.compositeScore) {
      return right.compositeScore - left.compositeScore;
    }

    return left.ticker.localeCompare(right.ticker);
  });

  const rankedCandidates = scoredCandidates
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));

  const recommendedCandidates = rankedCandidates.filter((candidate) =>
    candidate.qualifiesForRecommendation,
  );

  const monitorCandidates = rankedCandidates.filter((candidate) =>
    candidate.actionLabel === DISCOVERY_ACTION_LABELS.MONITOR_ONLY,
  );

  const notRecommendedCandidates = rankedCandidates.filter((candidate) =>
    candidate.actionLabel === DISCOVERY_ACTION_LABELS.NOT_RECOMMENDED,
  );

  const noQualifiedCandidates = recommendedCandidates.length === 0;

  const bestAvailableButBelowThreshold = noQualifiedCandidates
    ? rankedCandidates
      .filter((candidate) => !candidate.qualifiesForRecommendation)
      .slice(0, 5)
    : [];

  const allLowOrHoldOff =
    rankedCandidates.length > 0 &&
    rankedCandidates.every((candidate) =>
      candidate.compositeScore < DISCOVERY_MONITOR_ONLY_SCORE_FLOOR ||
      isHoldOffStance(candidate.suggestedStance),
    );

  const reasonNoQualifiedCandidates = noQualifiedCandidates
    ? allLowOrHoldOff
      ? "All scored names were low-score or HOLD_OFF in the current snapshot."
      : "No scored names reached the minimum recommendation threshold for a new holding."
    : undefined;

  if (discovery.items.length > 0 && rankedCandidates.length === 0) {
    warnings.push(
      `Persisted discovery candidates were found for ${category}, but none could be scored with current local research coverage.`,
    );
  }

  if (rankedCandidates.some((candidate) => candidate.missingData.length > 0)) {
    warnings.push("Some ranked candidates have missing research fields; confidence is reduced.");
  }

  if (rankedCandidates.some((candidate) => candidate.staleDataWarnings.length > 0)) {
    warnings.push("Some ranked candidates include stale snapshots; consider running refresh actions before acting.");
  }

  const snapshotLooksWeak =
    discovery.items.length === 0 ||
    noQualifiedCandidates ||
    discovery.warnings.some((warning) => warning.toLowerCase().includes("stale"));

  if (snapshotLooksWeak) {
    refreshActions.add("refreshDiscoveryCategory");
  }

  if (rankedCandidates.some((candidate) => hasAnalystMainBlocker(candidate))) {
    refreshActions.add("refreshTickerAnalystData");
  }

  if (noQualifiedCandidates) {
    warnings.push("No attractive new-holding candidates met the current recommendation threshold.");
  }

  return {
    category,
    totalCandidates: discovery.items.length,
    scoredCandidatesCount: scoredCandidates.length,
    skippedCandidatesCount: skippedCandidates.length,
    recommendationThreshold: {
      minimumRecommendationScore: DISCOVERY_MIN_RECOMMENDATION_SCORE,
      monitorOnlyScoreFloor: DISCOVERY_MONITOR_ONLY_SCORE_FLOOR,
      monitorOnlyScoreCeiling: DISCOVERY_MIN_RECOMMENDATION_SCORE - 0.01,
      labels: {
        strongReviewCandidate: DISCOVERY_ACTION_LABELS.STRONG_REVIEW,
        reviewCandidate: DISCOVERY_ACTION_LABELS.REVIEW,
        monitorOnly: DISCOVERY_ACTION_LABELS.MONITOR_ONLY,
        notRecommended: DISCOVERY_ACTION_LABELS.NOT_RECOMMENDED,
      },
    },
    noQualifiedCandidates,
    reasonNoQualifiedCandidates,
    rankedCandidates,
    recommendedCandidates,
    monitorCandidates,
    notRecommendedCandidates,
    bestAvailableButBelowThreshold,
    skippedCandidates,
    warnings: dedupe(warnings),
    suggestedRefreshActions: [...refreshActions],
  };
}
