export interface ProviderDateRangeOptions {
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface ProviderLimitOptions {
  limit?: number;
}

export interface ProviderQuote {
  ticker: string;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  marketCap?: number;
  currency?: string;
  exchange?: string;
  asOf?: Date;
}

export interface ProviderHistoricalPrice {
  ticker: string;
  date: Date;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjustedClose?: number;
  volume?: number;
}

export interface ProviderCompanyProfile {
  ticker: string;
  companyName?: string;
  description?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  country?: string;
  currency?: string;
  assetType?: string;
  website?: string;
  logoUrl?: string;
  marketCap?: number;
  employeeCount?: number;
}

export interface ProviderFundamentalSnapshot {
  ticker: string;
  asOfDate?: Date;
  period?: string;
  fiscalYear?: number;
  fiscalQuarter?: string;
  marketCap?: number;
  peRatio?: number;
  forwardPeRatio?: number;
  pegRatio?: number;
  priceToSales?: number;
  priceToBook?: number;
  evToEbitda?: number;
  eps?: number;
  revenueGrowth?: number;
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  debtToEquity?: number;
  currentRatio?: number;
  freeCashFlow?: number;
  dividendYield?: number;
  analystConsensus?: string;
  source?: string;
}

export interface ProviderEarningsEvent {
  ticker: string;
  fiscalQuarter?: string;
  fiscalYear?: number;
  earningsDate?: Date;
  earningsTime?: string;
  isDateConfirmed?: boolean;
  estimatedEps?: number;
  reportedEps?: number;
  epsSurprise?: number;
  estimatedRevenue?: number;
  reportedRevenue?: number;
  revenueSurprise?: number;
  guidanceSummary?: string;
  earningsCallUrl?: string;
  transcriptUrl?: string;
  source?: string;
}

export interface ProviderNewsArticle {
  ticker: string;
  headline: string;
  summary?: string;
  source?: string;
  author?: string;
  url: string;
  publishedAt: Date;
  rawExcerpt?: string;
  sentiment?: "positive" | "negative" | "neutral" | "mixed" | string;
  sentimentScore?: number;
  materialityScore?: number;
  relevanceExplanation?: string;
  isDemo?: false;
}

export interface ProviderMacroObservation {
  provider: string;
  seriesId: string;
  name?: string | null;
  country?: string | null;
  category?: string | null;
  value: number;
  unit?: string | null;
  observedAt: Date;
  source?: string | null;
}

export interface ProviderFxRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  capturedAt: Date;
  source?: string | null;
}

export interface ProviderAnalystSnapshot {
  ticker: string;
  capturedAt: Date;
  source?: string;
  priceTargetAverage?: number;
  priceTargetHigh?: number;
  priceTargetLow?: number;
  priceTargetConsensus?: number;
  analystCount?: number;
  ratingConsensus?: string;
  strongBuyCount?: number;
  buyCount?: number;
  holdCount?: number;
  sellCount?: number;
  strongSellCount?: number;
  upsidePercent?: number;
  raw?: unknown;
}

export interface ProviderAnalystActionEvent {
  ticker: string;
  source?: string;
  actionType: string;
  firm?: string;
  analystName?: string;
  previousRating?: string;
  newRating?: string;
  previousPriceTarget?: number;
  newPriceTarget?: number;
  eventDate: Date;
  headline?: string;
  url?: string;
  raw?: unknown;
}

export interface ProviderMarketDiscoveryItem {
  ticker: string;
  companyName?: string;
  price?: number;
  changePercent?: number;
  volume?: number;
  marketCap?: number;
  category: string;
  capturedAt: Date;
  source?: string;
  raw?: unknown;
}

export interface ProviderIngestionSectionResult {
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  warnings: string[];
  failedSeries?: string[];
}

export interface ProviderGeoEvent {
  id?: string;
  query?: string;
  title?: string;
  summary?: string;
  source?: string;
  url?: string;
  publishedAt?: Date;
  country?: string;
  region?: string;
  tone?: number;
  impactScore?: number;
}

export interface ProviderTreasuryRate {
  date: Date;
  month1?: number;
  month2?: number;
  month3?: number;
  month6?: number;
  year1?: number;
  year2?: number;
  year3?: number;
  year5?: number;
  year7?: number;
  year10?: number;
  year20?: number;
  year30?: number;
  source?: string;
}

export interface ProviderEconomicIndicator {
  name: string;
  seriesId?: string;
  country?: string;
  category?: string;
  value: number;
  unit?: string;
  date: Date;
  source?: string;
}

export interface ProviderEconomicCalendarEvent {
  title: string;
  country?: string;
  category?: string;
  importance?: string;
  eventDate: Date;
  actual?: number;
  estimate?: number;
  previous?: number;
  unit?: string;
  source?: string;
}

export interface ProviderMarketRiskPremium {
  date: Date;
  country?: string;
  equityRiskPremium?: number;
  countryRiskPremium?: number;
  totalRiskPremium?: number;
  source?: string;
}

export function normalizeProviderTickerOrThrow(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();

  if (!normalized) {
    throw new Error("Ticker must be a non-empty string.");
  }

  return normalized;
}

export interface MarketDataProvider {
  getQuote(ticker: string): Promise<ProviderQuote>;
  getHistoricalDailyPrices(
    ticker: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderHistoricalPrice[]>;
}

export interface CompanyProfileProvider {
  getCompanyProfile(ticker: string): Promise<ProviderCompanyProfile | null>;
}

export interface FundamentalsProvider {
  getFundamentals(ticker: string): Promise<ProviderFundamentalSnapshot | null>;
}

export interface EarningsProvider {
  getNextEarnings(ticker: string): Promise<ProviderEarningsEvent | null>;
  getEarningsHistory(
    ticker: string,
    options?: ProviderLimitOptions,
  ): Promise<ProviderEarningsEvent[]>;
}

export interface NewsProvider {
  getCompanyNews(
    ticker: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderNewsArticle[]>;
}

export interface MacroProvider {
  getSeriesObservations(
    seriesId: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderMacroObservation[]>;
}

export interface FxRateProvider {
  getUsdCadRate(
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderFxRate[]>;
}

export interface AnalystProvider {
  getPriceTargetSummary(
    ticker: string,
  ): Promise<ProviderAnalystSnapshot | null>;
  getPriceTargetConsensus(
    ticker: string,
  ): Promise<Partial<ProviderAnalystSnapshot> | null>;
  getAnalystRatings(
    ticker: string,
  ): Promise<Partial<ProviderAnalystSnapshot> | null>;
  getUpgradesDowngrades(
    ticker: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderAnalystActionEvent[]>;
  getMarketMovers(
    category: string,
    options?: ProviderLimitOptions,
  ): Promise<ProviderMarketDiscoveryItem[]>;
}

export interface GeopoliticalProvider {
  searchEvents(
    query: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderGeoEvent[]>;
}

export interface EconomicsProvider {
  getTreasuryRates(
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderTreasuryRate[]>;
  getEconomicIndicators(
    nameOrSeries?: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderEconomicIndicator[]>;
  getEconomicCalendar(
    options: Required<Pick<ProviderDateRangeOptions, "from" | "to">>,
  ): Promise<ProviderEconomicCalendarEvent[]>;
  getMarketRiskPremium(
    options?: Pick<ProviderDateRangeOptions, "from" | "to">,
  ): Promise<ProviderMarketRiskPremium[]>;
}