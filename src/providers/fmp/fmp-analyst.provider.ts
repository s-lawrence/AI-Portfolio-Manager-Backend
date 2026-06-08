import {
  AnalystProvider,
  ProviderAnalystEstimateSnapshot,
  ProviderFinancialRatingSnapshot,
  ProviderDateRangeOptions,
  ProviderLimitOptions,
  ProviderAnalystActionEvent,
  ProviderAnalystSnapshot,
  ProviderMarketDiscoveryItem,
  normalizeProviderTickerOrThrow,
} from "../types";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../errors";
import { FmpJsonClient, FMP_PROVIDER_NAME, FmpClient } from "./fmp-client";
import {
  FmpAnalystEstimateItem,
  FmpAnalystRatingItem,
  FmpGradesConsensusItem,
  FmpGradesHistoricalItem,
  FmpMarketMoverItem,
  FmpPriceTargetConsensusItem,
  FmpPriceTargetSummaryItem,
  FmpRatingsSnapshotItem,
  FmpUpgradeDowngradeItem,
} from "./fmp.types";

type DiscoveryCategory =
  | "GAINERS"
  | "LOSERS"
  | "ACTIVE"
  | "ANALYST_UPGRADES"
  | "ANALYST_DOWNGRADES";

const DISCOVERY_CATEGORY_ENDPOINTS: Record<"GAINERS" | "LOSERS" | "ACTIVE", string[]> = {
  GAINERS: [
    "/stable/biggest-gainers",
    "/biggest-gainers",
    "/stable/market-biggest-gainers",
    "/market-biggest-gainers",
  ],
  LOSERS: [
    "/stable/biggest-losers",
    "/biggest-losers",
    "/stable/market-biggest-losers",
    "/market-biggest-losers",
  ],
  ACTIVE: [
    "/stable/most-actives",
    "/most-actives",
    "/stable/market-most-active",
    "/market-most-active",
  ],
};

const PRICE_TARGET_SUMMARY_ENDPOINTS = [
  "/stable/price-target-summary",
  "/price-target-summary",
] as const;

const PRICE_TARGET_CONSENSUS_ENDPOINTS = [
  "/stable/price-target-consensus",
  "/price-target-consensus",
] as const;

const GRADES_CONSENSUS_ENDPOINTS = [
  "/stable/grades-consensus",
  "/grades-consensus",
] as const;

const LEGACY_ANALYST_RATINGS_ENDPOINTS = [
  "/stable/analyst-ratings",
  "/analyst-ratings",
  "/stable/recommendation-trends",
  "/recommendation-trends",
] as const;

const GRADES_ENDPOINTS = [
  "/stable/grades",
  "/grades",
] as const;

const GRADES_HISTORICAL_ENDPOINTS = [
  "/stable/grades-historical",
  "/grades-historical",
] as const;

const ANALYST_ESTIMATES_ENDPOINTS = [
  "/stable/analyst-estimates",
  "/analyst-estimates",
] as const;

const RATINGS_SNAPSHOT_ENDPOINTS = [
  "/stable/ratings-snapshot",
  "/ratings-snapshot",
] as const;

const RATINGS_HISTORICAL_ENDPOINTS = [
  "/stable/ratings-historical",
  "/ratings-historical",
] as const;

const UPGRADES_DOWNGRADES_ENDPOINTS = [
  "/stable/upgrades-downgrades",
  "/upgrades-downgrades",
  "/stable/upgrades-downgrades-consensus",
  "/upgrades-downgrades-consensus",
] as const;

export type AnalystAuditStatus = "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR";

export interface FmpAnalystSourceAuditResult {
  endpointAttempted: string[];
  selectedEndpoint?: string;
  status: AnalystAuditStatus;
  itemCount: number;
  firstItemKeys: string[];
  mappedFieldSummary: Record<string, unknown>;
  warning?: string;
}

