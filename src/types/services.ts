import type {
  AIReport,
  AnalystActionEvent,
  AnalystSnapshot,
  AlertSeverity,
  EarningsEvent,
  FundamentalSnapshot,
  Holding,
  HoldingStatus,
  Watchlist,
  WatchlistItem,
  WatchlistItemPriority,
  WatchlistItemSource,
  WatchlistItemStatus,
  NewsArticle,
  Portfolio,
  Prediction,
  PredictionDirection,
  PredictionHorizon,
  PriceSnapshot,
  Recommendation,
  RiskLevel,
  Sentiment,
  Stock,
  GeopoliticalEvent,
  MarketDiscoverySnapshot,
  TechnicalSnapshot,
  TrendDirection,
  Prisma,
} from "@prisma/client";

import type { RepositoryListOptions } from "./common";

export interface ServiceResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface SectorCount {
  sector: string;
  count: number;
}

export type CadConversionStatus =
  | "DIRECT_CAD"
  | "CONVERTED"
  | "MISSING_FX"
  | "UNSUPPORTED_CURRENCY";

export interface PortfolioFxIssue {
  ticker: string;
  currency: string | null;
}

export interface PortfolioFxRateUsed {
  pair: "USD/CAD";
  rate: number;
  source: string | null;
  capturedAt: Date | string | null;
}

export interface PortfolioOverviewHoldingSummary extends Holding {
  stock: Stock;
  holdingId: string;
  stockId: string;
  ticker: string;
  companyName?: string | null;
  status: HoldingStatus;
  shares: number | null;
  averageCost: number | null;
  sector?: string | null;
  industry?: string | null;
  exchange?: string | null;
  currency?: string | null;
  latestPrice?: number | null;
  latestPriceCapturedAt?: Date | string | null;
  dailyChangePercent?: number | null;
  previousClose?: number | null;
  volume?: number | string | null;
  marketCap?: number | string | null;
  nativeCurrency?: string | null;
  latestPriceNative?: number | null;
  marketValueNative?: number | null;
  costBasisNative?: number | null;
  unrealizedGainLossNative?: number | null;
  unrealizedGainLossPercent?: number | null;
  marketValue?: number | null;
  costBasis?: number | null;
  unrealizedGainLoss?: number | null;
  cadFxRate?: number | null;
  cadFxRateSource?: string | null;
  cadFxRateCapturedAt?: Date | string | null;
  marketValueCad?: number | null;
  costBasisCad?: number | null;
  unrealizedGainLossCad?: number | null;
  conversionStatus?: CadConversionStatus;
  latestRecommendation?: Recommendation | null;
  latestSentiment?: Sentiment | null;
  latestConfidenceScore?: number | null;
  latestRiskScore?: number | null;
  latestReportDate?: Date | string | null;
}

export interface PortfolioOverview {
  portfolio: Portfolio;
  holdings: PortfolioOverviewHoldingSummary[];
  portfolioBaseCurrency: "CAD";
  holdingCount: number;
  ownedHoldingCount: number;
  watchlistHoldingCount: number;
  estimatedMarketValue: number | null;
  totalMarketValueNative: number | null;
  totalMarketValueCad: number | null;
  totalCostBasisCad: number | null;
  totalUnrealizedGainLossCad: number | null;
  totalUnrealizedGainLossPercentCad: number | null;
  fxRateUsed: PortfolioFxRateUsed | null;
  holdingsMissingFx: PortfolioFxIssue[];
  holdingsUnsupportedCurrency: PortfolioFxIssue[];
  topSectorsByCount: SectorCount[];
}

export interface HoldingOverview {
  holding: Holding & { stock: Stock };
  nativeCurrency: string | null;
  latestPriceNative: number | null;
  marketValueNative: number | null;
  costBasisNative: number | null;
  unrealizedGainLossNative: number | null;
  unrealizedGainLossPercent: number | null;
  latestPrice: number | null;
  marketValue: number | null;
  costBasis: number | null;
  unrealizedGainLoss: number | null;
  cadFxRate: number | null;
  cadFxRateSource: string | null;
  cadFxRateCapturedAt: Date | string | null;
  marketValueCad: number | null;
  costBasisCad: number | null;
  unrealizedGainLossCad: number | null;
  conversionStatus: CadConversionStatus;
  latestPriceSnapshot: PriceSnapshot | null;
  latestTechnicalSnapshot: TechnicalSnapshot | null;
  latestFundamentalSnapshot: FundamentalSnapshot | null;
  latestAIReport: AIReport | null;
  recentNews: NewsArticle[];
}

export interface TickerDashboardSummary {
  stock: Stock;
  latestPriceSnapshot: PriceSnapshot | null;
  latestTechnicalSnapshot: TechnicalSnapshot | null;
  latestFundamentalSnapshot: FundamentalSnapshot | null;
  latestAnalystSnapshot: AnalystSnapshot | null;
  recentAnalystActions: AnalystActionEvent[];
  latestAnnualAnalystEstimate?: {
    period: "annual";
    date: string;
    revenueLow?: number;
    revenueHigh?: number;
    revenueAvg?: number;
    epsAvg?: number;
    epsHigh?: number;
    epsLow?: number;
    numAnalystsRevenue?: number;
    numAnalystsEps?: number;
  } | null;
  latestQuarterAnalystEstimate?: {
    period: "quarter";
    date: string;
    revenueLow?: number;
    revenueHigh?: number;
    revenueAvg?: number;
    epsAvg?: number;
    epsHigh?: number;
    epsLow?: number;
    numAnalystsRevenue?: number;
    numAnalystsEps?: number;
  } | null;
  fmpFinancialRating?: {
    rating?: string;
    overallScore?: number;
    discountedCashFlowScore?: number;
    returnOnEquityScore?: number;
    returnOnAssetsScore?: number;
    debtToEquityScore?: number;
    priceToEarningsScore?: number;
    priceToBookScore?: number;
    capturedAt?: string;
  } | null;
  recentNews: NewsArticle[];
  nextEarningsEvent: EarningsEvent | null;
  latestAIReport: AIReport | null;
}

