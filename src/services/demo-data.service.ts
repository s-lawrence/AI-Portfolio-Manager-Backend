import { Prisma, Sentiment } from "@prisma/client";

import { listFundamentalSnapshotsByStockId } from "../repositories/fundamental-snapshots.repository";
import { listPortfoliosByUserId } from "../repositories/portfolios.repository";
import { getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import { listPriceSnapshotsByStockId } from "../repositories/price-snapshots.repository";
import { listPriceSnapshotsByStockIdByCreatedAt } from "../repositories/price-snapshots.repository";
import { listTechnicalSnapshotsByStockId } from "../repositories/technical-snapshots.repository";
import { getUserByEmail } from "../repositories/users.repository";
import { prisma } from "../db/prisma";
import { normalizeTickerOrThrow } from "../types/common";
import {
  PurgeDemoAnalyticalDataOptions,
  PurgeDemoAnalyticalDataResult,
  SeedDemoMarketDataOptions,
  SeedDemoMarketDataResult,
} from "../types/services";
import {
  calculateTechnicalSnapshot,
  recordTechnicalSnapshot,
} from "./technical-analysis.service";
import {
  getPortfolioOverview,
} from "./portfolios.service";
import { recordPriceSnapshot } from "./market-data.service";
import { recordFundamentalSnapshot } from "./fundamentals.service";
import {
  getRecentNewsForTicker,
  recordNewsArticles,
} from "./news.service";
import {
  getNextEarningsForTicker,
  recordEarningsEvent,
  updateEarningsEvent,
} from "./earnings.service";
import { runPortfolioAnalysis } from "./portfolio-analysis.service";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PORTFOLIO_NAME = "Demo Portfolio";
const PRICE_SNAPSHOT_DAYS = 60;

type FundamentalSeedValues = {
  marketCap: bigint;
  peRatio: number;
  forwardPeRatio: number;
  pegRatio: number;
  priceToSales: number;
  priceToBook: number;
  evToEbitda: number;
  eps: number;
  revenueGrowth: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  debtToEquity: number;
  currentRatio: number;
  freeCashFlow: bigint;
  dividendYield: number;
};

type TickerSeedProfile = {
  priceMin: number;
  priceMax: number;
  anchorPrice: number;
  trendPerDay: number;
  volatility: number;
  baseVolume: number;
  sharesOutstanding: number;
  fundamentals: FundamentalSeedValues;
  earningsLeadDays: number;
  earningsTime: string;
  estimatedEps: number;
  estimatedRevenue: bigint;
};

type GeneratedPricePoint = {
  capturedAt: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  volume: number;
  marketCap: number;
  changePercent: number;
};

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function seededUnit(seed: number, step: number, salt: number): number {
  const raw = Math.sin(seed * 0.001 + step * 12.9898 + salt * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      20,
      0,
      0,
      0,
    ),
  );
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function safeScaleBigInt(value: bigint, factor: number): bigint {
  return BigInt(Math.round(Number(value) * factor));
}

function buildFundamentalsForTicker(ticker: string): FundamentalSeedValues {
  if (ticker === "AAPL") {
    return {
      marketCap: 3_320_000_000_000n,
      peRatio: 31.4,
      forwardPeRatio: 29.1,
      pegRatio: 2.4,
      priceToSales: 8.4,
      priceToBook: 46.3,
      evToEbitda: 24.8,
      eps: 6.41,
      revenueGrowth: 0.054,
      grossMargin: 0.462,
      operatingMargin: 0.306,
      netMargin: 0.252,
      debtToEquity: 1.57,
      currentRatio: 1.08,
      freeCashFlow: 103_000_000_000n,
      dividendYield: 0.0051,
    };
  }

  if (ticker === "MSFT") {
    return {
      marketCap: 3_480_000_000_000n,
      peRatio: 37.2,
      forwardPeRatio: 33.8,
      pegRatio: 2.1,
      priceToSales: 14.1,
      priceToBook: 12.4,
      evToEbitda: 26.9,
      eps: 12.77,
      revenueGrowth: 0.142,
      grossMargin: 0.691,
      operatingMargin: 0.448,
      netMargin: 0.359,
      debtToEquity: 0.44,
      currentRatio: 1.82,
      freeCashFlow: 82_000_000_000n,
      dividendYield: 0.0071,
    };
  }

  if (ticker === "NVDA") {
    return {
      marketCap: 3_050_000_000_000n,
      peRatio: 59.6,
      forwardPeRatio: 38.9,
      pegRatio: 1.6,
      priceToSales: 35.7,
      priceToBook: 47.8,
      evToEbitda: 44.2,
      eps: 2.79,
      revenueGrowth: 0.656,
      grossMargin: 0.747,
      operatingMargin: 0.583,
      netMargin: 0.534,
      debtToEquity: 0.31,
      currentRatio: 3.25,
      freeCashFlow: 67_000_000_000n,
      dividendYield: 0.0004,
    };
  }

  const seed = hashString(ticker);
  const marketCap = BigInt(120_000_000_000 + (seed % 600) * 1_000_000_000);
  const freeCashFlow = BigInt(3_000_000_000 + (seed % 60) * 200_000_000);

  return {
    marketCap,
    peRatio: 18 + (seed % 120) / 10,
    forwardPeRatio: 16 + (seed % 90) / 10,
    pegRatio: 1 + (seed % 40) / 20,
    priceToSales: 2 + (seed % 70) / 10,
    priceToBook: 2 + (seed % 90) / 10,
    evToEbitda: 8 + (seed % 120) / 10,
    eps: 2 + (seed % 60) / 10,
    revenueGrowth: ((seed % 180) - 40) / 1000,
    grossMargin: 0.25 + (seed % 350) / 1000,
    operatingMargin: 0.08 + (seed % 240) / 1000,
    netMargin: 0.05 + (seed % 220) / 1000,
    debtToEquity: 0.2 + (seed % 220) / 100,
    currentRatio: 1 + (seed % 200) / 100,
    freeCashFlow,
    dividendYield: (seed % 30) / 1000,
  };
}

function buildTickerSeedProfile(ticker: string): TickerSeedProfile {
  const fundamentals = buildFundamentalsForTicker(ticker);

  if (ticker === "AAPL") {
    return {
      priceMin: 190,
      priceMax: 230,
      anchorPrice: 205,
      trendPerDay: 0.18,
      volatility: 2.4,
      baseVolume: 54_000_000,
      sharesOutstanding: 15_400_000_000,
      fundamentals,
      earningsLeadDays: 21,
      earningsTime: "after-close",
      estimatedEps: 1.56,
      estimatedRevenue: 89_000_000_000n,
    };
  }

  if (ticker === "MSFT") {
    return {
      priceMin: 400,
      priceMax: 470,
      anchorPrice: 430,
      trendPerDay: 0.31,
      volatility: 3.3,
      baseVolume: 26_000_000,
      sharesOutstanding: 7_430_000_000,
      fundamentals,
      earningsLeadDays: 28,
      earningsTime: "after-close",
      estimatedEps: 3.29,
      estimatedRevenue: 67_000_000_000n,
    };
  }

  if (ticker === "NVDA") {
    return {
      priceMin: 100,
      priceMax: 160,
      anchorPrice: 128,
      trendPerDay: 0.44,
      volatility: 4.7,
      baseVolume: 63_000_000,
      sharesOutstanding: 24_600_000_000,
      fundamentals,
      earningsLeadDays: 35,
      earningsTime: "after-close",
      estimatedEps: 0.72,
      estimatedRevenue: 41_000_000_000n,
    };
  }

  const seed = hashString(ticker);

  return {
    priceMin: 60,
    priceMax: 220,
    anchorPrice: 90 + (seed % 70),
    trendPerDay: ((seed % 9) - 4) * 0.07,
    volatility: 2 + (seed % 30) / 10,
    baseVolume: 9_000_000 + (seed % 30) * 350_000,
    sharesOutstanding: 1_500_000_000 + (seed % 400) * 5_000_000,
    fundamentals,
    earningsLeadDays: 14 + (seed % 28),
    earningsTime: "after-close",
    estimatedEps: roundTo(0.5 + (seed % 160) / 100, 2),
    estimatedRevenue: BigInt(4_000_000_000 + (seed % 80) * 250_000_000),
  };
}

function buildDemoNewsArticles(ticker: string, now: Date) {
  const baseDate = toUtcDay(now);

  return [
    {
      headline: `[DEMO] ${ticker}: Local channel checks suggest stable demand into next quarter`,
      source: "Demo News (Local Fake Data)",
      url: `https://demo.local/news/${ticker.toLowerCase()}/demand-checks-q2`,
      publishedAt: addDays(baseDate, -2),
      summary:
        "This is synthetic local demo data for development. Internal scenario assumes demand remains resilient across key product lines.",
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.63,
      materialityScore: 0.71,
      relevanceExplanation:
        "Marked as demo-only content; used to exercise sentiment aggregation and report generation paths.",
    },
    {
      headline: `[DEMO] ${ticker}: Margin outlook mixed as cost controls improve but supply risk remains`,
      source: "Demo News (Local Fake Data)",
      url: `https://demo.local/news/${ticker.toLowerCase()}/margin-outlook-mixed`,
      publishedAt: addDays(baseDate, -6),
      summary:
        "This is synthetic local demo data for development. The scenario includes efficiency gains alongside selective input-cost pressure.",
      sentiment: Sentiment.MIXED,
      sentimentScore: 0.08,
      materialityScore: 0.66,
      relevanceExplanation:
        "Demo article balances bullish and bearish factors to produce realistic mixed sentiment behavior.",
    },
    {
      headline: `[DEMO] ${ticker}: Product roadmap refresh could support medium-term upside`,
      source: "Demo News (Local Fake Data)",
      url: `https://demo.local/news/${ticker.toLowerCase()}/roadmap-refresh-upside`,
      publishedAt: addDays(baseDate, -10),
      summary:
        "This is synthetic local demo data for development. Scenario assumes roadmap execution improves pricing power and customer retention.",
      sentiment: Sentiment.BULLISH,
      sentimentScore: 0.57,
      materialityScore: 0.62,
      relevanceExplanation:
        "Demo-only catalyst narrative to test bullish recommendation influences.",
    },
    {
      headline: `[DEMO] ${ticker}: Regulatory overhang remains a headline risk in near term`,
      source: "Demo News (Local Fake Data)",
      url: `https://demo.local/news/${ticker.toLowerCase()}/regulatory-overhang-risk`,
      publishedAt: addDays(baseDate, -13),
      summary:
        "This is synthetic local demo data for development. Scenario includes moderate policy uncertainty affecting short-term valuation multiples.",
      sentiment: Sentiment.BEARISH,
      sentimentScore: -0.46,
      materialityScore: 0.58,
      relevanceExplanation:
        "Demo risk narrative provides negative sentiment coverage for balanced test data.",
    },
  ];
}

function generatePriceSeriesForTicker(
  ticker: string,
  profile: TickerSeedProfile,
  now: Date,
): GeneratedPricePoint[] {
  const seed = hashString(ticker);
  const latestDay = toUtcDay(now);
  const firstDay = addDays(latestDay, -(PRICE_SNAPSHOT_DAYS - 1));

  const points: GeneratedPricePoint[] = [];
  let previousClose = clamp(profile.anchorPrice * 0.996, profile.priceMin, profile.priceMax);

  for (let dayIndex = 0; dayIndex < PRICE_SNAPSHOT_DAYS; dayIndex += 1) {
    const capturedAt = addDays(firstDay, dayIndex);
    const trend = profile.trendPerDay * dayIndex;
    const seasonal = Math.sin((dayIndex + (seed % 13)) / 5) * profile.volatility;
    const noise = (seededUnit(seed, dayIndex, 1) - 0.5) * profile.volatility;

    const close = clamp(
      roundTo(profile.anchorPrice + trend + seasonal + noise, 2),
      profile.priceMin,
      profile.priceMax,
    );

    const openDrift = (seededUnit(seed, dayIndex, 2) - 0.5) * profile.volatility * 0.45;
    const open = clamp(roundTo(previousClose + openDrift, 2), profile.priceMin, profile.priceMax);

    const intradayRangeRatio =
      0.004 + seededUnit(seed, dayIndex, 3) * 0.018 + Math.abs(close - open) / 400;

    const high = roundTo(Math.max(open, close) * (1 + intradayRangeRatio), 2);
    const low = roundTo(Math.min(open, close) * (1 - intradayRangeRatio), 2);

    const volumeFactor =
      1 + Math.sin((dayIndex + (seed % 11)) / 7) * 0.2 + (seededUnit(seed, dayIndex, 4) - 0.5) * 0.18;
    const volume = Math.max(100_000, Math.round(profile.baseVolume * volumeFactor));

    const marketCap = Math.round(close * profile.sharesOutstanding);
    const changePercent =
      previousClose === 0 ? 0 : roundTo(((close - previousClose) / previousClose) * 100, 4);

    points.push({
      capturedAt,
      open,
      high,
      low,
      close,
      previousClose: roundTo(previousClose, 2),
      volume,
      marketCap,
      changePercent,
    });

    previousClose = close;
  }

  return points;
}

function buildQuarterString(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${quarter}`;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /unique|duplicate/i.test(error.message);
}

async function seedPriceSnapshotsForTicker(
  stockId: string,
  ticker: string,
  now: Date,
): Promise<{ created: number; latestCapturedAt: Date }> {
  const profile = buildTickerSeedProfile(ticker);
  const series = generatePriceSeriesForTicker(ticker, profile, now);
  const existingSnapshots = await listPriceSnapshotsByStockId(stockId, 500);
  const existingCapturedAtSet = new Set(
    existingSnapshots.map((snapshot) => snapshot.capturedAt.toISOString()),
  );

  let created = 0;

  for (const point of series) {
    const capturedAtIso = point.capturedAt.toISOString();
    if (existingCapturedAtSet.has(capturedAtIso)) {
      continue;
    }

    try {
      await recordPriceSnapshot(ticker, {
        source: "DEMO",
        price: point.close,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        previousClose: point.previousClose,
        volume: point.volume,
        marketCap: point.marketCap,
        changePercent: point.changePercent,
        capturedAt: point.capturedAt,
      });
      created += 1;
      existingCapturedAtSet.add(capturedAtIso);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  return {
    created,
    latestCapturedAt: series[series.length - 1].capturedAt,
  };
}

async function seedTechnicalSnapshotForTicker(
  stockId: string,
  ticker: string,
  latestCapturedAt: Date,
): Promise<number> {
  const technicalInput = await calculateTechnicalSnapshot(ticker);

  if (!technicalInput) {
    return 0;
  }

  const existing = await listTechnicalSnapshotsByStockId(stockId, 200);
  const existingSet = new Set(existing.map((snapshot) => snapshot.capturedAt.toISOString()));

  if (existingSet.has(latestCapturedAt.toISOString())) {
    return 0;
  }

  try {
    await recordTechnicalSnapshot(ticker, {
      ...technicalInput,
      capturedAt: latestCapturedAt,
    });
    return 1;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return 0;
    }

    throw error;
  }
}

async function seedFundamentalsForTicker(
  stockId: string,
  ticker: string,
  latestCapturedAt: Date,
): Promise<number> {
  const profile = buildTickerSeedProfile(ticker);
  const currentCapturedAt = latestCapturedAt;
  const previousCapturedAt = addDays(currentCapturedAt, -30);

  const existing = await listFundamentalSnapshotsByStockId(stockId, 200);
  const existingSet = new Set(existing.map((snapshot) => snapshot.capturedAt.toISOString()));

  const current = profile.fundamentals;
  const previous: FundamentalSeedValues = {
    marketCap: safeScaleBigInt(current.marketCap, 0.94),
    peRatio: roundTo(current.peRatio * 1.06, 2),
    forwardPeRatio: roundTo(current.forwardPeRatio * 1.05, 2),
    pegRatio: roundTo(current.pegRatio * 1.03, 2),
    priceToSales: roundTo(current.priceToSales * 0.97, 2),
    priceToBook: roundTo(current.priceToBook * 0.95, 2),
    evToEbitda: roundTo(current.evToEbitda * 0.96, 2),
    eps: roundTo(current.eps * 0.9, 2),
    revenueGrowth: roundTo(current.revenueGrowth - 0.018, 4),
    grossMargin: roundTo(current.grossMargin - 0.012, 4),
    operatingMargin: roundTo(current.operatingMargin - 0.01, 4),
    netMargin: roundTo(current.netMargin - 0.009, 4),
    debtToEquity: roundTo(current.debtToEquity + 0.08, 3),
    currentRatio: roundTo(current.currentRatio - 0.05, 3),
    freeCashFlow: safeScaleBigInt(current.freeCashFlow, 0.9),
    dividendYield: roundTo(current.dividendYield, 4),
  };

  let created = 0;

  const snapshots = [
    {
      capturedAt: previousCapturedAt,
      values: previous,
    },
    {
      capturedAt: currentCapturedAt,
      values: current,
    },
  ];

  for (const snapshot of snapshots) {
    const capturedAtIso = snapshot.capturedAt.toISOString();
    if (existingSet.has(capturedAtIso)) {
      continue;
    }

    try {
      await recordFundamentalSnapshot(ticker, {
        capturedAt: snapshot.capturedAt,
        ...snapshot.values,
        source: "Demo Fundamentals (Local Fake Data)",
      });
      created += 1;
      existingSet.add(capturedAtIso);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  return created;
}

async function seedNewsForTicker(ticker: string, now: Date): Promise<number> {
  const existingArticles = await getRecentNewsForTicker(ticker, 500);
  const existingUrls = new Set(existingArticles.map((article) => article.url));

  const demoArticles = buildDemoNewsArticles(ticker, now);
  await recordNewsArticles(ticker, demoArticles);

  let created = 0;
  for (const article of demoArticles) {
    if (!existingUrls.has(article.url)) {
      created += 1;
    }
  }

  return created;
}

async function seedEarningsForTicker(
  ticker: string,
  latestCapturedAt: Date,
): Promise<number> {
  const profile = buildTickerSeedProfile(ticker);
  const earningsDate = addDays(latestCapturedAt, profile.earningsLeadDays);
  const fiscalYear = earningsDate.getUTCFullYear();
  const fiscalQuarter = buildQuarterString(earningsDate);

  const existingUpcoming = await getNextEarningsForTicker(ticker);

  if (existingUpcoming) {
    await updateEarningsEvent(existingUpcoming.id, {
      fiscalQuarter,
      fiscalYear,
      earningsDate,
      earningsTime: profile.earningsTime,
      isDateConfirmed: false,
      estimatedEps: profile.estimatedEps,
      estimatedRevenue: profile.estimatedRevenue,
      guidanceSummary: "[DEMO] Local fake earnings event for development only.",
      earningsCallUrl: `https://demo.local/earnings/${ticker.toLowerCase()}/call`,
      transcriptUrl: `https://demo.local/earnings/${ticker.toLowerCase()}/transcript`,
    });

    return 0;
  }

  await recordEarningsEvent(ticker, {
    fiscalQuarter,
    fiscalYear,
    earningsDate,
    earningsTime: profile.earningsTime,
    isDateConfirmed: false,
    estimatedEps: profile.estimatedEps,
    estimatedRevenue: profile.estimatedRevenue,
    guidanceSummary: "[DEMO] Local fake earnings event for development only.",
    earningsCallUrl: `https://demo.local/earnings/${ticker.toLowerCase()}/call`,
    transcriptUrl: `https://demo.local/earnings/${ticker.toLowerCase()}/transcript`,
  });

  return 1;
}

