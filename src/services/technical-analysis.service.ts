import { TechnicalSnapshot, TrendDirection } from "@prisma/client";

import { listPriceSnapshotsByStockId } from "../repositories/price-snapshots.repository";
import { createTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { TechnicalAnalysisInput } from "../types/services";
import { ensureStockExists, getStockProfile } from "./stocks.service";

export interface MACDResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function calculateSMA(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) {
    return null;
  }

  const window = values.slice(values.length - period);
  const total = window.reduce((sum, value) => sum + value, 0);
  return total / period;
}

export function calculateEMA(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) {
    return null;
  }

  const smoothing = 2 / (period + 1);
  const seedWindow = values.slice(0, period);
  let ema = seedWindow.reduce((sum, value) => sum + value, 0) / period;

  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * smoothing + ema * (1 - smoothing);
  }

  return ema;
}

export function calculateRSI(closes: number[], period: number = 14): number | null {
  if (period <= 0 || closes.length < period + 1) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];

    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

/**
 * Computes MACD(12,26,9) for the provided closing prices.
 */
export function calculateMACD(closes: number[]): MACDResult {
  if (closes.length < 26) {
    return {
      macd: null,
      signal: null,
      histogram: null,
    };
  }

  const macdSeries: number[] = [];
  for (let index = 26; index <= closes.length; index += 1) {
    const window = closes.slice(0, index);
    const ema12 = calculateEMA(window, 12);
    const ema26 = calculateEMA(window, 26);

    if (ema12 != null && ema26 != null) {
      macdSeries.push(ema12 - ema26);
    }
  }

  const macd = macdSeries.at(-1) ?? null;
  const signal = macdSeries.length >= 9 ? calculateEMA(macdSeries, 9) : null;

  return {
    macd,
    signal,
    histogram: macd != null && signal != null ? macd - signal : null,
  };
}

/**
 * Classifies trend direction from current price and medium/long moving averages.
 */
export function classifyTrend(input: {
  currentPrice?: number | null;
  sma50?: number | null;
  sma200?: number | null;
}): TrendDirection | null {
  const currentPrice = input.currentPrice ?? null;
  const sma50 = input.sma50 ?? null;
  const sma200 = input.sma200 ?? null;

  if (currentPrice == null || sma50 == null || sma200 == null) {
    return null;
  }

  if (currentPrice > sma50 && currentPrice > sma200 && sma50 > sma200) {
    if (currentPrice > sma50 * 1.03 && sma50 > sma200 * 1.03) {
      return TrendDirection.STRONG_UPTREND;
    }

    return TrendDirection.UPTREND;
  }

  if (currentPrice < sma50 && currentPrice < sma200 && sma50 < sma200) {
    if (currentPrice < sma50 * 0.97 && sma50 < sma200 * 0.97) {
      return TrendDirection.STRONG_DOWNTREND;
    }

    return TrendDirection.DOWNTREND;
  }

  return TrendDirection.SIDEWAYS;
}

/**
 * Calculates a technical snapshot from historical price snapshots.
 */
export async function calculateTechnicalSnapshot(
  ticker: string,
): Promise<TechnicalAnalysisInput | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  const snapshots = await listPriceSnapshotsByStockId(stock.id, 300);
  if (snapshots.length === 0) {
    return null;
  }

  const orderedSnapshots = [...snapshots].sort(
    (left, right) => left.capturedAt.getTime() - right.capturedAt.getTime(),
  );

  const closes = orderedSnapshots.map((snapshot) => snapshot.close ?? snapshot.price);
  const latestSnapshot = orderedSnapshots[orderedSnapshots.length - 1];
  const currentPrice = latestSnapshot.close ?? latestSnapshot.price;

  const sma5 = calculateSMA(closes, 5);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);
  const rsi14 = calculateRSI(closes, 14);
  const macdResult = calculateMACD(closes);

  const volumes = orderedSnapshots
    .map((snapshot) => (snapshot.volume != null ? Number(snapshot.volume) : null))
    .filter((value): value is number => value != null);

  const volume30DayAverage = average(volumes.slice(Math.max(0, volumes.length - 30)));
  const latestVolume = latestSnapshot.volume != null ? Number(latestSnapshot.volume) : null;
  const volumeRelativeToAverage =
    latestVolume != null && volume30DayAverage != null && volume30DayAverage !== 0
      ? latestVolume / volume30DayAverage
      : null;

  const priceWindow = orderedSnapshots.slice(
    Math.max(0, orderedSnapshots.length - Math.min(252, orderedSnapshots.length)),
  );

  const highValues = priceWindow.map((snapshot) => snapshot.high ?? snapshot.price);
  const lowValues = priceWindow.map((snapshot) => snapshot.low ?? snapshot.price);

  const fiftyTwoWeekHigh =
    highValues.length > 0 ? Math.max(...highValues) : currentPrice;
  const fiftyTwoWeekLow = lowValues.length > 0 ? Math.min(...lowValues) : currentPrice;

  const distanceFrom52WeekHigh =
    fiftyTwoWeekHigh !== 0
      ? ((currentPrice - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100
      : null;
  const distanceFrom52WeekLow =
    fiftyTwoWeekLow !== 0 ? ((currentPrice - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 100 : null;

  return {
    sma5,
    sma20,
    sma50,
    sma200,
    rsi14,
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    volume30DayAverage,
    volumeRelativeToAverage,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    distanceFrom52WeekHigh,
    distanceFrom52WeekLow,
    trendDirection: classifyTrend({ currentPrice, sma50, sma200 }),
    capturedAt: new Date(),
  };
}

export async function recordTechnicalSnapshot(
  ticker: string,
  input: TechnicalAnalysisInput,
): Promise<TechnicalSnapshot> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  return createTechnicalSnapshot({
    stockId: stock.id,
    sma5: input.sma5 ?? null,
    sma20: input.sma20 ?? null,
    sma50: input.sma50 ?? null,
    sma200: input.sma200 ?? null,
    rsi14: input.rsi14 ?? null,
    macd: input.macd ?? null,
    macdSignal: input.macdSignal ?? null,
    macdHistogram: input.macdHistogram ?? null,
    volume30DayAverage: input.volume30DayAverage ?? null,
    volumeRelativeToAverage: input.volumeRelativeToAverage ?? null,
    fiftyTwoWeekHigh: input.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: input.fiftyTwoWeekLow ?? null,
    distanceFrom52WeekHigh: input.distanceFrom52WeekHigh ?? null,
    distanceFrom52WeekLow: input.distanceFrom52WeekLow ?? null,
    trendDirection: input.trendDirection ?? null,
    capturedAt: input.capturedAt ?? new Date(),
  });
}