export interface WatchlistDetailItem extends WatchlistItem {
  stock: Stock;
}

export interface WatchlistDetail {
  watchlist: Watchlist;
  items: WatchlistDetailItem[];
}

export interface WatchlistResearchItemSummary {
  itemId: string;
  watchlistId: string;
  stockId: string;
  ticker: string;
  companyName: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  status: WatchlistItemStatus;
  priority: WatchlistItemPriority;
  source: WatchlistItemSource;
  thesis: string | null;
  riskNotes: string | null;
  tags: string[];
  addedReason: string | null;
  rejectionReason: string | null;
  targetEntryPrice: number | null;
  targetExitPrice: number | null;
  targetAllocation: number | null;
  lastReviewedAt: Date | string | null;
  latestPriceSnapshot: PriceSnapshot | null;
  latestTechnicalSnapshot: TechnicalSnapshot | null;
  latestFundamentalSnapshot: FundamentalSnapshot | null;
  latestAnalystSnapshot: AnalystSnapshot | null;
  recentAnalystActions: AnalystActionEvent[];
  latestAnnualAnalystEstimate?: TickerDashboardSummary["latestAnnualAnalystEstimate"];
  latestQuarterAnalystEstimate?: TickerDashboardSummary["latestQuarterAnalystEstimate"];
  fmpFinancialRating?: TickerDashboardSummary["fmpFinancialRating"];
  discoveryContext: {
    category: string | null;
    source: string | null;
  } | null;
  latestAIReport: AIReport | null;
  latestReportRecommendation: Recommendation | null;
  latestReportSentiment: Sentiment | null;
  latestReportConfidenceScore: number | null;
  latestReportDate: Date | string | null;
  nextEarningsEvent: EarningsEvent | null;
  topHeadlines: NewsArticle[];
  hasResearchData: boolean;
  missingResearchData: string[];
  latestResearchUpdatedAt: Date | string | null;
  sentimentCounts: {
    bullish: number;
    neutral: number;
    bearish: number;
    mixed: number;
    unknown: number;
  };
}

export interface WatchlistResearchBundle {
  watchlist: Watchlist;
  itemCount: number;
  geopoliticalSummary?: GeopoliticalSummaryResult;
  items: WatchlistResearchItemSummary[];
}

export type SuggestedResearchStance =
  | "STRONG_CANDIDATE"
  | "CANDIDATE"
  | "WATCH"
  | "HOLD_OFF"
  | "AVOID";

export type ResearchActionLabel =
  | "Strong review candidate"
  | "Review candidate"
  | "Monitor"
  | "Hold off / insufficient signal";

export type ResearchScoreConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface TickerResearchComponentScores {
  technicalScore: number;
  fundamentalScore: number;
  valuationScore: number;
  analystScore: number;
  newsScore: number;
  macroRiskScore: number;
  earningsRiskScore: number;
  dataQualityScore: number;
}

export interface TickerResearchScoreResult {
  ticker: string;
  asOf: string;
  componentScores: TickerResearchComponentScores;
  compositeScore: number;
  suggestedStance: SuggestedResearchStance;
  actionLabel: ResearchActionLabel;
  bullishFactors: string[];
  bearishFactors: string[];
  missingData: string[];
  staleDataWarnings: string[];
  confidence: ResearchScoreConfidence;
  explanation: string;
}

export interface ResolveTickerOrCompanyCandidate {
  ticker: string;
  companyName?: string;
  exchange?: string;
  currency?: string;
  country?: string;
  stockId?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  ambiguityReason?: string;
  alreadyHeld?: boolean;
  alreadyInWatchlist?: boolean;
}

export interface ResolveTickerOrCompanyResult {
  query: string;
  normalizedQuery: string;
  explicitTicker?: string;
  resolvedTicker?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  isAmbiguous: boolean;
  ambiguityReason?: string;
  candidates: ResolveTickerOrCompanyCandidate[];
}

export interface WatchlistScoredItem {
  rank: number;
  itemId: string | null;
  ticker: string;
  status?: WatchlistItemStatus;
  priority?: WatchlistItemPriority;
  compositeScore: number;
  suggestedStance: SuggestedResearchStance;
  score: TickerResearchScoreResult;
}

export interface WatchlistSkippedItem {
  ticker: string;
  reason: string;
  missingData?: string[];
}

export interface WatchlistResearchScoreResult {
  watchlistId: string;
  watchlistName: string;
  asOf: string;
  totalItems: number;
  activeItemsCount: number;
  scoredItemsCount: number;
  skippedItemsCount: number;
  skippedItems: WatchlistSkippedItem[];
  warnings: string[];
  itemCount: number;
  rankedItems: WatchlistScoredItem[];
}