export interface FmpAnalystTickerAuditResult {
  ticker: string;
  priceTargetSummary: FmpAnalystSourceAuditResult;
  priceTargetConsensus: FmpAnalystSourceAuditResult;
  gradesConsensus: FmpAnalystSourceAuditResult;
  grades: FmpAnalystSourceAuditResult;
  gradesHistorical: FmpAnalystSourceAuditResult;
  analystEstimates: FmpAnalystSourceAuditResult;
  ratingsSnapshot: FmpAnalystSourceAuditResult;
  ratingsHistorical: FmpAnalystSourceAuditResult;
  analystRatings: FmpAnalystSourceAuditResult;
  analystActions: FmpAnalystSourceAuditResult;
}

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

    const parsed = Number(trimmed.replace(/[%,$,_\s]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toInteger(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  return Math.trunc(numeric);
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }

  return undefined;
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

  const normalized = Math.floor(limit);
  if (normalized <= 0) {
    return undefined;
  }

  return Math.min(normalized, 1000);
}

function pickFirstFiniteNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function pickFirstInteger(values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = toInteger(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function extractTopLevelKeys(item: unknown): string[] {
  if (!isRecord(item)) {
    return [];
  }

  return Object.keys(item).sort();
}

function parsePublishers(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function deriveConsensusFromCounts(snapshot: Partial<ProviderAnalystSnapshot>): string | undefined {
  const counts = [
    { key: "STRONG_BUY", value: snapshot.strongBuyCount ?? 0 },
    { key: "BUY", value: snapshot.buyCount ?? 0 },
    { key: "HOLD", value: snapshot.holdCount ?? 0 },
    { key: "SELL", value: snapshot.sellCount ?? 0 },
    { key: "STRONG_SELL", value: snapshot.strongSellCount ?? 0 },
  ];

  const maxValue = Math.max(...counts.map((item) => item.value));
  if (maxValue <= 0) {
    return undefined;
  }

  const leaders = counts.filter((item) => item.value === maxValue);
  if (leaders.length !== 1) {
    return undefined;
  }

  return leaders[0]?.key;
}

function sumDefinedCounts(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => typeof value === "number");
  if (numeric.length === 0) {
    return undefined;
  }

  return numeric.reduce((sum, value) => sum + value, 0);
}

function mapRecommendationTrendCounts(item: FmpAnalystRatingItem): Partial<ProviderAnalystSnapshot> {
  const trends = Array.isArray(item.recommendationTrends) ? item.recommendationTrends : undefined;
  if (!trends || trends.length === 0) {
    return {};
  }

  const latest = trends
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .sort((left, right) => {
      const leftDate = parseDateValue(left.date ?? left.asOfDate)?.getTime() ?? Number.NEGATIVE_INFINITY;
      const rightDate = parseDateValue(right.date ?? right.asOfDate)?.getTime() ?? Number.NEGATIVE_INFINITY;
      return rightDate - leftDate;
    })[0];

  if (!latest) {
    return {};
  }

  return {
    analystCount: pickFirstInteger([
      latest.analystCount,
      latest.numberOfAnalysts,
      latest.totalAnalysts,
      latest.total,
    ]),
    strongBuyCount: pickFirstInteger([
      latest.strongBuy,
      latest.strongBuyCount,
      latest.strong_buy,
      latest.ratingStrongBuy,
    ]),
    buyCount: pickFirstInteger([latest.buy, latest.buyCount, latest.ratingBuy]),
    holdCount: pickFirstInteger([latest.hold, latest.holdCount, latest.ratingHold]),
    sellCount: pickFirstInteger([latest.sell, latest.sellCount, latest.ratingSell]),
    strongSellCount: pickFirstInteger([
      latest.strongSell,
      latest.strongSellCount,
      latest.strong_sell,
      latest.ratingStrongSell,
    ]),
  };
}

function inferIsOtc(exchange: string | undefined, ticker: string): boolean {
  const normalizedExchange = exchange?.trim().toUpperCase();
  const normalizedTicker = ticker.trim().toUpperCase();

  if (!normalizedExchange) {
    return normalizedTicker.endsWith(".PK") || normalizedTicker.endsWith(".OTC");
  }

  return (
    normalizedExchange.includes("OTC") ||
    normalizedExchange === "PINK" ||
    normalizedExchange === "OTCPK" ||
    normalizedExchange === "OTCQB" ||
    normalizedExchange === "OTCQX"
  );
}

function hasAnalystSnapshotData(snapshot: Partial<ProviderAnalystSnapshot>): boolean {
  return (
    snapshot.priceTargetAverage !== undefined ||
    snapshot.priceTargetHigh !== undefined ||
    snapshot.priceTargetLow !== undefined ||
    snapshot.priceTargetConsensus !== undefined ||
    snapshot.targetMedian !== undefined ||
    snapshot.lastMonthPriceTargetAvg !== undefined ||
    snapshot.lastMonthPriceTargetCount !== undefined ||
    snapshot.lastQuarterPriceTargetAvg !== undefined ||
    snapshot.lastQuarterPriceTargetCount !== undefined ||
    snapshot.lastYearPriceTargetAvg !== undefined ||
    snapshot.lastYearPriceTargetCount !== undefined ||
    snapshot.allTimePriceTargetAvg !== undefined ||
    snapshot.allTimePriceTargetCount !== undefined ||
    snapshot.analystCount !== undefined ||
    snapshot.ratingConsensus !== undefined ||
    snapshot.strongBuyCount !== undefined ||
    snapshot.buyCount !== undefined ||
    snapshot.holdCount !== undefined ||
    snapshot.sellCount !== undefined ||
    snapshot.strongSellCount !== undefined ||
    snapshot.upsidePercent !== undefined
  );
}

function normalizeActionType(value: unknown): string | undefined {
  const raw = toStringOrUndefined(value);
  if (!raw) {
    return undefined;
  }

  const normalized = raw
    .replace(/\s+/g, "_")
    .replace(/-/g, "_")
    .replace(/[^A-Za-z_]/g, "")
    .toUpperCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("UPGRADE")) {
    return "UPGRADE";
  }

  if (normalized.includes("DOWNGRADE")) {
    return "DOWNGRADE";
  }

  if (normalized.includes("INITIAT")) {
    return "INITIATED";
  }

  if (normalized.includes("MAINTAIN")) {
    return "REITERATED";
  }

  if (normalized.includes("REITERAT")) {
    return "REITERATED";
  }

  if (normalized.includes("TARGET")) {
    return "PRICE_TARGET_CHANGE";
  }

  return normalized;
}

function eventDateFromRecord(record: Record<string, unknown>): Date | undefined {
  return parseDateValue(
    record.eventDate ??
      record.publishedDate ??
      record.date ??
      record.asOfDate,
  );
}

function sortNewestFirst<T extends { eventDate: Date }>(left: T, right: T): number {
  return right.eventDate.getTime() - left.eventDate.getTime();
}

function asDiscoveryCategory(value: string): DiscoveryCategory {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "GAINERS":
    case "LOSERS":
    case "ACTIVE":
    case "ANALYST_UPGRADES":
    case "ANALYST_DOWNGRADES":
      return normalized;
    default:
      throw new Error(`Unsupported discovery category: ${value}`);
  }
}

function mapPriceTargetSummaryRecord(
  ticker: string,
  item: FmpPriceTargetSummaryItem,
): ProviderAnalystSnapshot | null {
  const publishers = parsePublishers(item.publishers);

  const snapshot: ProviderAnalystSnapshot = {
    ticker,
    capturedAt: parseDateValue(item.date ?? item.asOfDate) ?? new Date(),
    source: "FMP",
    priceTargetAverage: pickFirstFiniteNumber([
      item.lastQuarterAvgPriceTarget,
      item.targetAvg,
      item.targetAverage,
      item.targetMean,
    ]),
    priceTargetHigh: pickFirstFiniteNumber([item.targetHigh, item.priceTargetHigh]),
    priceTargetLow: pickFirstFiniteNumber([item.targetLow, item.priceTargetLow]),
    priceTargetConsensus: pickFirstFiniteNumber([
      item.targetConsensus,
      item.target_consensus,
      item.priceTargetConsensus,
    ]),
    targetMedian: pickFirstFiniteNumber([item.targetMedian]),
    lastMonthPriceTargetAvg: pickFirstFiniteNumber([item.lastMonthAvgPriceTarget]),
    lastMonthPriceTargetCount: pickFirstInteger([item.lastMonthCount]),
    lastQuarterPriceTargetAvg: pickFirstFiniteNumber([item.lastQuarterAvgPriceTarget]),
    lastQuarterPriceTargetCount: pickFirstInteger([item.lastQuarterCount]),
    lastYearPriceTargetAvg: pickFirstFiniteNumber([item.lastYearAvgPriceTarget]),
    lastYearPriceTargetCount: pickFirstInteger([item.lastYearCount]),
    allTimePriceTargetAvg: pickFirstFiniteNumber([item.allTimeAvgPriceTarget]),
    allTimePriceTargetCount: pickFirstInteger([item.allTimeCount]),
    analystCount: pickFirstInteger([
      item.lastQuarterCount,
      item.analystCount,
      item.numberOfAnalysts,
      item.allAnalystCount,
    ]),
    ratingConsensus:
      toStringOrUndefined(item.ratingConsensus) ?? toStringOrUndefined(item.consensus),
    upsidePercent: toFiniteNumber(item.upsidePercent) ?? toFiniteNumber(item.upside),
    raw: {
      ...item,
      ...(publishers ? { publishers } : {}),
    },
  };

  return hasAnalystSnapshotData(snapshot) ? snapshot : null;
}

function mapPriceTargetConsensusRecord(
  item: FmpPriceTargetConsensusItem,
): Partial<ProviderAnalystSnapshot> | null {
  const snapshot: Partial<ProviderAnalystSnapshot> = {
    source: "FMP",
    priceTargetConsensus: pickFirstFiniteNumber([
      item.targetConsensus,
      item.target_consensus,
      item.priceTargetConsensus,
      item.targetMedian,
      item.targetMean,
      item.targetAverage,
    ]),
    targetMedian: pickFirstFiniteNumber([item.targetMedian]),
    priceTargetHigh: pickFirstFiniteNumber([item.targetHigh, item.priceTargetHigh]),
    priceTargetLow: pickFirstFiniteNumber([item.targetLow, item.priceTargetLow]),
    analystCount: pickFirstInteger([
      item.analystCount,
      item.numberOfAnalysts,
      item.totalAnalysts,
    ]),
    ratingConsensus:
      toStringOrUndefined(item.ratingConsensus) ??
      toStringOrUndefined(item.consensus) ??
      toStringOrUndefined(item.recommendation),
    raw: item,
  };

  return hasAnalystSnapshotData(snapshot) ? snapshot : null;
}

function mapGradesConsensusRecord(
  item: FmpGradesConsensusItem,
): Partial<ProviderAnalystSnapshot> | null {
  const strongBuyCount = pickFirstInteger([item.strongBuy]);
  const buyCount = pickFirstInteger([item.buy]);
  const holdCount = pickFirstInteger([item.hold]);
  const sellCount = pickFirstInteger([item.sell]);
  const strongSellCount = pickFirstInteger([item.strongSell]);
  const analystCount = sumDefinedCounts([
    strongBuyCount,
    buyCount,
    holdCount,
    sellCount,
    strongSellCount,
  ]);

  const snapshot: Partial<ProviderAnalystSnapshot> = {
    source: "FMP",
    analystCount,
    ratingConsensus: toStringOrUndefined(item.consensus),
    strongBuyCount,
    buyCount,
    holdCount,
    sellCount,
    strongSellCount,
    raw: item,
  };

  return hasAnalystSnapshotData(snapshot) ? snapshot : null;
}

function mapGradesHistoricalRecord(
  item: FmpGradesHistoricalItem,
): Partial<ProviderAnalystSnapshot> | null {
  const strongBuyCount = pickFirstInteger([item.analystRatingsStrongBuy]);
  const buyCount = pickFirstInteger([item.analystRatingsBuy]);
  const holdCount = pickFirstInteger([item.analystRatingsHold]);
  const sellCount = pickFirstInteger([item.analystRatingsSell]);
  const strongSellCount = pickFirstInteger([item.analystRatingsStrongSell]);

  const snapshot: Partial<ProviderAnalystSnapshot> = {
    source: "FMP",
    capturedAt: parseDateValue(item.date) ?? new Date(),
    analystCount: sumDefinedCounts([
      strongBuyCount,
      buyCount,
      holdCount,
      sellCount,
      strongSellCount,
    ]),
    strongBuyCount,
    buyCount,
    holdCount,
    sellCount,
    strongSellCount,
    raw: item,
  };

  if (!snapshot.ratingConsensus) {
    snapshot.ratingConsensus = deriveConsensusFromCounts(snapshot);
  }

  return hasAnalystSnapshotData(snapshot) ? snapshot : null;
}

function mapAnalystRatingsRecord(
  item: FmpAnalystRatingItem,
): Partial<ProviderAnalystSnapshot> | null {
  const trendCounts = mapRecommendationTrendCounts(item);

  const snapshot: Partial<ProviderAnalystSnapshot> = {
    source: "FMP",
    analystCount: pickFirstInteger([
      item.analystCount,
      item.numberOfAnalysts,
      item.totalAnalysts,
      trendCounts.analystCount,
    ]),
    ratingConsensus:
      toStringOrUndefined(item.ratingConsensus) ??
      toStringOrUndefined(item.recommendation) ??
      toStringOrUndefined(item.consensus) ??
      toStringOrUndefined(item.rating),
    strongBuyCount: pickFirstInteger([
      item.strongBuy,
      item.strongBuyCount,
      item.strong_buy,
      trendCounts.strongBuyCount,
    ]),
    buyCount: pickFirstInteger([item.buy, item.buyCount, trendCounts.buyCount]),
    holdCount: pickFirstInteger([item.hold, item.holdCount, trendCounts.holdCount]),
    sellCount: pickFirstInteger([item.sell, item.sellCount, trendCounts.sellCount]),
    strongSellCount: pickFirstInteger([
      item.strongSell,
      item.strongSellCount,
      item.strong_sell,
      trendCounts.strongSellCount,
    ]),
    raw: item,
  };

  return hasAnalystSnapshotData(snapshot) ? snapshot : null;
}

function mapUpgradeDowngradeRecord(
  ticker: string,
  item: FmpUpgradeDowngradeItem,
): ProviderAnalystActionEvent | null {
  const eventDate = eventDateFromRecord(item as unknown as Record<string, unknown>);
  const actionType =
    normalizeActionType(item.actionType ?? item.action) ??
    (toFiniteNumber(item.newPriceTarget ?? item.newTargetPrice) !== undefined
      ? "PRICE_TARGET_CHANGE"
      : undefined);

  if (!eventDate || !actionType) {
    return null;
  }

  return {
    ticker,
    source: toStringOrUndefined(item.source) ?? "FMP",
    actionType,
    firm: toStringOrUndefined(item.firm ?? item.gradingCompany),
    analystName: toStringOrUndefined(item.analystName ?? item.analyst),
    previousRating: toStringOrUndefined(item.previousRating ?? item.previousGrade),
    newRating: toStringOrUndefined(item.newRating ?? item.newGrade),
    previousPriceTarget:
      toFiniteNumber(item.previousPriceTarget) ?? toFiniteNumber(item.previousTargetPrice),
    newPriceTarget:
      toFiniteNumber(item.newPriceTarget) ?? toFiniteNumber(item.newTargetPrice),
    eventDate,
    headline:
      toStringOrUndefined(item.headline) ??
      toStringOrUndefined(item.title) ??
      toStringOrUndefined(item.newsTitle) ??
      (
        [
          toStringOrUndefined(item.firm ?? item.gradingCompany),
          toStringOrUndefined(item.actionType ?? item.action),
          toStringOrUndefined(item.newRating ?? item.newGrade),
        ]
          .filter((segment): segment is string => Boolean(segment))
          .join(" ")
          .trim() || undefined
      ),
    url: toStringOrUndefined(item.url ?? item.newsURL),
    raw: item,
  };
}

function mapAnalystEstimateRecord(
  ticker: string,
  period: "annual" | "quarter",
  item: FmpAnalystEstimateItem,
): ProviderAnalystEstimateSnapshot | null {
  const date = parseDateValue(item.date);
  if (!date) {
    return null;
  }

  return {
    ticker,
    period,
    date,
    revenueLow: toFiniteNumber(item.revenueLow),
    revenueHigh: toFiniteNumber(item.revenueHigh),
    revenueAvg: toFiniteNumber(item.revenueAvg),
    ebitdaLow: toFiniteNumber(item.ebitdaLow),
    ebitdaHigh: toFiniteNumber(item.ebitdaHigh),
    ebitdaAvg: toFiniteNumber(item.ebitdaAvg),
    ebitLow: toFiniteNumber(item.ebitLow),
    ebitHigh: toFiniteNumber(item.ebitHigh),
    ebitAvg: toFiniteNumber(item.ebitAvg),
    netIncomeLow: toFiniteNumber(item.netIncomeLow),
    netIncomeHigh: toFiniteNumber(item.netIncomeHigh),
    netIncomeAvg: toFiniteNumber(item.netIncomeAvg),
    epsAvg: toFiniteNumber(item.epsAvg),
    epsHigh: toFiniteNumber(item.epsHigh),
    epsLow: toFiniteNumber(item.epsLow),
    numAnalystsRevenue: toInteger(item.numAnalystsRevenue),
    numAnalystsEps: toInteger(item.numAnalystsEps),
    source: "FMP",
    raw: item,
  };
}

function mapFinancialRatingRecord(
  ticker: string,
  item: FmpRatingsSnapshotItem,
): ProviderFinancialRatingSnapshot | null {
  return {
    ticker,
    capturedAt: parseDateValue(item.date) ?? new Date(),
    rating: toStringOrUndefined(item.rating),
    overallScore: toFiniteNumber(item.overallScore),
    discountedCashFlowScore: toFiniteNumber(item.discountedCashFlowScore),
    returnOnEquityScore: toFiniteNumber(item.returnOnEquityScore),
    returnOnAssetsScore: toFiniteNumber(item.returnOnAssetsScore),
    debtToEquityScore: toFiniteNumber(item.debtToEquityScore),
    priceToEarningsScore: toFiniteNumber(item.priceToEarningsScore),
    priceToBookScore: toFiniteNumber(item.priceToBookScore),
    source: "FMP",
    raw: item,
  };
}

function mapMarketMoverRecord(
  category: DiscoveryCategory,
  item: FmpMarketMoverItem,
): ProviderMarketDiscoveryItem | null {
  const ticker = toStringOrUndefined(item.symbol ?? item.ticker);
  if (!ticker) {
    return null;
  }

  return {
    ticker: normalizeProviderTickerOrThrow(ticker),
    companyName: toStringOrUndefined(item.companyName ?? item.name),
    exchange: toStringOrUndefined((item as Record<string, unknown>).exchange),
    isOtc: inferIsOtc(
      toStringOrUndefined((item as Record<string, unknown>).exchange),
      ticker,
    ),
    price: toFiniteNumber(item.price),
    changePercent:
      toFiniteNumber(item.changePercent) ?? toFiniteNumber(item.changesPercentage),
    volume: toFiniteNumber(item.volume),
    marketCap: toFiniteNumber(item.marketCap),
    category,
    capturedAt: new Date(),
    source: toStringOrUndefined(item.source) ?? "FMP",
    raw: item,
  };
}

export class FmpAnalystProvider implements AnalystProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async auditTicker(ticker: string): Promise<FmpAnalystTickerAuditResult> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const summaryAudit = await this.fetchEndpointItemsWithDiagnostics<FmpPriceTargetSummaryItem>(
      [...PRICE_TARGET_SUMMARY_ENDPOINTS],
      { symbol: normalizedTicker },
    );
    const summaryMapped = summaryAudit.items[0]
      ? mapPriceTargetSummaryRecord(normalizedTicker, summaryAudit.items[0])
      : null;

    const consensusAudit = await this.fetchEndpointItemsWithDiagnostics<FmpPriceTargetConsensusItem>(
      [...PRICE_TARGET_CONSENSUS_ENDPOINTS],
      { symbol: normalizedTicker },
    );
    const consensusMapped = consensusAudit.items[0]
      ? mapPriceTargetConsensusRecord(consensusAudit.items[0])
      : null;

    const gradesConsensusAudit = await this.fetchEndpointItemsWithDiagnostics<FmpGradesConsensusItem>(
      [...GRADES_CONSENSUS_ENDPOINTS],
      { symbol: normalizedTicker },
    );
    const gradesConsensusMapped = gradesConsensusAudit.items[0]
      ? mapGradesConsensusRecord(gradesConsensusAudit.items[0])
      : null;

    const gradesAudit = await this.fetchEndpointItemsWithDiagnostics<FmpUpgradeDowngradeItem>(
      [...GRADES_ENDPOINTS, ...UPGRADES_DOWNGRADES_ENDPOINTS],
      { symbol: normalizedTicker, limit: 10 },
    );
    const mappedActionsCount = gradesAudit.items
      .map((item) => mapUpgradeDowngradeRecord(normalizedTicker, item))
      .filter((item): item is ProviderAnalystActionEvent => item !== null)
      .length;

    const gradesHistoricalAudit = await this.fetchEndpointItemsWithDiagnostics<FmpGradesHistoricalItem>(
      [...GRADES_HISTORICAL_ENDPOINTS],
      { symbol: normalizedTicker, limit: 10 },
    );
    const gradesHistoricalMapped = gradesHistoricalAudit.items[0]
      ? mapGradesHistoricalRecord(gradesHistoricalAudit.items[0])
      : null;

    const estimatesAudit = await this.fetchEndpointItemsWithDiagnostics<FmpAnalystEstimateItem>(
      [...ANALYST_ESTIMATES_ENDPOINTS],
      { symbol: normalizedTicker, period: "annual", page: 0, limit: 10 },
    );
    const mappedEstimatesCount = estimatesAudit.items
      .map((item) => mapAnalystEstimateRecord(normalizedTicker, "annual", item))
      .filter((item): item is ProviderAnalystEstimateSnapshot => item !== null)
      .length;

    const ratingsSnapshotAudit = await this.fetchEndpointItemsWithDiagnostics<FmpRatingsSnapshotItem>(
      [...RATINGS_SNAPSHOT_ENDPOINTS],
      { symbol: normalizedTicker },
    );
    const mappedRatingSnapshot = ratingsSnapshotAudit.items[0]
      ? mapFinancialRatingRecord(normalizedTicker, ratingsSnapshotAudit.items[0])
      : null;

    const ratingsHistoricalAudit = await this.fetchEndpointItemsWithDiagnostics<FmpRatingsSnapshotItem>(
      [...RATINGS_HISTORICAL_ENDPOINTS],
      { symbol: normalizedTicker, limit: 10 },
    );
    const mappedRatingsHistoricalCount = ratingsHistoricalAudit.items
      .map((item) => mapFinancialRatingRecord(normalizedTicker, item))
      .filter((item): item is ProviderFinancialRatingSnapshot => item !== null)
      .length;

    const legacyRatingsAudit = await this.fetchEndpointItemsWithDiagnostics<FmpAnalystRatingItem>(
      [...LEGACY_ANALYST_RATINGS_ENDPOINTS],
      { symbol: normalizedTicker },
    );
    const legacyRatingsMapped = legacyRatingsAudit.items[0]
      ? mapAnalystRatingsRecord(legacyRatingsAudit.items[0])
      : null;

    return {
      ticker: normalizedTicker,
      priceTargetSummary: {
        endpointAttempted: summaryAudit.endpointAttempted,
        selectedEndpoint: summaryAudit.selectedEndpoint,
        status: summaryAudit.status,
        itemCount: summaryAudit.items.length,
        firstItemKeys: extractTopLevelKeys(summaryAudit.items[0]),
        mappedFieldSummary: {
          mapped: summaryMapped !== null,
          hasTargetConsensus: summaryMapped?.priceTargetConsensus != null,
          hasTargetAverage: summaryMapped?.priceTargetAverage != null,
          hasAnalystCount: summaryMapped?.analystCount != null,
          hasRatingConsensus: !!summaryMapped?.ratingConsensus,
        },
        warning: summaryAudit.warning,
      },
      priceTargetConsensus: {
        endpointAttempted: consensusAudit.endpointAttempted,
        selectedEndpoint: consensusAudit.selectedEndpoint,
        status: consensusAudit.status,
        itemCount: consensusAudit.items.length,
        firstItemKeys: extractTopLevelKeys(consensusAudit.items[0]),
        mappedFieldSummary: {
          mapped: consensusMapped !== null,
          hasTargetConsensus: consensusMapped?.priceTargetConsensus != null,
          hasTargetHigh: consensusMapped?.priceTargetHigh != null,
          hasTargetLow: consensusMapped?.priceTargetLow != null,
          hasAnalystCount: consensusMapped?.analystCount != null,
          hasRatingConsensus: !!consensusMapped?.ratingConsensus,
        },
        warning: consensusAudit.warning,
      },
      gradesConsensus: {
        endpointAttempted: gradesConsensusAudit.endpointAttempted,
        selectedEndpoint: gradesConsensusAudit.selectedEndpoint,
        status: gradesConsensusAudit.status,
        itemCount: gradesConsensusAudit.items.length,
        firstItemKeys: extractTopLevelKeys(gradesConsensusAudit.items[0]),
        mappedFieldSummary: {
          mapped: gradesConsensusMapped !== null,
          hasAnalystCount: gradesConsensusMapped?.analystCount != null,
          hasRatingConsensus: !!gradesConsensusMapped?.ratingConsensus,
          hasStrongBuyCount: gradesConsensusMapped?.strongBuyCount != null,
          hasBuyCount: gradesConsensusMapped?.buyCount != null,
          hasHoldCount: gradesConsensusMapped?.holdCount != null,
          hasSellCount: gradesConsensusMapped?.sellCount != null,
          hasStrongSellCount: gradesConsensusMapped?.strongSellCount != null,
        },
        warning: gradesConsensusAudit.warning,
      },
      grades: {
        endpointAttempted: gradesAudit.endpointAttempted,
        selectedEndpoint: gradesAudit.selectedEndpoint,
        status: gradesAudit.status,
        itemCount: gradesAudit.items.length,
        firstItemKeys: extractTopLevelKeys(gradesAudit.items[0]),
        mappedFieldSummary: {
          mappedActionCount: mappedActionsCount,
        },
        warning: gradesAudit.warning,
      },
      gradesHistorical: {
        endpointAttempted: gradesHistoricalAudit.endpointAttempted,
        selectedEndpoint: gradesHistoricalAudit.selectedEndpoint,
        status: gradesHistoricalAudit.status,
        itemCount: gradesHistoricalAudit.items.length,
        firstItemKeys: extractTopLevelKeys(gradesHistoricalAudit.items[0]),
        mappedFieldSummary: {
          mapped: gradesHistoricalMapped !== null,
          hasAnalystCount: gradesHistoricalMapped?.analystCount != null,
          hasRatingConsensus: !!gradesHistoricalMapped?.ratingConsensus,
          hasDistribution:
            gradesHistoricalMapped?.strongBuyCount != null ||
            gradesHistoricalMapped?.buyCount != null ||
            gradesHistoricalMapped?.holdCount != null ||
            gradesHistoricalMapped?.sellCount != null ||
            gradesHistoricalMapped?.strongSellCount != null,
        },
        warning: gradesHistoricalAudit.warning,
      },
      analystEstimates: {
        endpointAttempted: estimatesAudit.endpointAttempted,
        selectedEndpoint: estimatesAudit.selectedEndpoint,
        status: estimatesAudit.status,
        itemCount: estimatesAudit.items.length,
        firstItemKeys: extractTopLevelKeys(estimatesAudit.items[0]),
        mappedFieldSummary: {
          mappedEstimateCount: mappedEstimatesCount,
        },
        warning: estimatesAudit.warning,
      },
      ratingsSnapshot: {
        endpointAttempted: ratingsSnapshotAudit.endpointAttempted,
        selectedEndpoint: ratingsSnapshotAudit.selectedEndpoint,
        status: ratingsSnapshotAudit.status,
        itemCount: ratingsSnapshotAudit.items.length,
        firstItemKeys: extractTopLevelKeys(ratingsSnapshotAudit.items[0]),
        mappedFieldSummary: {
          mapped: mappedRatingSnapshot !== null,
          hasRating: !!mappedRatingSnapshot?.rating,
          hasOverallScore: mappedRatingSnapshot?.overallScore != null,
        },
        warning: ratingsSnapshotAudit.warning,
      },
      ratingsHistorical: {
        endpointAttempted: ratingsHistoricalAudit.endpointAttempted,
        selectedEndpoint: ratingsHistoricalAudit.selectedEndpoint,
        status: ratingsHistoricalAudit.status,
        itemCount: ratingsHistoricalAudit.items.length,
        firstItemKeys: extractTopLevelKeys(ratingsHistoricalAudit.items[0]),
        mappedFieldSummary: {
          mappedCount: mappedRatingsHistoricalCount,
        },
        warning: ratingsHistoricalAudit.warning,
      },
      analystRatings: {
        endpointAttempted: gradesConsensusAudit.endpointAttempted,
        selectedEndpoint: gradesConsensusAudit.selectedEndpoint,
        status: gradesConsensusAudit.status,
        itemCount: gradesConsensusAudit.items.length,
        firstItemKeys: extractTopLevelKeys(gradesConsensusAudit.items[0]),
        mappedFieldSummary: {
          mapped: gradesConsensusMapped !== null,
          hasRatingConsensus: !!gradesConsensusMapped?.ratingConsensus,
          hasDistribution:
            gradesConsensusMapped?.strongBuyCount != null ||
            gradesConsensusMapped?.buyCount != null ||
            gradesConsensusMapped?.holdCount != null ||
            gradesConsensusMapped?.sellCount != null ||
            gradesConsensusMapped?.strongSellCount != null,
          legacyFallbackMapped: legacyRatingsMapped !== null,
        },
        warning: gradesConsensusAudit.warning,
      },
      analystActions: {
        endpointAttempted: gradesAudit.endpointAttempted,
        selectedEndpoint: gradesAudit.selectedEndpoint,
        status: gradesAudit.status,
        itemCount: gradesAudit.items.length,
        firstItemKeys: extractTopLevelKeys(gradesAudit.items[0]),
        mappedFieldSummary: {
          mappedActionCount: mappedActionsCount,
        },
        warning: gradesAudit.warning,
      },
    };
  }

  async getPriceTargetSummary(
    ticker: string,
  ): Promise<ProviderAnalystSnapshot | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const item = await this.fetchLatestRecordWithFallback<FmpPriceTargetSummaryItem>(
      [...PRICE_TARGET_SUMMARY_ENDPOINTS],
      {
        symbol: normalizedTicker,
      },
    );

    if (!item) {
      return null;
    }

    return mapPriceTargetSummaryRecord(normalizedTicker, item);
  }

  async getPriceTargetConsensus(
    ticker: string,
  ): Promise<Partial<ProviderAnalystSnapshot> | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const item = await this.fetchLatestRecordWithFallback<FmpPriceTargetConsensusItem>(
      [...PRICE_TARGET_CONSENSUS_ENDPOINTS],
      {
        symbol: normalizedTicker,
      },
    );

    if (!item) {
      return null;
    }

    return mapPriceTargetConsensusRecord(item);
  }

  async getAnalystRatings(
    ticker: string,
  ): Promise<Partial<ProviderAnalystSnapshot> | null> {
    const consensus = await this.getGradesConsensus(ticker);
    if (consensus) {
      return consensus;
    }

    const historical = await this.getHistoricalGrades(ticker, { limit: 1 });
    if (historical) {
      return historical;
    }

    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const item = await this.fetchLatestRecordWithFallback<FmpAnalystRatingItem>(
      [...LEGACY_ANALYST_RATINGS_ENDPOINTS],
      {
        symbol: normalizedTicker,
      },
    );

    if (!item) {
      return null;
    }

    return mapAnalystRatingsRecord(item);
  }

  async getUpgradesDowngrades(
    ticker: string,
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderAnalystActionEvent[]> {
    return this.getRecentGrades(ticker, options);
  }

  async getGradesConsensus(
    ticker: string,
  ): Promise<Partial<ProviderAnalystSnapshot> | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const item = await this.fetchLatestRecordWithFallback<FmpGradesConsensusItem>(
      [...GRADES_CONSENSUS_ENDPOINTS],
      { symbol: normalizedTicker },
    );

    if (!item) {
      return null;
    }

    return mapGradesConsensusRecord(item);
  }

  async getRecentGrades(
    ticker: string,
    options: ProviderDateRangeOptions = {},
  ): Promise<ProviderAnalystActionEvent[]> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const query: Record<string, string | number> = {
      symbol: normalizedTicker,
    };

    if (options.from) {
      query.from = formatDateOnly(options.from);
    }

    if (options.to) {
      query.to = formatDateOnly(options.to);
    }

    const limit = normalizeLimit(options.limit);
    if (limit) {
      query.limit = limit;
    }

    const items = await this.fetchEndpointItemsWithFallback<FmpUpgradeDowngradeItem>(
      [...GRADES_ENDPOINTS, ...UPGRADES_DOWNGRADES_ENDPOINTS],
      query,
    );

    const mapped = items
      .map((item) => mapUpgradeDowngradeRecord(normalizedTicker, item))
      .filter((item): item is ProviderAnalystActionEvent => item !== null)
      .sort(sortNewestFirst);

    if (!limit || mapped.length <= limit) {
      return mapped;
    }

    return mapped.slice(0, limit);
  }

  async getHistoricalGrades(
    ticker: string,
    options: ProviderLimitOptions = {},
  ): Promise<Partial<ProviderAnalystSnapshot> | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const limit = normalizeLimit(options.limit) ?? 1;

    const item = await this.fetchLatestRecordWithFallback<FmpGradesHistoricalItem>(
      [...GRADES_HISTORICAL_ENDPOINTS],
      { symbol: normalizedTicker, limit },
    );

    if (!item) {
      return null;
    }

    return mapGradesHistoricalRecord(item);
  }

  async getAnalystEstimates(
    ticker: string,
    options: { period?: "annual" | "quarter"; page?: number; limit?: number } = {},
  ): Promise<ProviderAnalystEstimateSnapshot[]> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const period = options.period ?? "annual";
    const page = typeof options.page === "number" && Number.isFinite(options.page) ? Math.max(0, Math.floor(options.page)) : 0;
    const limit = normalizeLimit(options.limit) ?? 10;

    const items = await this.fetchEndpointItemsWithFallback<FmpAnalystEstimateItem>(
      [...ANALYST_ESTIMATES_ENDPOINTS],
      {
        symbol: normalizedTicker,
        period,
        page,
        limit,
      },
    );

    const mapped = items
      .map((item) => mapAnalystEstimateRecord(normalizedTicker, period, item))
      .filter((item): item is ProviderAnalystEstimateSnapshot => item !== null)
      .sort((left, right) => right.date.getTime() - left.date.getTime());

    return mapped.slice(0, limit);
  }

  async getRatingsSnapshot(
    ticker: string,
  ): Promise<ProviderFinancialRatingSnapshot | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const item = await this.fetchLatestRecordWithFallback<FmpRatingsSnapshotItem>(
      [...RATINGS_SNAPSHOT_ENDPOINTS],
      { symbol: normalizedTicker },
    );

    if (!item) {
      return null;
    }

    return mapFinancialRatingRecord(normalizedTicker, item);
  }

  async getHistoricalRatings(
    ticker: string,
    options: ProviderLimitOptions = {},
  ): Promise<ProviderFinancialRatingSnapshot[]> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const limit = normalizeLimit(options.limit) ?? 10;
    const items = await this.fetchEndpointItemsWithFallback<FmpRatingsSnapshotItem>(
      [...RATINGS_HISTORICAL_ENDPOINTS],
      { symbol: normalizedTicker, limit },
    );

    const mapped = items
      .map((item) => mapFinancialRatingRecord(normalizedTicker, item))
      .filter((item): item is ProviderFinancialRatingSnapshot => item !== null)
      .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime());

    return mapped.slice(0, limit);
  }

  async getMarketMovers(
    categoryInput: string,
    options: ProviderLimitOptions = {},
  ): Promise<ProviderMarketDiscoveryItem[]> {
    const category = asDiscoveryCategory(categoryInput);
    const limit = normalizeLimit(options.limit);

    if (category === "ANALYST_UPGRADES" || category === "ANALYST_DOWNGRADES") {
      const query: Record<string, string | number> = {};
      if (limit) {
        query.limit = limit;
      }

      const items = await this.fetchEndpointItemsWithFallback<FmpUpgradeDowngradeItem>(
        [...GRADES_ENDPOINTS, ...UPGRADES_DOWNGRADES_ENDPOINTS],
        query,
      );

      const mapped = items
        .map((item): ProviderMarketDiscoveryItem | null => {
          const ticker = toStringOrUndefined(item.symbol);
          if (!ticker) {
            return null;
          }

          const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
          const actionType = normalizeActionType(item.actionType ?? item.action);
          const isUpgrade = actionType === "UPGRADE";
          const isDowngrade = actionType === "DOWNGRADE";

          if (category === "ANALYST_UPGRADES" && !isUpgrade) {
            return null;
          }

          if (category === "ANALYST_DOWNGRADES" && !isDowngrade) {
            return null;
          }

          const companyName = toStringOrUndefined(item.firm ?? item.gradingCompany);

          return {
            ticker: normalizedTicker,
            ...(companyName ? { companyName } : {}),
            price: toFiniteNumber(item.newPriceTarget ?? item.newTargetPrice),
            changePercent: undefined,
            volume: undefined,
            marketCap: undefined,
            category,
            capturedAt: eventDateFromRecord(item as unknown as Record<string, unknown>) ?? new Date(),
            source: toStringOrUndefined(item.source) ?? "FMP",
            raw: item,
          };
        })
        .filter((item): item is ProviderMarketDiscoveryItem => item !== null)
        .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime());

      if (!limit || mapped.length <= limit) {
        return mapped;
      }

      return mapped.slice(0, limit);
    }

    const endpointCandidates = DISCOVERY_CATEGORY_ENDPOINTS[category];
    const query: Record<string, string | number> = {};

    if (limit) {
      query.limit = limit;
    }

    const items = await this.fetchEndpointItemsWithFallback<FmpMarketMoverItem>(
      endpointCandidates,
      query,
    );

    const mapped = items
      .map((item) => mapMarketMoverRecord(category, item))
      .filter((item): item is ProviderMarketDiscoveryItem => item !== null);

    if (!limit || mapped.length <= limit) {
      return mapped;
    }

    return mapped.slice(0, limit);
  }

  private async fetchLatestRecordWithFallback<T>(
    endpoints: string[],
    query?: Record<string, string | number>,
  ): Promise<T | null> {
    const items = await this.fetchEndpointItemsWithFallback<T>(endpoints, query);
    if (items.length === 0) {
      return null;
    }

    const sorted = [...items].sort((left, right) => {
      const leftDate = eventDateFromRecord(left as unknown as Record<string, unknown>)?.getTime() ?? Number.NEGATIVE_INFINITY;
      const rightDate = eventDateFromRecord(right as unknown as Record<string, unknown>)?.getTime() ?? Number.NEGATIVE_INFINITY;
      return rightDate - leftDate;
    });

    return sorted[0] ?? null;
  }

  private async fetchEndpointItemsWithFallback<T>(
    endpoints: string[],
    query?: Record<string, string | number>,
  ): Promise<T[]> {
    for (const endpoint of endpoints) {
      try {
        const payload = await this.client.getJson<unknown>(endpoint, query);
        const items = extractRecordArray<T>(payload);
        if (items.length === 0) {
          continue;
        }

        return items;
      } catch (error) {
        if (error instanceof ProviderRequestError && error.statusCode === 404) {
          continue;
        }

        this.handleEndpointFailure(error, endpoint);
      }
    }

    return [];
  }

  private async fetchEndpointItemsWithDiagnostics<T>(
    endpoints: string[],
    query?: Record<string, string | number>,
  ): Promise<{
    endpointAttempted: string[];
    selectedEndpoint?: string;
    status: AnalystAuditStatus;
    items: T[];
    warning?: string;
  }> {
    const endpointAttempted: string[] = [];

    for (const endpoint of endpoints) {
      endpointAttempted.push(endpoint);

      try {
        const payload = await this.client.getJson<unknown>(endpoint, query);
        const items = extractRecordArray<T>(payload);

        if (items.length === 0) {
          continue;
        }

        return {
          endpointAttempted,
          selectedEndpoint: endpoint,
          status: "SUCCESS",
          items,
        };
      } catch (error) {
        if (error instanceof ProviderRequestError && error.statusCode === 404) {
          continue;
        }

        if (
          error instanceof ProviderConfigurationError ||
          (error instanceof ProviderRequestError && [401, 402, 403].includes(error.statusCode ?? 0))
        ) {
          return {
            endpointAttempted,
            status: "ENTITLEMENT",
            items: [],
            warning: error.message,
          };
        }

        return {
          endpointAttempted,
          status: "ERROR",
          items: [],
          warning: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      endpointAttempted,
      status: "EMPTY",
      items: [],
      warning: "No endpoint returned records.",
    };
  }

  private handleEndpointFailure(error: unknown, endpoint: string): never {
    if (error instanceof ProviderRequestError) {
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
}