export async function seedDemoMarketData(
  options: SeedDemoMarketDataOptions = {},
): Promise<SeedDemoMarketDataResult> {
  const runAnalysis = options.runAnalysis ?? false;

  const demoUser = await getUserByEmail(DEMO_EMAIL);
  if (!demoUser) {
    throw new Error(
      "Demo user not found. Run `npm run prisma:seed` to create local demo context.",
    );
  }

  const portfolios = await listPortfoliosByUserId(demoUser.id);
  const demoPortfolio = portfolios.find(
    (portfolio) => portfolio.name === DEMO_PORTFOLIO_NAME,
  );

  if (!demoPortfolio) {
    throw new Error(
      "Demo Portfolio not found for demo@example.com. Run `npm run prisma:seed`.",
    );
  }

  const overview = await getPortfolioOverview(demoPortfolio.id);
  if (!overview) {
    throw new Error("Demo portfolio could not be loaded.");
  }

  if (overview.holdings.length === 0) {
    throw new Error("Demo portfolio has no holdings to seed.");
  }

  let priceSnapshotsCreated = 0;
  let technicalSnapshotsCreated = 0;
  let fundamentalSnapshotsCreated = 0;
  let newsArticlesCreated = 0;
  let earningsEventsCreated = 0;

  const now = new Date();
  const tickersSeeded: string[] = [];

  for (const holding of overview.holdings) {
    const ticker = assertNonBlank(holding.stock.ticker, "ticker").toUpperCase();

    if (!tickersSeeded.includes(ticker)) {
      tickersSeeded.push(ticker);
    }

    const prices = await seedPriceSnapshotsForTicker(holding.stockId, ticker, now);
    priceSnapshotsCreated += prices.created;

    technicalSnapshotsCreated += await seedTechnicalSnapshotForTicker(
      holding.stockId,
      ticker,
      prices.latestCapturedAt,
    );

    fundamentalSnapshotsCreated += await seedFundamentalsForTicker(
      holding.stockId,
      ticker,
      prices.latestCapturedAt,
    );

    newsArticlesCreated += await seedNewsForTicker(ticker, now);
    earningsEventsCreated += await seedEarningsForTicker(ticker, prices.latestCapturedAt);
  }

  const result: SeedDemoMarketDataResult = {
    demoPortfolioId: demoPortfolio.id,
    tickersSeeded,
    priceSnapshotsCreated,
    technicalSnapshotsCreated,
    fundamentalSnapshotsCreated,
    newsArticlesCreated,
    earningsEventsCreated,
  };

  if (runAnalysis) {
    result.analysis = await runPortfolioAnalysis(demoPortfolio.id);
  }

  return result;
}