export interface PortfolioRankedHolding {
  rank: number;
  ticker: string;
  companyName: string | null;
  quantity: number | null;
  marketValueCad: number | null;
  marketValueNative: number | null;
  portfolioWeight: number | null;
  compositeScore: number;
  suggestedStance: SuggestedResearchStance;
  componentScores: TickerResearchComponentScores;
  bullishFactors: string[];
  bearishFactors: string[];
  missingData: string[];
  staleDataWarnings: string[];
}

export interface PortfolioRankedSkippedHolding {
  ticker: string;
  reason: string;
  missingData: string[];
}

export interface PortfolioHoldingRankingResult {
  portfolioId: string;
  asOf: string;
  totalHoldings: number;
  scoredHoldingsCount: number;
  skippedHoldingsCount: number;
  skippedHoldings: PortfolioRankedSkippedHolding[];
  rankedHoldings: PortfolioRankedHolding[];
  warnings: string[];
}

export interface RefreshWatchlistResearchDataOptions {
  historicalLimit?: number;
  newsLimitPerTicker?: number;
  includeMarketData?: boolean;
  includeFundamentals?: boolean;
  includeEarnings?: boolean;
  includeNews?: boolean;
  includeAnalystData?: boolean;
  runReports?: boolean;
  activeStatuses?: WatchlistItemStatus[];
  dryRun?: boolean;
}

export interface WatchlistRefreshCategoryResult {
  attempted: boolean;
  success: boolean;
  warnings: string[];
  error?: string;
  summary?: Record<string, unknown>;
}

export interface WatchlistRefreshPerTickerResult {
  ticker: string;
  itemId: string | null;
  status: WatchlistItemStatus;
  skipped: boolean;
  skipReason?: string;
  warnings: string[];
  failedCategories: string[];
  marketData?: WatchlistRefreshCategoryResult;
  fundamentals?: WatchlistRefreshCategoryResult;
  earnings?: WatchlistRefreshCategoryResult;
  news?: WatchlistRefreshCategoryResult;
  analystData?: WatchlistRefreshCategoryResult;
  report?: WatchlistRefreshCategoryResult;
}

export interface RefreshWatchlistResearchDataResult {
  watchlistId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  tickersSkipped: number;
  plannedTickers?: string[];
  perTickerResults: WatchlistRefreshPerTickerResult[];
  warnings: string[];
}

export interface RefreshTickerResearchDataOptions {
  includeMarketData?: boolean;
  includeHistorical?: boolean;
  includeFundamentals?: boolean;
  includeNews?: boolean;
  includeEarnings?: boolean;
  includeAnalyst?: boolean;
  generateReport?: boolean;
}

export interface RefreshTickerResearchDataSectionResult {
  attempted: boolean;
  success: boolean;
  warnings: string[];
  error?: string;
  summary?: Record<string, unknown>;
}

export interface RefreshTickerResearchDataResult {
  ticker: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sections: {
    marketData: RefreshTickerResearchDataSectionResult;
    fundamentals: RefreshTickerResearchDataSectionResult;
    news: RefreshTickerResearchDataSectionResult;
    earnings: RefreshTickerResearchDataSectionResult;
    analyst: RefreshTickerResearchDataSectionResult;
    report: RefreshTickerResearchDataSectionResult;
  };
  warnings: string[];
}

export interface CompareTickersResult {
  asOf: string;
  requestedTickers: string[];
  scores: TickerResearchScoreResult[];
  keyDifferences: string[];
}

export interface PortfolioRiskExposure {
  key: string;
  holdings: number;
  marketValueCad: number | null;
  sharePercent: number | null;
}

export interface PortfolioConcentrationRisk {
  type: "HOLDING" | "SECTOR";
  key: string;
  sharePercent: number;
  message: string;
}

export interface PortfolioRiskConversionStatus {
  ticker: string;
  currency: string | null;
  conversionStatus: CadConversionStatus;
}

export interface PortfolioRiskSnapshotResult {
  portfolioId: string;
  asOf: string;
  fxRateUsed: PortfolioFxRateUsed | null;
  holdingsMissingFx: PortfolioFxIssue[];
  holdingsUnsupportedCurrency: PortfolioFxIssue[];
  holdingsMissingCurrency: Array<{ ticker: string }>;
  conversionStatuses: PortfolioRiskConversionStatus[];
  concentrationRisks: PortfolioConcentrationRisk[];
  currencyExposure: PortfolioRiskExposure[];
  sectorExposure: PortfolioRiskExposure[];
  missingData: string[];
  topRisks: string[];
  summary: string;
}

export interface TickerDataQualityResult {
  ticker: string;
  hasPrice: boolean;
  hasTechnical: boolean;
  hasFundamental: boolean;
  hasAnalyst: boolean;
  hasNews: boolean;
  hasEarnings: boolean;
  hasReport: boolean;
  missingData: string[];
  staleDataWarnings: string[];
  suggestedRefreshActions: string[];
}

export interface WatchlistTickerDataQualityResult extends TickerDataQualityResult {
  itemId: string | null;
  status?: WatchlistItemStatus;
  priority?: WatchlistItemPriority;
}

export interface WatchlistDataQualityResult {
  watchlistId: string;
  itemCount: number;
  completeItemsCount: number;
  partialItemsCount: number;
  emptyItemsCount: number;
  perTickerQuality: WatchlistTickerDataQualityResult[];
  suggestedRefreshActions: string[];
}

