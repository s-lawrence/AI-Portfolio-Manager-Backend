import type {
  AIReport,
  AlertSeverity,
  EarningsEvent,
  FundamentalSnapshot,
  Holding,
  NewsArticle,
  Portfolio,
  Prediction,
  PredictionHorizon,
  PriceSnapshot,
  Recommendation,
  RiskLevel,
  Sentiment,
  Stock,
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

export interface PortfolioOverview {
  portfolio: Portfolio;
  holdings: Array<Holding & { stock: Stock }>;
  holdingCount: number;
  ownedHoldingCount: number;
  watchlistHoldingCount: number;
  estimatedMarketValue: number | null;
  topSectorsByCount: SectorCount[];
}

export interface HoldingOverview {
  holding: Holding & { stock: Stock };
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
  recentNews: NewsArticle[];
  nextEarningsEvent: EarningsEvent | null;
  latestAIReport: AIReport | null;
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
