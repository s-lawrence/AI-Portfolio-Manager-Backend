import {
  AnalystProvider,
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
  FmpAnalystRatingItem,
  FmpMarketMoverItem,
  FmpPriceTargetConsensusItem,
  FmpPriceTargetSummaryItem,
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

const ANALYST_RATINGS_ENDPOINTS = [
  "/stable/analyst-ratings",
  "/analyst-ratings",
  "/stable/recommendation-trends",
  "/recommendation-trends",
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
  const snapshot: ProviderAnalystSnapshot = {
    ticker,
    capturedAt: parseDateValue(item.date ?? item.asOfDate) ?? new Date(),
    source: "FMP",
    priceTargetAverage: pickFirstFiniteNumber([
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
      item.targetMedian,
    ]),
    analystCount: pickFirstInteger([
      item.analystCount,
      item.numberOfAnalysts,
      item.allAnalystCount,
    ]),
    ratingConsensus:
      toStringOrUndefined(item.ratingConsensus) ?? toStringOrUndefined(item.consensus),
    upsidePercent: toFiniteNumber(item.upsidePercent) ?? toFiniteNumber(item.upside),
    raw: item,
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
      toStringOrUndefined(item.newsTitle),
    url: toStringOrUndefined(item.url ?? item.newsURL),
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

    const ratingsAudit = await this.fetchEndpointItemsWithDiagnostics<FmpAnalystRatingItem>(
      [...ANALYST_RATINGS_ENDPOINTS],
      { symbol: normalizedTicker },
    );
    const ratingsMapped = ratingsAudit.items[0]
      ? mapAnalystRatingsRecord(ratingsAudit.items[0])
      : null;

    const actionsAudit = await this.fetchEndpointItemsWithDiagnostics<FmpUpgradeDowngradeItem>(
      [...UPGRADES_DOWNGRADES_ENDPOINTS],
      { symbol: normalizedTicker, limit: 10 },
    );
    const mappedActionsCount = actionsAudit.items
      .map((item) => mapUpgradeDowngradeRecord(normalizedTicker, item))
      .filter((item): item is ProviderAnalystActionEvent => item !== null)
      .length;

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
      analystRatings: {
        endpointAttempted: ratingsAudit.endpointAttempted,
        selectedEndpoint: ratingsAudit.selectedEndpoint,
        status: ratingsAudit.status,
        itemCount: ratingsAudit.items.length,
        firstItemKeys: extractTopLevelKeys(ratingsAudit.items[0]),
        mappedFieldSummary: {
          mapped: ratingsMapped !== null,
          hasAnalystCount: ratingsMapped?.analystCount != null,
          hasRatingConsensus: !!ratingsMapped?.ratingConsensus,
          hasStrongBuyCount: ratingsMapped?.strongBuyCount != null,
          hasBuyCount: ratingsMapped?.buyCount != null,
          hasHoldCount: ratingsMapped?.holdCount != null,
          hasSellCount: ratingsMapped?.sellCount != null,
          hasStrongSellCount: ratingsMapped?.strongSellCount != null,
        },
        warning: ratingsAudit.warning,
      },
      analystActions: {
        endpointAttempted: actionsAudit.endpointAttempted,
        selectedEndpoint: actionsAudit.selectedEndpoint,
        status: actionsAudit.status,
        itemCount: actionsAudit.items.length,
        firstItemKeys: extractTopLevelKeys(actionsAudit.items[0]),
        mappedFieldSummary: {
          mappedActionCount: mappedActionsCount,
        },
        warning: actionsAudit.warning,
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
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);

    const item = await this.fetchLatestRecordWithFallback<FmpAnalystRatingItem>(
      [...ANALYST_RATINGS_ENDPOINTS],
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
      [...UPGRADES_DOWNGRADES_ENDPOINTS],
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
        [...UPGRADES_DOWNGRADES_ENDPOINTS],
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