export interface PortfolioDataQualityResult {
  portfolioId: string;
  holdingCount: number;
  missingFxIssues: PortfolioFxIssue[];
  missingCurrencyIssues: Array<{ ticker: string }>;
  missingPriceIssues: Array<{ ticker: string }>;
  staleDataWarnings: string[];
  suggestedRefreshActions: string[];
}

export interface GeopoliticalSummaryResult {
  from: string;
  to: string;
  totalEvents: number;
  countsByCategory: Array<{ key: string; count: number }>;
  countsByTheme: Array<{ key: string; count: number }>;
  sentimentMix: {
    positive: number;
    neutral: number;
    negative: number;
    unknown: number;
  };
  topHeadlines: Array<{
    title: string;
    publishedAt: string;
    source: string | null;
    domain: string | null;
    sentiment: string | null;
  }>;
  topCountries: Array<{ key: string; count: number }>;
  topDomains: Array<{ key: string; count: number }>;
  message?: string;
  suggestedActions?: string[];
}

export interface DailyTickerReportInput {
  ticker: string;
  holdingId?: string | null;
  reportDate?: Date;
  recommendation: Recommendation;
  sentiment: Sentiment;
  confidenceScore: number;
  riskScore: number;
  riskLevel: RiskLevel;
  keyTakeaway: string;
  currentPrice?: number | null;
  dailyChangePercent?: number | null;
  shortTermOutlook?: string | null;
  mediumTermOutlook?: string | null;
  longTermOutlook?: string | null;
  bullishFactors?: string[];
  bearishFactors?: string[];
  technicalSummary?: string | null;
  fundamentalSummary?: string | null;
  newsSummary?: string | null;
  earningsSummary?: string | null;
  macroGeopoliticalSummary?: string | null;
  whatChanged?: string | null;
  whatWouldChangeRecommendation?: string | null;
  sourceReferences?: Prisma.InputJsonValue;
  modelName?: string | null;
  promptVersion?: string | null;
  rawModelOutput?: Prisma.InputJsonValue;
  createPredictions?: boolean;
}

export interface PortfolioSummaryInput {
  portfolioId: string;
  summaryDate?: Date;
  overallSentiment: Sentiment;
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  bullishHoldingsCount: number;
  bearishHoldingsCount: number;
  neutralHoldingsCount: number;
  topPositiveDevelopments?: string[];
  topNegativeDevelopments?: string[];
  highestRiskTicker?: string | null;
  highestConvictionTicker?: string | null;
  upcomingEarnings?: Prisma.InputJsonValue | null;
  concentrationRisks?: string[];
  suggestedWatchItems?: string[];
}

export interface PredictionOutcomeCalculationInput {
  predictionId: string;
  asOfDate?: Date;
  flatThresholdPercent?: number;
}

export interface RecommendationChangeInput {
  userId: string;
  stockId?: string;
  previousRecommendation: Recommendation;
  newRecommendation: Recommendation;
}

export interface AlertCreationInput {
  userId: string;
  stockId?: string;
  title: string;
  message: string;
  severity?: AlertSeverity;
  category?: string;
  sourceType?: string;
  sourceId?: string;
}

export interface MarketDataSnapshotInput {
  price: number;
  source?: string | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  previousClose?: number | null;
  volume?: bigint | number | null;
  marketCap?: bigint | number | null;
  changePercent?: number | null;
  capturedAt?: Date;
}

export interface TechnicalAnalysisInput {
  sma5?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  rsi14?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHistogram?: number | null;
  volatility?: number | null;
  volume30DayAverage?: number | null;
  volumeRelativeToAverage?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  distanceFrom52WeekHigh?: number | null;
  distanceFrom52WeekLow?: number | null;
  trendDirection?: TrendDirection | null;
  capturedAt?: Date;
}

export interface NewsAnalysisInput {
  headline: string;
  url: string;
  source?: string | null;
  author?: string | null;
  publishedAt?: Date;
  summary?: string | null;
  rawExcerpt?: string | null;
  sentiment?: Sentiment | null;
  sentimentScore?: number | null;
  materialityScore?: number | null;
  relevanceExplanation?: string | null;
}

export interface NewsSentimentSummary {
  ticker: string;
  totalArticles: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  mixedCount: number;
  averageSentimentScore: number | null;
  averageMaterialityScore: number | null;
}

export interface AlertQueryOptions extends RepositoryListOptions {
  isRead?: boolean;
  severity?: AlertSeverity;
}

export interface TickerReportGenerationResult {
  report: AIReport;
  predictions: Prediction[];
  reportMode?: TickerReportMode;
  fallbackUsed?: boolean;
  warnings?: string[];
  dataGaps?: string[];
  modelName?: string;
}

export type TickerReportDataQualityConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface TickerReportContextBuildOptions {
  portfolioId?: string;
  watchlistId?: string;
  includeMacro?: boolean;
  includeGeopolitical?: boolean;
  includeNews?: boolean;
  includeAnalyst?: boolean;
  includeScore?: boolean;
}

export interface TickerReportGenerationOptions extends TickerReportContextBuildOptions {
  holdingId?: string | null;
  useOpenAi?: boolean;
  refreshBeforeGenerate?: boolean;
  createPredictions?: boolean;
}

