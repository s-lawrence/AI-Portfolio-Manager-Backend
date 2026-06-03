import { TrendDirection } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  classifyTrend,
} from "../../src/services/technical-analysis.service";

describe("technical-analysis.service", () => {
  it("calculates SMA and returns null for invalid windows", () => {
    expect(calculateSMA([1, 2], 3)).toBeNull();
    expect(calculateSMA([1, 2, 3, 4, 5], 3)).toBeCloseTo(4);
  });

  it("calculates EMA deterministically", () => {
    const ema = calculateEMA([1, 2, 3, 4, 5], 3);
    expect(ema).toBeCloseTo(4, 6);
  });

  it("calculates RSI and handles no-loss windows", () => {
    const closes = Array.from({ length: 15 }, (_, index) => index + 1);
    expect(calculateRSI(closes, 14)).toBe(100);
  });

  it("calculates MACD values when enough close prices exist", () => {
    const closes = Array.from({ length: 40 }, (_, index) => 100 + index * 0.5);
    const result = calculateMACD(closes);

    expect(result.macd).not.toBeNull();
    expect(result.signal).not.toBeNull();
    expect(result.histogram).not.toBeNull();
  });

  it("classifies bullish setups as uptrend variants", () => {
    const trend = classifyTrend({
      currentPrice: 120,
      sma50: 105,
      sma200: 95,
    });

    expect([TrendDirection.UPTREND, TrendDirection.STRONG_UPTREND]).toContain(trend);
  });

  it("classifies bearish setups as downtrend variants", () => {
    const trend = classifyTrend({
      currentPrice: 80,
      sma50: 95,
      sma200: 105,
    });

    expect([TrendDirection.DOWNTREND, TrendDirection.STRONG_DOWNTREND]).toContain(trend);
  });

  it("classifies mixed setups as sideways", () => {
    const trend = classifyTrend({
      currentPrice: 101,
      sma50: 99,
      sma200: 100,
    });

    expect(trend).toBe(TrendDirection.SIDEWAYS);
  });
});
