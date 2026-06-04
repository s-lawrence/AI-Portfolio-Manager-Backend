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
  period?: string;
  calendarYear?: string | number;
  marketCap?: number;
  peRatio?: number;
  enterpriseValueOverEBITDA?: number;
  priceToSalesRatio?: number;
  pbRatio?: number;
  pfcfRatio?: number;
  debtToEquity?: number;
  currentRatio?: number;
  dividendYield?: number;
  freeCashFlowPerShare?: number;
}

export interface FmpRatiosItem {
  symbol?: string;
  date?: string;
  period?: string;
  calendarYear?: string | number;
  priceEarningsRatio?: number;
  priceToBookRatio?: number;
  priceToSalesRatio?: number;
  debtEquityRatio?: number;
  currentRatio?: number;
  grossProfitMargin?: number;
  operatingProfitMargin?: number;
  netProfitMargin?: number;
  returnOnEquity?: number;
  dividendYield?: number;
  pegRatio?: number;
  forwardPERatio?: number;
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
  calendarYear?: string | number;
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