export interface TickerReportContext {
  ticker: string;
  companyName: string | null;
  exchange: string | null;
  currency: string | null;
  asOf: string;
  dataQuality: {
    missingData: string[];
    staleDataWarnings: string[];
    confidence: TickerReportDataQualityConfidence;
  };
  marketSnapshot: {
    price: number | null;
    previousClose: number | null;
    changePercent: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: string | null;
    marketCap: string | null;
    capturedAt: string | null;
    source: string | null;
  } | null;
  technicalSnapshot: {
    trendDirection: string | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    rsi14: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    volatility: number | null;
    capturedAt: string | null;
  } | null;
  fundamentalSnapshot: {
    peRatio: number | null;
    forwardPeRatio: number | null;
    pegRatio: number | null;
    priceToSales: number | null;
    priceToBook: number | null;
    evToEbitda: number | null;
    eps: number | null;
    revenueGrowth: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    netMargin: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    freeCashFlow: string | null;
    dividendYield: number | null;
    analystConsensus: string | null;
    capturedAt: string | null;
    source: string | null;
  } | null;
  analystContext: {
    ratingConsensus: string | null;
    analystCount: number | null;
    priceTargetAverage: number | null;
    priceTargetHigh: number | null;
    priceTargetLow: number | null;
    priceTargetConsensus: number | null;
    targetMedian: number | null;
    upsidePercent: number | null;
    strongBuyCount: number | null;
    buyCount: number | null;
    holdCount: number | null;
    sellCount: number | null;
    strongSellCount: number | null;
    capturedAt: string | null;
    source: string | null;
  } | null;
  recentAnalystActions: Array<{
    actionType: string;
    firm: string | null;
    newRating: string | null;
    previousRating: string | null;
    newPriceTarget: number | null;
    previousPriceTarget: number | null;
    eventDate: string;
  }>;
  analystEstimates: {
    latestAnnual: TickerDashboardSummary["latestAnnualAnalystEstimate"] | null;
    latestQuarter: TickerDashboardSummary["latestQuarterAnalystEstimate"] | null;
  };
  fmpFinancialRating: TickerDashboardSummary["fmpFinancialRating"] | null;
  newsContext: {
    totalArticles: number;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    mixedCount: number;
    averageSentimentScore: number | null;
    averageMaterialityScore: number | null;
    topHeadlines: Array<{
      headline: string;
      publishedAt: string;
      source: string | null;
      sentiment: string | null;
      sentimentScore: number | null;
      materialityScore: number | null;
    }>;
  } | null;
  earningsContext: {
    nextEarningsDate: string | null;
    earningsTime: string | null;
    estimatedEps: number | null;
    estimatedRevenue: string | null;
    fiscalQuarter: string | null;
    fiscalYear: number | null;
    isDateConfirmed: boolean | null;
  } | null;
  macroContext: {
    summary: string;
  } | null;
  geopoliticalContext: GeopoliticalSummaryResult | null;
  portfolioContext?: {
    portfolioId: string;
    baseCurrency: string;
    holdingCount: number;
    matchingHoldingsCount: number;
    matchingHoldingIds: string[];
    matchingMarketValueCad: number | null;
    matchingWeightPercent: number | null;
  } | null;
  watchlistContext?: {
    watchlistId: string;
    watchlistName: string;
    itemCount: number;
    matchingItemsCount: number;
    matchingStatuses: string[];
    matchingPriorities: string[];
    thesisSamples: string[];
  } | null;
  deterministicScore?: TickerResearchScoreResult | null;
}

export type TickerReportMode = "OPENAI_STRUCTURED" | "DETERMINISTIC_FALLBACK";

export interface AIReportWithStockMetadata extends AIReport {
  ticker: string;
  companyName: string | null;
  exchange: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
}

export interface PortfolioAnalysisTickerFailure {
  ticker: string;
  reason: string;
}

export interface PortfolioAnalysisReportSummary {
  id: string;
  ticker: string;
  recommendation: Recommendation;
  sentiment: Sentiment;
  confidenceScore: number;
  riskScore: number;
}

export interface PortfolioAnalysisResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  holdingsAnalyzed: number;
  reportsCreated: number;
  predictionsCreated: number;
  failedTickers: PortfolioAnalysisTickerFailure[];
  reports: PortfolioAnalysisReportSummary[];
  portfolioSummary: {
    id: string;
    overallSentiment: Sentiment;
    overallRiskScore: number;
    overallRiskLevel: RiskLevel;
  } | null;
}

export interface SeedDemoMarketDataOptions {
  runAnalysis?: boolean;
}

export interface SeedDemoMarketDataResult {
  demoPortfolioId: string;
  tickersSeeded: string[];
  priceSnapshotsCreated: number;
  technicalSnapshotsCreated: number;
  fundamentalSnapshotsCreated: number;
  newsArticlesCreated: number;
  earningsEventsCreated: number;
  analysis?: PortfolioAnalysisResult;
}

export interface PurgeDemoAnalyticalDataOptions {
  ticker?: string;
  portfolioId?: string;
  allowLegacyDemoPurge?: boolean;
}

export interface PurgeDemoAnalyticalDataResult {
  scope: {
    ticker?: string;
    portfolioId?: string;
    affectedStockIds: string[];
    affectedPortfolioIds: string[];
  };
  priceSnapshotsDeleted: number;
  fundamentalSnapshotsDeleted: number;
  earningsEventsDeleted: number;
  newsArticlesDeleted: number;
  aiReportsDeleted: number;
  predictionsDeleted: number;
  portfolioSummariesDeleted: number;
  alertsDeleted: number;
  warnings: string[];
}

