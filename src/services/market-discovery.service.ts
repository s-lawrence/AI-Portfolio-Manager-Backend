import { HoldingStatus, MarketDiscoverySnapshot, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { fmpAnalystProvider } from "../providers/fmp";
import {
  createMarketDiscoverySnapshot,
  listLatestDiscoveryByCategory,
  listRecentDiscovery,
} from "../repositories/market-discovery-snapshots.repository";
import {
  AgentInvestmentPreferences,
  AgentInvestmentRiskTolerance,
  AgentInvestmentTimeHorizon,
  DiscoveryCandidatesResult,
  IngestDefaultMarketDiscoverySetResult,
  IngestMarketDiscoveryResult,
  ListDiscoveryCandidatesOptions,
  ScreenMarketCandidate,
  ScreenMarketCandidatesOptions,
  ScreenMarketCandidatesResult,
  RankDiscoveryCandidatesOptions,
  RankDiscoveryCandidatesResult,
  RankedDiscoveryCandidate,
  RejectedScreenMarketCandidate,
  SkippedDiscoveryCandidate,
} from "../types/services";
import { normalizeListLimit, normalizeTickerOrThrow } from "../types/common";
import { ensureStockExists, getStockResearchBundle } from "./stocks.service";
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

const SCREEN_DEFAULT_LIMIT = 5;
const SCREEN_MAX_LIMIT = 25;
const SCREEN_POOL_LIMIT = 80;
const SCREEN_MIN_QUALIFIED_SCORE = 60;
const SCREEN_STRONG_CANDIDATE_SCORE = 75;

const ACTIVE_WATCHLIST_SCREEN_STATUSES = new Set([
  "WATCHING",
  "RESEARCHING",
  "CANDIDATE",
]);

type NormalizedScreenPreferences = AgentInvestmentPreferences & {
  objective: NonNullable<AgentInvestmentPreferences["objective"]>;
  timeHorizon: AgentInvestmentTimeHorizon;
  riskTolerance: AgentInvestmentRiskTolerance;
  preferredSectors: string[];
  excludedSectors: string[];
  preferredCurrencies: string[];
};

type CandidatePoolEntry = {
  ticker: string;
  companyName: string | null;
  sources: Set<string>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return dedupe(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function normalizeScreenLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return SCREEN_DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(SCREEN_MAX_LIMIT, Math.trunc(limit)));
}

function normalizePreferencesForScreening(
  preferences: AgentInvestmentPreferences | undefined,
): {
  normalized: NormalizedScreenPreferences;
  assumptions: string[];
} {
  const assumptions: string[] = [];

  const objective = preferences?.objective ?? "GROWTH";
  if (!preferences?.objective) {
    assumptions.push("Objective defaulted to GROWTH.");
  }

  const timeHorizon = preferences?.timeHorizon ?? (objective === "GROWTH" ? "LONG" : "MEDIUM");
  if (!preferences?.timeHorizon) {
    assumptions.push(`Time horizon defaulted to ${timeHorizon}.`);
  }

  const riskTolerance = preferences?.riskTolerance ?? "MEDIUM";
  if (!preferences?.riskTolerance) {
    assumptions.push("Risk tolerance defaulted to MEDIUM.");
  }

  const preferredSectors = normalizeStringList(preferences?.preferredSectors);
  const excludedSectors = normalizeStringList(preferences?.excludedSectors);
  const preferredCurrencies = normalizeStringList(preferences?.preferredCurrencies).map((value) => value.toUpperCase());

  const maxSinglePositionWeight =
    typeof preferences?.maxSinglePositionWeight === "number" && Number.isFinite(preferences.maxSinglePositionWeight)
      ? clamp(preferences.maxSinglePositionWeight, 0, 100)
      : undefined;

  return {
    normalized: {
      objective,
      timeHorizon,
      riskTolerance,
      preferredSectors,
      excludedSectors,
      preferredCurrencies,
      maxSinglePositionWeight,
      wantsIncome: preferences?.wantsIncome,
      wantsCanada: preferences?.wantsCanada,
      wantsUS: preferences?.wantsUS,
    },
    assumptions,
  };
}

function isHoldOffLabel(value: string): boolean {
  return value.trim().toLowerCase().includes("hold off");
}

function isCanadianTicker(input: {
  ticker: string;
  currency: string | null | undefined;
  country: string | null | undefined;
}): boolean {
  const ticker = input.ticker.trim().toUpperCase();
  const currency = input.currency?.trim().toUpperCase() ?? "";
  const country = input.country?.trim().toUpperCase() ?? "";

  return (
    country === "CA" ||
    currency === "CAD" ||
    ticker.endsWith(".TO") ||
    ticker.endsWith(".V")
  );
}

function isUsTicker(input: {
  ticker: string;
  currency: string | null | undefined;
  country: string | null | undefined;
}): boolean {
  const ticker = input.ticker.trim().toUpperCase();
  const currency = input.currency?.trim().toUpperCase() ?? "";
  const country = input.country?.trim().toUpperCase() ?? "";

  return country === "US" || currency === "USD" || (!ticker.includes(".") && currency === "USD");
}

function toPriorityFromRecommendationScore(totalRecommendationScore: number): "LOW" | "MEDIUM" | "HIGH" {
  if (totalRecommendationScore >= SCREEN_STRONG_CANDIDATE_SCORE) {
    return "HIGH";
  }

  if (totalRecommendationScore >= SCREEN_MIN_QUALIFIED_SCORE) {
    return "MEDIUM";
  }

  return "LOW";
}

function toCandidateAddedReason(input: {
  ticker: string;
  objective: string;
  score: number;
  fitReasons: string[];
}): string {
  const reason = input.fitReasons[0] ?? "Persisted signals align with current objective.";
  return `${input.ticker}: ${input.objective.toLowerCase()} fit with composite score ${input.score.toFixed(1)}. ${reason}`;
}

function addCandidateToPool(
  pool: Map<string, CandidatePoolEntry>,
  ticker: string,
  companyName: string | null,
  source: string,
): void {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const existing = pool.get(normalizedTicker);

  if (!existing) {
    pool.set(normalizedTicker, {
      ticker: normalizedTicker,
      companyName: companyName ?? null,
      sources: new Set([source]),
    });
    return;
  }

  existing.sources.add(source);
  if (!existing.companyName && companyName) {
    existing.companyName = companyName;
  }
}

function buildPreferenceFit(input: {
  preferences: NormalizedScreenPreferences;
  score: Awaited<ReturnType<typeof scoreTickerResearch>>;
  ticker: string;
  sector: string | null;
  currency: string | null;
  country: string | null;
  dividendYield: number | null;
  projectedVolatility: number | null;
}): {
  preferenceFitScore: number;
  reasons: string[];
  cautions: string[];
  missingData: string[];
} {
  let preferenceFitScore = 50;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const missingData: string[] = [];

  const objective = input.preferences.objective;

  if (objective === "GROWTH") {
    if (input.score.componentScores.technicalScore >= 60) {
      preferenceFitScore += 8;
      reasons.push("Technical trend component supports growth follow-through.");
    }

    if (input.score.componentScores.fundamentalScore >= 55) {
      preferenceFitScore += 7;
      reasons.push("Fundamental component is supportive for growth positioning.");
    }
  }

  if (objective === "VALUE") {
    if (input.score.componentScores.valuationScore >= 60) {
      preferenceFitScore += 12;
      reasons.push("Valuation component is favorable relative to the universe.");
    } else {
      preferenceFitScore -= 7;
      cautions.push("Valuation component is not currently strong for a value objective.");
    }
  }

  if (objective === "DIVIDEND") {
    if (input.dividendYield != null && input.dividendYield > 0) {
      preferenceFitScore += 14;
      reasons.push(`Dividend yield is present (${input.dividendYield.toFixed(2)}%).`);
    } else {
      preferenceFitScore -= 10;
      cautions.push("Dividend objective requested, but no usable dividend yield is available.");
      missingData.push("dividendYield");
    }
  }

  if (objective === "QUALITY") {
    if (input.score.componentScores.fundamentalScore >= 60) {
      preferenceFitScore += 10;
      reasons.push("Fundamental quality component is above threshold.");
    }

    if (input.score.componentScores.analystScore >= 55) {
      preferenceFitScore += 5;
      reasons.push("Analyst component is supportive.");
    }
  }

  if (objective === "LOW_VOLATILITY") {
    if (input.projectedVolatility == null) {
      preferenceFitScore -= 6;
      cautions.push("Low-volatility objective requested, but projected volatility is unavailable.");
      missingData.push("projectedVolatility");
    } else if (input.projectedVolatility <= 0.35) {
      preferenceFitScore += 12;
      reasons.push("Projected volatility is relatively low.");
    } else if (input.projectedVolatility >= 0.65) {
      preferenceFitScore -= 12;
      cautions.push("Projected volatility is elevated for a low-risk objective.");
    }
  }

  if (objective === "MOMENTUM") {
    if (input.score.componentScores.technicalScore >= 65) {
      preferenceFitScore += 12;
      reasons.push("Technical momentum component is strong.");
    } else {
      preferenceFitScore -= 5;
      cautions.push("Technical momentum component is not strong yet.");
    }
  }

  if (input.preferences.wantsIncome === true) {
    if (input.dividendYield != null && input.dividendYield > 0) {
      preferenceFitScore += 8;
      reasons.push("Income preference aligns with available dividend yield.");
    } else {
      preferenceFitScore -= 7;
      cautions.push("Income preference was requested, but dividend support looks limited.");
    }
  }

  if (input.preferences.preferredSectors.length > 0) {
    if (input.sector && input.preferences.preferredSectors.some(
      (value) => value.toLowerCase() === input.sector?.toLowerCase(),
    )) {
      preferenceFitScore += 8;
      reasons.push(`Sector aligns with preference (${input.sector}).`);
    } else {
      preferenceFitScore -= 4;
      cautions.push("Preferred sectors were provided, but this ticker is outside that set.");
    }
  }

  if (input.preferences.excludedSectors.length > 0 && input.sector) {
    if (input.preferences.excludedSectors.some((value) => value.toLowerCase() === input.sector?.toLowerCase())) {
      preferenceFitScore -= 25;
      cautions.push(`Sector (${input.sector}) is in the excluded sector set.`);
    }
  }

  if (input.preferences.preferredCurrencies.length > 0) {
    if (
      input.currency &&
      input.preferences.preferredCurrencies.some((value) => value.toUpperCase() === input.currency?.toUpperCase())
    ) {
      preferenceFitScore += 6;
      reasons.push(`Currency aligns with preference (${input.currency?.toUpperCase()}).`);
    } else {
      preferenceFitScore -= 3;
      cautions.push("Preferred currencies were provided, but this ticker does not align.");
    }
  }

  if (input.preferences.wantsCanada === true) {
    if (isCanadianTicker({ ticker: input.ticker, currency: input.currency, country: input.country })) {
      preferenceFitScore += 6;
      reasons.push("Matches Canada preference.");
    } else {
      preferenceFitScore -= 4;
      cautions.push("Canada preference requested, but ticker appears non-Canadian.");
    }
  }

  if (input.preferences.wantsUS === true) {
    if (isUsTicker({ ticker: input.ticker, currency: input.currency, country: input.country })) {
      preferenceFitScore += 6;
      reasons.push("Matches US preference.");
    } else {
      preferenceFitScore -= 4;
      cautions.push("US preference requested, but ticker appears non-US.");
    }
  }

  if (input.preferences.riskTolerance === "LOW") {
    if (
      input.score.componentScores.macroRiskScore >= 55 &&
      input.score.componentScores.earningsRiskScore >= 55
    ) {
      preferenceFitScore += 8;
      reasons.push("Risk components are supportive for lower-risk positioning.");
    } else {
      preferenceFitScore -= 8;
      cautions.push("Risk components look weaker than preferred for LOW risk tolerance.");
    }
  }

  if (input.preferences.riskTolerance === "HIGH" && input.score.compositeScore >= SCREEN_MIN_QUALIFIED_SCORE) {
    preferenceFitScore += 4;
  }

  if (input.preferences.timeHorizon === "SHORT") {
    if (input.projectedVolatility != null && input.projectedVolatility > 0.7) {
      preferenceFitScore -= 8;
      cautions.push("Projected volatility is high for a short time horizon.");
    }
  }

  if (input.preferences.timeHorizon === "LONG" && input.score.componentScores.fundamentalScore >= 55) {
    preferenceFitScore += 5;
    reasons.push("Fundamental component supports longer horizon evaluation.");
  }

  return {
    preferenceFitScore: clamp(preferenceFitScore, 0, 100),
    reasons: dedupe(reasons),
    cautions: dedupe(cautions),
    missingData: dedupe(missingData),
  };
}

function buildPortfolioFit(input: {
  preferences: NormalizedScreenPreferences;
  portfolioOverview: Awaited<ReturnType<typeof getPortfolioOverview>> | null;
  ticker: string;
  sector: string | null;
  alreadyHeld: boolean;
}): {
  portfolioFitScore: number;
  reasons: string[];
  cautions: string[];
} {
  if (!input.portfolioOverview) {
    return {
      portfolioFitScore: 55,
      reasons: ["Portfolio context not provided; neutral portfolio-fit baseline applied."],
      cautions: [],
    };
  }

  if (input.portfolioOverview.holdingCount === 0) {
    return {
      portfolioFitScore: 65,
      reasons: ["Portfolio has no current holdings; candidate can be evaluated as an initial position."],
      cautions: [],
    };
  }

  let portfolioFitScore = 50;
  const reasons: string[] = [];
  const cautions: string[] = [];

  const largestSector = input.portfolioOverview.topSectorsByCount[0]?.sector ?? null;
  if (largestSector && input.sector) {
    if (largestSector.toLowerCase() !== input.sector.toLowerCase()) {
      portfolioFitScore += 12;
      reasons.push(`Sector differs from portfolio concentration (${largestSector}), aiding diversification.`);
    } else {
      portfolioFitScore -= 8;
      cautions.push(`Sector matches current concentration (${largestSector}).`);
    }
  }

  if (input.preferences.objective === "DIVERSIFICATION" && largestSector && input.sector) {
    if (largestSector.toLowerCase() !== input.sector.toLowerCase()) {
      portfolioFitScore += 10;
      reasons.push("Diversification objective is supported by sector offset.");
    }
  }

  if (input.portfolioOverview.holdingCount <= 4 && !input.alreadyHeld) {
    portfolioFitScore += 5;
    reasons.push("Portfolio appears concentrated by holding count; a qualified new name may improve breadth.");
  }

  if (input.preferences.maxSinglePositionWeight != null) {
    cautions.push(
      `Max single-position preference (${input.preferences.maxSinglePositionWeight.toFixed(1)}%) noted; position sizing should be enforced when executing trades.`,
    );
  }

  return {
    portfolioFitScore: clamp(portfolioFitScore, 0, 100),
    reasons: dedupe(reasons),
    cautions: dedupe(cautions),
  };
}

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

export async function screenMarketCandidates(
  options: ScreenMarketCandidatesOptions = {},
): Promise<ScreenMarketCandidatesResult> {
  const limit = normalizeScreenLimit(options.limit);
  const { normalized: preferencesApplied, assumptions } = normalizePreferencesForScreening(options.preferences);
  const clarifyingQuestion = options.preferences?.objective
    ? undefined
    : "What are you optimizing for: growth, dividends, lower risk, or diversification?";

  const [recentDiscovery, knownStocks, portfolioOverview, watchlistDetail] = await Promise.all([
    listRecentDiscovery(SCREEN_POOL_LIMIT),
    prisma.stock.findMany({
      where: {
        OR: [
          { priceSnapshots: { some: {} } },
          { technicalSnapshots: { some: {} } },
          { fundamentalSnapshots: { some: {} } },
          { analystSnapshots: { some: {} } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { ticker: "asc" }],
      take: SCREEN_POOL_LIMIT,
      select: {
        ticker: true,
        companyName: true,
      },
    }),
    options.portfolioId
      ? getPortfolioOverview(assertNonBlank(options.portfolioId, "portfolioId"))
      : Promise.resolve(null),
    options.watchlistId
      ? getWatchlistDetail(assertNonBlank(options.watchlistId, "watchlistId"))
      : Promise.resolve(null),
  ]);

  if (options.portfolioId && !portfolioOverview) {
    throw new Error("Portfolio not found.");
  }

  if (options.watchlistId && !watchlistDetail) {
    throw new Error("Watchlist not found.");
  }

  const ownedTickers = new Set(
    (portfolioOverview?.holdings ?? [])
      .filter((holding) => holding.status === HoldingStatus.OWNED)
      .map((holding) => holding.ticker.trim().toUpperCase()),
  );

  const watchlistTickers = new Set(
    (watchlistDetail?.items ?? [])
      .filter((item) => ACTIVE_WATCHLIST_SCREEN_STATUSES.has(item.status))
      .map((item) => item.stock.ticker.trim().toUpperCase()),
  );

  const excludeExistingHoldings = options.excludeExistingHoldings ?? true;
  const excludeExistingWatchlistItems = options.excludeExistingWatchlistItems ?? true;

  const pool = new Map<string, CandidatePoolEntry>();
  const latestDiscoveryByTicker = new Map<string, MarketDiscoverySnapshot>();

  for (const snapshot of recentDiscovery) {
    const ticker = snapshot.ticker.trim().toUpperCase();
    if (!latestDiscoveryByTicker.has(ticker)) {
      latestDiscoveryByTicker.set(ticker, snapshot);
    }

    addCandidateToPool(pool, ticker, snapshot.companyName ?? null, "DISCOVERY");
  }

  for (const stock of knownStocks) {
    addCandidateToPool(pool, stock.ticker, stock.companyName ?? null, "KNOWN_STOCK");
  }

  for (const item of watchlistDetail?.items ?? []) {
    addCandidateToPool(pool, item.stock.ticker, item.stock.companyName ?? null, "WATCHLIST");
  }

  const screenedTickers = [...pool.values()].slice(0, SCREEN_POOL_LIMIT);
  const candidates: ScreenMarketCandidate[] = [];
  const rejectedCandidates: RejectedScreenMarketCandidate[] = [];
  const suggestedRefreshActions = new Set<string>();

  if (recentDiscovery.length === 0) {
    suggestedRefreshActions.add("refreshDiscoveryCategory");
    assumptions.push("No recent discovery snapshots found; screening relied more heavily on existing local stock coverage.");
  }

  for (const entry of screenedTickers) {
    const ticker = entry.ticker;
    const alreadyHeld = ownedTickers.has(ticker);
    const alreadyInWatchlist = watchlistTickers.has(ticker);

    if (excludeExistingHoldings && alreadyHeld) {
      rejectedCandidates.push({
        ticker,
        reason: "Ticker is already held in the portfolio.",
        missingData: [],
        alreadyHeld,
        alreadyInWatchlist,
      });
      continue;
    }

    if (excludeExistingWatchlistItems && alreadyInWatchlist) {
      rejectedCandidates.push({
        ticker,
        reason: "Ticker already exists in the target watchlist.",
        missingData: [],
        alreadyHeld,
        alreadyInWatchlist,
      });
      continue;
    }

    try {
      const [score, bundle] = await Promise.all([
        scoreTickerResearch(ticker),
        getStockResearchBundle(ticker),
      ]);

      if (!bundle) {
        rejectedCandidates.push({
          ticker,
          reason: "Ticker has no persisted research bundle.",
          score: score.compositeScore,
          actionLabel: score.actionLabel,
          missingData: ["researchBundle"],
          alreadyHeld,
          alreadyInWatchlist,
        });
        continue;
      }

      const discoverySnapshot = latestDiscoveryByTicker.get(ticker);
      const sector = bundle.stock.sector ?? extractSector(discoverySnapshot?.raw) ?? null;
      const currency = bundle.stock.currency ?? null;
      const country = bundle.stock.country ?? null;
      const dividendYield = bundle.latestFundamentalSnapshot?.dividendYield ?? null;

      const technicalRecord = toRecord(bundle.latestTechnicalSnapshot);
      const projectedVolatility = toNumberOrNull(technicalRecord?.volatility);

      const preferenceFit = buildPreferenceFit({
        preferences: preferencesApplied,
        score,
        ticker,
        sector,
        currency,
        country,
        dividendYield,
        projectedVolatility,
      });

      const portfolioFit = buildPortfolioFit({
        preferences: preferencesApplied,
        portfolioOverview,
        ticker,
        sector,
        alreadyHeld,
      });

      const totalRecommendationScore = clamp(
        score.compositeScore * 0.6 + preferenceFit.preferenceFitScore * 0.25 + portfolioFit.portfolioFitScore * 0.15,
        0,
        100,
      );

      const actionLabel = isHoldOffStance(score.suggestedStance) || totalRecommendationScore < SCREEN_MIN_QUALIFIED_SCORE
        ? "Hold off / insufficient signal"
        : totalRecommendationScore >= SCREEN_STRONG_CANDIDATE_SCORE
          ? DISCOVERY_ACTION_LABELS.STRONG_REVIEW
          : DISCOVERY_ACTION_LABELS.REVIEW;

      const missingData = dedupe([
        ...score.missingData,
        ...preferenceFit.missingData,
      ]);

      if (missingData.some((value) => value.toLowerCase().includes("analyst"))) {
        suggestedRefreshActions.add("refreshTickerAnalystData");
      }

      const why = dedupe([
        ...preferenceFit.reasons,
        ...portfolioFit.reasons,
        ...score.bullishFactors.slice(0, 2),
      ]).slice(0, 5);

      const cautions = dedupe([
        ...preferenceFit.cautions,
        ...portfolioFit.cautions,
        ...score.bearishFactors.slice(0, 2),
        ...score.staleDataWarnings.slice(0, 2),
      ]).slice(0, 5);

      const qualified =
        totalRecommendationScore >= SCREEN_MIN_QUALIFIED_SCORE &&
        !isHoldOffStance(score.suggestedStance) &&
        !isHoldOffLabel(actionLabel);

      if (!qualified) {
        rejectedCandidates.push({
          ticker,
          reason: "Ticker did not pass qualification thresholds for a new recommendation.",
          score: totalRecommendationScore,
          actionLabel,
          missingData,
          alreadyHeld,
          alreadyInWatchlist,
        });
        continue;
      }

      candidates.push({
        rank: 0,
        ticker,
        companyName: entry.companyName ?? bundle.stock.companyName ?? null,
        score: score.compositeScore,
        preferenceFitScore: preferenceFit.preferenceFitScore,
        portfolioFitScore: portfolioFit.portfolioFitScore,
        totalRecommendationScore,
        actionLabel,
        why,
        cautions,
        missingData,
        alreadyHeld,
        alreadyInWatchlist,
        suggestedAction: "ADD_TO_WATCHLIST",
      });
    } catch (error) {
      const reason = toSkipReason(error);
      rejectedCandidates.push({
        ticker,
        reason,
        missingData: [],
        alreadyHeld,
        alreadyInWatchlist,
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.totalRecommendationScore !== left.totalRecommendationScore) {
      return right.totalRecommendationScore - left.totalRecommendationScore;
    }

    return left.ticker.localeCompare(right.ticker);
  });

  const rankedCandidates = candidates
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));

  if (rankedCandidates.length === 0) {
    suggestedRefreshActions.add("refreshDiscoveryCategory");
  }

  if (options.watchlistId) {
    suggestedRefreshActions.add("refreshWatchlistResearchData");
  }

  return {
    screenedCount: screenedTickers.length,
    qualifiedCount: rankedCandidates.length,
    candidates: rankedCandidates,
    rejectedCandidates: rejectedCandidates.slice(0, 20),
    assumptions: dedupe(assumptions),
    clarifyingQuestion,
    suggestedRefreshActions: [...suggestedRefreshActions],
    preferencesApplied,
  };
}