function buildScopedWhere<T extends object>(
  base: T,
  affectedStockIds: string[],
): T & { stockId?: { in: string[] } } {
  if (affectedStockIds.length === 0) {
    return base as T & { stockId?: { in: string[] } };
  }

  return {
    ...base,
    stockId: {
      in: affectedStockIds,
    },
  };
}

export async function purgeDemoAnalyticalData(
  options: PurgeDemoAnalyticalDataOptions = {},
): Promise<PurgeDemoAnalyticalDataResult> {
  const warnings: string[] = [];
  const isScopedRequest = Boolean(options.ticker || options.portfolioId);

  let scopedStockIds: string[] = [];
  const scopedPortfolioIds = new Set<string>();

  if (options.ticker) {
    const ticker = normalizeTickerOrThrow(options.ticker);
    const stock = await prisma.stock.findUnique({
      where: { ticker },
      select: { id: true },
    });

    if (!stock) {
      warnings.push(`No stock found for ticker ${ticker}. Nothing was purged for ticker scope.`);
    } else {
      scopedStockIds.push(stock.id);
    }
  }

  if (options.portfolioId) {
    const portfolio = await getPortfolioWithHoldings(options.portfolioId);
    if (!portfolio) {
      throw new Error("Portfolio not found.");
    }

    scopedPortfolioIds.add(portfolio.id);
    scopedStockIds.push(...portfolio.holdings.map((holding) => holding.stockId));
  }

  scopedStockIds = [...new Set(scopedStockIds)];

  if (isScopedRequest && scopedStockIds.length === 0) {
    warnings.push("No matching stocks were found for the provided scope. Nothing was purged.");

    return {
      scope: {
        ticker: options.ticker ? normalizeTickerOrThrow(options.ticker) : undefined,
        portfolioId: options.portfolioId,
        affectedStockIds: [],
        affectedPortfolioIds: [],
      },
      priceSnapshotsDeleted: 0,
      fundamentalSnapshotsDeleted: 0,
      earningsEventsDeleted: 0,
      newsArticlesDeleted: 0,
      aiReportsDeleted: 0,
      predictionsDeleted: 0,
      portfolioSummariesDeleted: 0,
      alertsDeleted: 0,
      warnings,
    };
  }

  if (!options.ticker && !options.portfolioId) {
    const allStockIds = await prisma.stock.findMany({ select: { id: true } });
    scopedStockIds = allStockIds.map((stock) => stock.id);
  }

  if (!options.portfolioId) {
    const portfolioLinks = await prisma.holding.findMany({
      where: scopedStockIds.length > 0
        ? {
            stockId: {
              in: scopedStockIds,
            },
          }
        : undefined,
      select: {
        portfolioId: true,
      },
      distinct: ["portfolioId"],
    });

    for (const link of portfolioLinks) {
      scopedPortfolioIds.add(link.portfolioId);
    }
  }

  const [reportIds, predictionIds] = await Promise.all([
    prisma.aIReport.findMany({
      where: scopedStockIds.length > 0
        ? {
            stockId: {
              in: scopedStockIds,
            },
          }
        : undefined,
      select: { id: true },
    }),
    prisma.prediction.findMany({
      where: scopedStockIds.length > 0
        ? {
            stockId: {
              in: scopedStockIds,
            },
          }
        : undefined,
      select: { id: true },
    }),
  ]);

  const reportIdList = reportIds.map((item) => item.id);
  const predictionIdList = predictionIds.map((item) => item.id);

  const alertsDeletedLinked = await prisma.alert.deleteMany({
    where: {
      OR: [
        {
          sourceType: "AI_REPORT",
          sourceId: {
            in: reportIdList.length > 0 ? reportIdList : ["__none__"],
          },
        },
        {
          sourceType: "PREDICTION",
          sourceId: {
            in: predictionIdList.length > 0 ? predictionIdList : ["__none__"],
          },
        },
      ],
    },
  });

  const deletedPredictionOutcomes = await prisma.predictionOutcome.deleteMany({
    where: {
      predictionId: {
        in: predictionIdList,
      },
    },
  });

  const predictionsDeleted = await prisma.prediction.deleteMany({
    where: scopedStockIds.length > 0
      ? {
          stockId: {
            in: scopedStockIds,
          },
        }
      : undefined,
  });

  const aiReportsDeleted = await prisma.aIReport.deleteMany({
    where: scopedStockIds.length > 0
      ? {
          stockId: {
            in: scopedStockIds,
          },
        }
      : undefined,
  });

  const portfolioSummariesDeleted = await prisma.portfolioSummary.deleteMany({
    where: scopedPortfolioIds.size > 0
      ? {
          portfolioId: {
            in: [...scopedPortfolioIds],
          },
        }
      : undefined,
  });

  const priceSnapshotsDeleted = await prisma.priceSnapshot.deleteMany({
    where: buildScopedWhere(
      {
        source: "DEMO",
      },
      scopedStockIds,
    ),
  });

  let legacyPriceSnapshotsDeleted = 0;
  if (options.allowLegacyDemoPurge) {
    const legacyIds: string[] = [];

    for (const stockId of scopedStockIds) {
      const snapshots = await listPriceSnapshotsByStockIdByCreatedAt(stockId, 2000);
      const fmpRowsByDay = new Set(
        snapshots
          .filter((snapshot) => snapshot.source === "FMP_HISTORICAL")
          .map((snapshot) => snapshot.capturedAt.toISOString().slice(0, 10)),
      );

      for (const snapshot of snapshots) {
        if (snapshot.source !== null) {
          continue;
        }

        const dayKey = snapshot.capturedAt.toISOString().slice(0, 10);
        if (fmpRowsByDay.has(dayKey)) {
          legacyIds.push(snapshot.id);
        }
      }
    }

    if (legacyIds.length > 0) {
      const deletedLegacy = await prisma.priceSnapshot.deleteMany({
        where: {
          id: {
            in: legacyIds,
          },
        },
      });

      legacyPriceSnapshotsDeleted = deletedLegacy.count;
    }
  } else {
    warnings.push(
      "Legacy null-source price snapshots were not purged. Re-run with allowLegacyDemoPurge=true for time-pattern based cleanup.",
    );
  }

  const fundamentalSnapshotsDeleted = await prisma.fundamentalSnapshot.deleteMany({
    where: buildScopedWhere(
      {
        OR: [
          {
            source: {
              contains: "demo",
              mode: "insensitive" as const,
            },
          },
          {
            source: {
              contains: "local fake data",
              mode: "insensitive" as const,
            },
          },
        ],
      },
      scopedStockIds,
    ),
  });

  const newsArticlesDeleted = await prisma.newsArticle.deleteMany({
    where: buildScopedWhere(
      {
        OR: [
          {
            source: {
              contains: "demo",
              mode: "insensitive" as const,
            },
          },
          {
            url: {
              startsWith: "https://demo.local/",
            },
          },
          {
            headline: {
              startsWith: "[DEMO]",
            },
          },
        ],
      },
      scopedStockIds,
    ),
  });

  const earningsEventsDeleted = await prisma.earningsEvent.deleteMany({
    where: buildScopedWhere(
      {
        OR: [
          {
            guidanceSummary: {
              contains: "demo",
              mode: "insensitive" as const,
            },
          },
          {
            guidanceSummary: {
              contains: "local fake data",
              mode: "insensitive" as const,
            },
          },
          {
            earningsCallUrl: {
              startsWith: "https://demo.local/",
            },
          },
          {
            transcriptUrl: {
              startsWith: "https://demo.local/",
            },
          },
        ],
      },
      scopedStockIds,
    ),
  });

  if (deletedPredictionOutcomes.count > 0) {
    warnings.push(
      `Deleted ${deletedPredictionOutcomes.count} prediction outcome row(s) linked to purged predictions.`,
    );
  }

  return {
    scope: {
      ticker: options.ticker ? normalizeTickerOrThrow(options.ticker) : undefined,
      portfolioId: options.portfolioId,
      affectedStockIds: scopedStockIds,
      affectedPortfolioIds: [...scopedPortfolioIds],
    },
    priceSnapshotsDeleted: priceSnapshotsDeleted.count + legacyPriceSnapshotsDeleted,
    fundamentalSnapshotsDeleted: fundamentalSnapshotsDeleted.count,
    earningsEventsDeleted: earningsEventsDeleted.count,
    newsArticlesDeleted: newsArticlesDeleted.count,
    aiReportsDeleted: aiReportsDeleted.count,
    predictionsDeleted: predictionsDeleted.count,
    portfolioSummariesDeleted: portfolioSummariesDeleted.count,
    alertsDeleted: alertsDeletedLinked.count,
    warnings,
  };
}