export interface IngestTickerMarketDataOptions {
  historicalLimit?: number;
}

export interface IngestTickerMarketDataResult {
  ticker: string;
  profileUpdated: boolean;
  quoteSnapshotCreated: boolean;
  historicalSnapshotsCreated: number;
  historicalSnapshotsUpdated: number;
  historicalSnapshotsSkipped: number;
  technicalSnapshotCreated: boolean;
  warnings: string[];
}

export interface IngestPortfolioMarketDataOptions {
  historicalLimit?: number;
  runAnalysis?: boolean;
}

export interface IngestPortfolioTickerFailure {
  ticker: string;
  reason: string;
}

export interface IngestPortfolioMarketDataResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  results: IngestTickerMarketDataResult[];
  failedTickers: IngestPortfolioTickerFailure[];
  analysis?: PortfolioAnalysisResult;
}

export interface IngestTickerFundamentalsResult {
  ticker: string;
  snapshotCreated: boolean;
  snapshotUpdated: boolean;
  snapshotSkipped: boolean;
  fieldsPopulated: string[];
  warnings: string[];
}

export interface IngestPortfolioFundamentalsResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  snapshotsSkipped: number;
  results: IngestTickerFundamentalsResult[];
  failedTickers: IngestPortfolioTickerFailure[];
}

export interface TickerEarningsIngestionResult {
  ticker: string;
  eventsCreated: number;
  eventsUpdated: number;
  nextEarningsDate?: string;
  warnings: string[];
}

export interface PortfolioEarningsIngestionResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  results: TickerEarningsIngestionResult[];
  failedTickers: IngestPortfolioTickerFailure[];
}

export interface IngestTickerNewsOptions {
  limit?: number;
  from?: Date;
  to?: Date;
}

export interface IngestTickerNewsResult {
  ticker: string;
  articlesCreated: number;
  articlesUpdated: number;
  articlesSkipped: number;
  warnings: string[];
}

export interface IngestPortfolioNewsOptions {
  limitPerTicker?: number;
}

export interface IngestPortfolioNewsResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  results: IngestTickerNewsResult[];
  failedTickers: IngestPortfolioTickerFailure[];
}

export interface IngestTickerAnalystDataResult {
  ticker: string;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  actionsCreated: number;
  actionsUpdated: number;
  priceTargetSummaryStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  priceTargetConsensusStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  gradesConsensusStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  gradesHistoricalStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  gradesStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  analystEstimatesStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  ratingsSnapshotStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  analystRatingsStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  analystActionsStatus: "SUCCESS" | "EMPTY" | "ENTITLEMENT" | "ERROR" | "SKIPPED";
  subsourceWarnings: {
    priceTargetSummary: string[];
    priceTargetConsensus: string[];
    gradesConsensus: string[];
    gradesHistorical: string[];
    grades: string[];
    analystEstimates: string[];
    ratingsSnapshot: string[];
    analystRatings: string[];
    analystActions: string[];
  };
  warnings: string[];
}

export interface AnalystWarningsSummary {
  entitlementIssuesCount: number;
  noDataCount: number;
  noRecordsCount: number;
  affectedTickers: string[];
  examples: string[];
}

export interface IngestPortfolioAnalystDataResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  actionsCreated: number;
  actionsUpdated: number;
  results: IngestTickerAnalystDataResult[];
  failedTickers: IngestPortfolioTickerFailure[];
  analystWarningsSummary: AnalystWarningsSummary;
  rawWarnings: string[];
  warnings: string[];
}

export interface IngestWatchlistAnalystDataResult {
  watchlistId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  tickersProcessed: number;
  tickersFailed: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  actionsCreated: number;
  actionsUpdated: number;
  results: IngestTickerAnalystDataResult[];
  failedTickers: IngestPortfolioTickerFailure[];
  analystWarningsSummary: AnalystWarningsSummary;
  rawWarnings: string[];
  warnings: string[];
}

export interface IngestMarketDiscoveryResult {
  category: string;
  capturedAt: string;
  recordsCreated: number;
  warnings: string[];
}

export interface IngestDefaultMarketDiscoverySetResult {
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  categories: IngestMarketDiscoveryResult[];
  warnings: string[];
}

export interface ListDiscoveryCandidatesOptions {
  limit?: number;
  from?: Date;
  to?: Date;
  minPrice?: number;
  minVolume?: number;
  minMarketCap?: number;
  maxChangePercent?: number;
  exchanges?: string[];
  excludeOtc?: boolean;
  excludeLowPrice?: boolean;
}

export interface GdeltIngestionOptions {
  from?: Date;
  to?: Date;
  maxRecords?: number;
  queryProfile?: string;
}

export interface GdeltQueryProfile {
  queryProfile: string;
  query: string;
  lookbackDays: number;
  maxRecords: number;
  expectedUseCase: string;
}

export interface GdeltDefaultRiskIngestionOptions {
  from?: Date;
  to?: Date;
  maxRecords?: number;
  maxRecordsPerQuery?: number;
  queries?: string[];
  mode?: "quick" | "full";
}

export interface GdeltQueryFailureDetail {
  query: string;
  reason: string;
  failureCode?: string;
  statusCode?: number;
  retryAttempted?: boolean;
}

export interface GdeltResponseDiagnosticItem {
  query: string;
  failureCode?: string;
  statusCode?: number;
  contentType?: string | null;
  contentLength?: number;
  responsePreview?: string;
  retryAttempted?: boolean;
}

