export interface FmpQuoteResponseItem {
  symbol?: string;
  name?: string;
  price?: number;
  changesPercentage?: number | string;
  change?: number;
  dayLow?: number;
  dayHigh?: number;
  marketCap?: number;
  volume?: number;
  open?: number;
  previousClose?: number;
  exchange?: string;
  timestamp?: number;
}

export interface FmpProfileResponseItem {
  symbol?: string;
  companyName?: string;
  exchange?: string;
  exchangeShortName?: string;
  sector?: string;
  industry?: string;
  country?: string;
  currency?: string;
  type?: string;
  assetType?: string;
  marketCap?: number;
  mktCap?: number;
  description?: string;
  website?: string;
  image?: string;
  analystRating?: string;
  consensus?: string;
  recommendation?: string;
}

export interface FmpHistoricalPriceItem {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjClose?: number;
  volume?: number;
}

export interface FmpHistoricalPriceFullResponse {
  symbol?: string;
  historical?: FmpHistoricalPriceItem[];
}

export interface FmpKeyMetricsItem {
  symbol?: string;
  date?: string;
  fiscalYear?: string | number;
  period?: string;
  reportedCurrency?: string;
  calendarYear?: string | number;
  marketCap?: number | null;
  enterpriseValue?: number | null;
  evToSales?: number | null;
  evToOperatingCashFlow?: number | null;
  evToFreeCashFlow?: number | null;
  evToEBITDA?: number | null;
  netDebtToEBITDA?: number | null;
  currentRatio?: number | null;
  returnOnAssets?: number | null;
  returnOnEquity?: number | null;
  returnOnInvestedCapital?: number | null;
  earningsYield?: number | null;
  freeCashFlowYield?: number | null;
  freeCashFlowToEquity?: number | null;
  freeCashFlowToFirm?: number | null;
  workingCapital?: number | null;

  // Legacy/non-stable aliases kept for defensive parsing.
  peRatio?: number | null;
  enterpriseValueOverEBITDA?: number | null;
  priceToSalesRatio?: number | null;
  pbRatio?: number | null;
  pfcfRatio?: number | null;
  debtToEquity?: number | null;
  dividendYield?: number | null;
  freeCashFlowPerShare?: number | null;
}

export interface FmpRatiosItem {
  symbol?: string;
  date?: string;
  fiscalYear?: string | number;
  period?: string;
  reportedCurrency?: string;
  calendarYear?: string | number;
  grossProfitMargin?: number | null;
  operatingProfitMargin?: number | null;
  netProfitMargin?: number | null;
  currentRatio?: number | null;
  priceToEarningsRatio?: number | null;
  priceToEarningsGrowthRatio?: number | null;
  forwardPriceToEarningsGrowthRatio?: number | null;
  priceToBookRatio?: number | null;
  priceToSalesRatio?: number | null;
  debtToEquityRatio?: number | null;
  dividendYield?: number | null;
  dividendYieldPercentage?: number | null;
  netIncomePerShare?: number | null;
  enterpriseValueMultiple?: number | null;

  // Legacy/non-stable aliases kept for defensive parsing.
  priceEarningsRatio?: number | null;
  debtEquityRatio?: number | null;
  returnOnEquity?: number | null;
  pegRatio?: number | null;
  forwardPERatio?: number | null;
}

export interface FmpFinancialGrowthItem {
  symbol?: string;
  date?: string;
  period?: string;
  calendarYear?: string | number;
  revenueGrowth?: number;
  epsgrowth?: number;
  freeCashFlowGrowth?: number;
}

export interface FmpIncomeStatementItem {
  symbol?: string;
  date?: string;
  period?: string;
  fiscalYear?: string | number;
  calendarYear?: string | number;
  reportedCurrency?: string;
  revenue?: number | null;
  eps?: number;
  weightedAverageShsOutDil?: number;
  netIncome?: number;
}

export interface FmpCashFlowStatementItem {
  symbol?: string;
  date?: string;
  period?: string;
  calendarYear?: string | number;
  freeCashFlow?: number;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
}

export interface FmpBalanceSheetStatementItem {
  symbol?: string;
  date?: string;
  period?: string;
  fiscalYear?: string | number;
  calendarYear?: string | number;
  reportedCurrency?: string;
  totalDebt?: number | null;
  totalStockholdersEquity?: number | null;
  totalShareholderEquity?: number | null;
}

export interface FmpEarningsReportItem {
  symbol?: string;
  date?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string | null;
}

export interface FmpStockNewsItem {
  symbol?: string;
  ticker?: string;
  title?: string;
  headline?: string;
  text?: string;
  content?: string;
  source?: string;
  site?: string;
  author?: string;
  url?: string;
  publishedDate?: string;
  publishedAt?: string;
  date?: string;
  sentiment?: string;
  sentimentScore?: number;
}

export interface FmpTreasuryRatesItem {
  date?: string;
  month1?: number | string;
  month2?: number | string;
  month3?: number | string;
  month6?: number | string;
  year1?: number | string;
  year2?: number | string;
  year3?: number | string;
  year5?: number | string;
  year7?: number | string;
  year10?: number | string;
  year20?: number | string;
  year30?: number | string;
  source?: string;
}

export interface FmpEconomicIndicatorItem {
  name?: string;
  indicator?: string;
  seriesId?: string;
  series?: string;
  country?: string;
  category?: string;
  value?: number | string;
  unit?: string;
  date?: string;
  source?: string;
}

export interface FmpEconomicCalendarItem {
  title?: string;
  event?: string;
  country?: string;
  category?: string;
  importance?: string;
  impact?: string;
  date?: string;
  eventDate?: string;
  actual?: number | string;
  estimate?: number | string;
  previous?: number | string;
  unit?: string;
  source?: string;
  url?: string;
}

export interface FmpMarketRiskPremiumItem {
  date?: string;
  country?: string;
  equityRiskPremium?: number | string;
  countryRiskPremium?: number | string;
  totalRiskPremium?: number | string;
  source?: string;
}