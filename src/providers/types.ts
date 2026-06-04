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
  fiscalDate?: Date;
  reportDate?: Date;
  reportTime?: string;
  estimatedEps?: number;
  actualEps?: number;
  estimatedRevenue?: number;
  actualRevenue?: number;
  surprisePercent?: number;
  isUpcoming?: boolean;
}

export interface ProviderNewsArticle {
  id?: string;
  ticker?: string;
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  publishedAt?: Date;
  sentiment?: "positive" | "negative" | "neutral" | "mixed" | string;
  sentimentScore?: number;
  relevanceScore?: number;
}

export interface ProviderMacroObservation {
  seriesId: string;
  date: Date;
  value?: number | null;
  unit?: string;
  frequency?: string;
  source?: string;
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

export interface GeopoliticalProvider {
  searchEvents(
    query: string,
    options?: ProviderDateRangeOptions,
  ): Promise<ProviderGeoEvent[]>;
}