export interface IngestGeopoliticalQueryResult {
  query: string;
  queryProfile?: string;
  eventsCreated: number;
  eventsUpdated: number;
  eventsSkipped: number;
  warnings: string[];
}

export interface IngestDefaultGdeltRiskSetResult {
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  queriesProcessed: number;
  queriesFailed: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsSkipped: number;
  warnings: string[];
  failedQueries: GdeltQueryFailureDetail[];
  results: IngestGeopoliticalQueryResult[];
  queryProfiles?: GdeltQueryProfile[];
  responseDiagnostics?: GdeltResponseDiagnosticItem[];
}

export interface GdeltQueryAuditResult {
  query: string;
  url: string;
  statusCode: number;
  elapsedMs: number;
  rawTopLevelKeys: string[];
  articleCount: number;
  firstArticleKeys: string[];
  mappedEventCount: number;
  retryAttempted: boolean;
  warnings: string[];
}

export interface LatestGeopoliticalContextResult {
  from: string;
  to: string;
  items: GeopoliticalEvent[];
}

export interface DiscoveryCandidatesResult {
  category: string;
  candidateCount: number;
  topTickers: string[];
  capturedAt?: string;
  warnings: string[];
  items: MarketDiscoverySnapshot[];
}

export type AgentInvestmentObjective =
  | "GROWTH"
  | "VALUE"
  | "DIVIDEND"
  | "QUALITY"
  | "LOW_VOLATILITY"
  | "MOMENTUM"
  | "DIVERSIFICATION";

export type AgentInvestmentTimeHorizon = "SHORT" | "MEDIUM" | "LONG";

export type AgentInvestmentRiskTolerance = "LOW" | "MEDIUM" | "HIGH";

export interface AgentInvestmentPreferences {
  objective?: AgentInvestmentObjective;
  timeHorizon?: AgentInvestmentTimeHorizon;
  riskTolerance?: AgentInvestmentRiskTolerance;
  preferredSectors?: string[];
  excludedSectors?: string[];
  preferredCurrencies?: string[];
  maxSinglePositionWeight?: number;
  wantsIncome?: boolean;
  wantsCanada?: boolean;
  wantsUS?: boolean;
}

export interface ScreenMarketCandidatesOptions {
  portfolioId?: string;
  watchlistId?: string;
  preferences?: AgentInvestmentPreferences;
  limit?: number;
  excludeExistingHoldings?: boolean;
  excludeExistingWatchlistItems?: boolean;
}

export interface ScreenMarketCandidate {
  rank: number;
  ticker: string;
  companyName: string | null;
  score: number;
  preferenceFitScore: number;
  portfolioFitScore: number;
  totalRecommendationScore: number;
  actionLabel: string;
  why: string[];
  cautions: string[];
  missingData: string[];
  alreadyHeld: boolean;
  alreadyInWatchlist: boolean;
  suggestedAction: "ADD_TO_WATCHLIST" | "NO_ACTION";
}

export interface RejectedScreenMarketCandidate {
  ticker: string;
  reason: string;
  score?: number;
  actionLabel?: string;
  missingData: string[];
  alreadyHeld: boolean;
  alreadyInWatchlist: boolean;
}

export interface ScreenMarketCandidatesResult {
  screenedCount: number;
  qualifiedCount: number;
  candidates: ScreenMarketCandidate[];
  rejectedCandidates: RejectedScreenMarketCandidate[];
  assumptions: string[];
  clarifyingQuestion?: string;
  suggestedRefreshActions: string[];
  preferencesApplied: Required<
    Pick<AgentInvestmentPreferences, "objective" | "timeHorizon" | "riskTolerance">
  > & Omit<AgentInvestmentPreferences, "objective" | "timeHorizon" | "riskTolerance">;
}

export interface RankDiscoveryCandidatesOptions {
  portfolioId?: string;
  watchlistId?: string;
  category?: string;
  limit?: number;
  excludeExistingHoldings?: boolean;
  excludeExistingWatchlistItems?: boolean;
}

export interface RankedDiscoveryCandidate {
  rank: number;
  ticker: string;
  companyName: string | null;
  category: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | string | null;
  compositeScore: number;
  suggestedStance: SuggestedResearchStance;
  actionLabel: string;
  qualifiesForRecommendation: boolean;
  why: string[];
  cautions: string[];
  dataQualityScore: number | null;
  bullishFactors: string[];
  bearishFactors: string[];
  missingData: string[];
  staleDataWarnings: string[];
  diversificationNotes: string[];
  alreadyHeld: boolean;
  alreadyInWatchlist: boolean;
}

export interface SkippedDiscoveryCandidate {
  ticker: string;
  reason: string;
  missingData: string[];
}

export interface RankDiscoveryCandidatesResult {
  category: string;
  totalCandidates: number;
  scoredCandidatesCount: number;
  skippedCandidatesCount: number;
  recommendationThreshold: {
    minimumRecommendationScore: number;
    monitorOnlyScoreFloor: number;
    monitorOnlyScoreCeiling: number;
    labels: {
      strongReviewCandidate: string;
      reviewCandidate: string;
      monitorOnly: string;
      notRecommended: string;
    };
  };
  noQualifiedCandidates: boolean;
  reasonNoQualifiedCandidates?: string;
  rankedCandidates: RankedDiscoveryCandidate[];
  recommendedCandidates: RankedDiscoveryCandidate[];
  monitorCandidates: RankedDiscoveryCandidate[];
  notRecommendedCandidates: RankedDiscoveryCandidate[];
  bestAvailableButBelowThreshold: RankedDiscoveryCandidate[];
  skippedCandidates: SkippedDiscoveryCandidate[];
  warnings: string[];
  suggestedRefreshActions: string[];
}

export interface FmpEconomicsIngestionSectionResult {
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  warnings: string[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface MacroIngestionSectionResult {
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  warnings: string[];
  failedSeries?: string[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface MacroIngestionDateRangeOptions {
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface IngestDefaultFredMacroSetOptions extends MacroIngestionDateRangeOptions {
  seriesIds?: string[];
  maxSeries?: number;
}

export interface IngestDefaultMacroAndFxOptions extends MacroIngestionDateRangeOptions {
  includeBankOfCanada?: boolean;
  includeFred?: boolean;
  fredSeriesIds?: string[];
  bankOfCanadaLimit?: number;
  fredObservationLimit?: number;
  maxFredSeries?: number;
}

export interface IngestDefaultMacroAndFxResult {
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  bankOfCanada: MacroIngestionSectionResult;
  fred: MacroIngestionSectionResult;
  warnings: string[];
}

export interface IngestFmpTreasuryRatesOptions {
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface IngestFmpEconomicIndicatorsOptions {
  namesOrSeries?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface IngestFmpEconomicCalendarOptions {
  from: Date;
  to: Date;
}

export interface IngestFmpMarketRiskPremiumOptions {
  from?: Date;
  to?: Date;
}

export interface IngestFmpEconomicsDefaultSetOptions {
  includeTreasuryRates?: boolean;
  includeIndicators?: boolean;
  includeCalendar?: boolean;
  includeMarketRiskPremium?: boolean;
  treasuryRatesFrom?: Date;
  treasuryRatesTo?: Date;
  treasuryRatesLimit?: number;
  indicatorsFrom?: Date;
  indicatorsTo?: Date;
  indicatorsLimit?: number;
  indicatorNamesOrSeries?: string[];
  calendarFrom?: Date;
  calendarTo?: Date;
  marketRiskPremiumFrom?: Date;
  marketRiskPremiumTo?: Date;
}

export interface IngestFmpEconomicsDefaultSetResult {
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  treasuryRates: FmpEconomicsIngestionSectionResult;
  economicIndicators: FmpEconomicsIngestionSectionResult;
  economicCalendar: FmpEconomicsIngestionSectionResult;
  marketRiskPremium: FmpEconomicsIngestionSectionResult;
  warnings: string[];
}

export interface IngestPortfolioFullBasicOptions {
  historicalLimit?: number;
  runAnalysis?: boolean;
}

export interface IngestPortfolioFullBasicResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs?: number;
  marketData: IngestPortfolioMarketDataResult;
  fundamentals: IngestPortfolioFundamentalsResult;
  analysis?: PortfolioAnalysisResult;
}

export interface PortfolioFmpFullRefreshOptions {
  historicalLimit?: number;
  newsLimitPerTicker?: number;
  includeAnalystData?: boolean;
  includeGdelt?: boolean;
  gdeltMaxRecordsPerQuery?: number;
  gdeltLookbackDays?: number;
  includeEconomics?: boolean;
  includeBankOfCanada?: boolean;
  includeFred?: boolean;
  economicsCalendarPastDays?: number;
  economicsCalendarFutureDays?: number;
  fredObservationLimit?: number;
  bocObservationLimit?: number;
  macroMaxSeries?: number;
  refreshMode?: "quick" | "full";
  runAnalysis?: boolean;
}

export interface PortfolioFmpFullRefreshResult {
  portfolioId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  marketData: IngestPortfolioMarketDataResult;
  fundamentals: IngestPortfolioFundamentalsResult;
  earnings: PortfolioEarningsIngestionResult;
  news: IngestPortfolioNewsResult;
  analystData?: IngestPortfolioAnalystDataResult;
  analystWarningsSummary?: AnalystWarningsSummary;
  geopolitical?: IngestDefaultGdeltRiskSetResult;
  economics?: IngestFmpEconomicsDefaultSetResult;
  bankOfCanada?: MacroIngestionSectionResult;
  fred?: MacroIngestionSectionResult;
  macro?: IngestDefaultMacroAndFxResult;
  analysis?: PortfolioAnalysisResult;
  warnings: string[];
}

export interface PredictionScoringSummary {
  asOfDate: Date;
  totalDue: number;
  scoredCount: number;
  alreadyScoredCount: number;
  skippedNoPriceCount: number;
}

export interface PredictionCreationFromReportResult {
  prediction: Prediction;
  created: boolean;
}

export interface IngestionWrapOptions {
  provider?: string;
  ticker?: string;
}

export interface PredictionListItem {
  id: string;
  stockId: string;
  holdingId: string | null;
  aiReportId: string | null;
  predictionDate: Date;
  dueDate: Date;
  horizon: PredictionHorizon;
  recommendation: Recommendation;
  direction: PredictionDirection;
  confidenceScore: number;
  startingPrice: number;
  targetLow: number | null;
  targetHigh: number | null;
  bullishRationale: string | null;
  bearishRationale: string | null;
  dataUsed: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  ticker: string;
  companyName: string | null;
  exchange: string | null;
  currency: string | null;
}
