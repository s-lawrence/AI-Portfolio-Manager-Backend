import { TrendDirection } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  calculateAnnualizedVolatility,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateTechnicalSnapshot,
  classifyTrend,
} from "../../src/services/technical-analysis.service";
import { recordPriceSnapshot } from "../../src/services/market-data.service";

describe("technical-analysis.service", () => {
  it("calculates SMA and returns null for invalid windows", () => {
    expect(calculateSMA([1, 2], 3)).toBeNull();
    expect(calculateSMA([1, 2, 3, 4, 5], 3)).toBeCloseTo(4);

    const closes = Array.from({ length: 250 }, (_, index) => 100 + index * 0.25);
    expect(calculateSMA(closes, 50)).not.toBeNull();
    expect(calculateSMA(closes, 200)).not.toBeNull();
  });

  it("calculates EMA deterministically", () => {
    const ema = calculateEMA([1, 2, 3, 4, 5], 3);
    expect(ema).toBeCloseTo(4, 6);
  });

  it("calculates RSI and handles no-loss windows", () => {
    const closes = Array.from({ length: 15 }, (_, index) => index + 1);
    expect(calculateRSI(closes, 14)).toBe(100);

    const longSeries = Array.from({ length: 250 }, (_, index) => {
      const wave = Math.sin(index / 6) * 2.5;
      return 100 + index * 0.12 + wave;
    });

    const rsi = calculateRSI(longSeries, 14);
    expect(rsi).not.toBeNull();
    expect(rsi ?? 0).toBeGreaterThanOrEqual(0);
    expect(rsi ?? 100).toBeLessThanOrEqual(100);
  });

  it("calculates annualized volatility with 30+ closes", () => {
    const closes = Array.from({ length: 60 }, (_, index) => {
      const oscillation = Math.sin(index / 4) * 1.8;
      return 100 + index * 0.08 + oscillation;
    });

    const volatility = calculateAnnualizedVolatility(closes, 30);
    expect(volatility).not.toBeNull();
    expect((volatility ?? 0) > 0).toBe(true);
    expect((volatility ?? 0) < 1).toBe(true);
  });

  it("returns realistic volatility range for AAPL-like prices", () => {
    const closes = Array.from({ length: 80 }, (_, index) => {
      const drift = index * 0.18;
      const oscillation = Math.sin(index / 5) * 2.4;
      return 195 + drift + oscillation;
    });

    const volatility = calculateAnnualizedVolatility(closes, 30);
    expect(volatility).not.toBeNull();
    expect((volatility ?? 0) > 0).toBe(true);
    expect((volatility ?? 1) < 0.6).toBe(true);
  });

  it("does not exhibit percent-scale inflation bugs", () => {
    const closes = Array.from({ length: 80 }, (_, index) => {
      const wave = Math.sin(index / 6) * 1.2;
      return 200 + index * 0.12 + wave;
    });

    const volatility = calculateAnnualizedVolatility(closes, 30);
    expect(volatility).not.toBeNull();
    expect((volatility ?? 999) < 2).toBe(true);
    expect(volatility).not.toBeCloseTo(8.74, 2);
  });

  it("filters anomalous split-like jumps that would otherwise inflate volatility", () => {
    const mostlyStable = Array.from({ length: 45 }, (_, index) => 200 + Math.sin(index / 5) * 1.4);
    const withOutliers = [...mostlyStable];

    withOutliers[20] = 20;
    withOutliers[21] = 205;

    const volatility = calculateAnnualizedVolatility(withOutliers, 30);
    expect(volatility).not.toBeNull();
    expect((volatility ?? 999) < 2).toBe(true);
  });

  it("returns null when there is insufficient close history", () => {
    const closes = Array.from({ length: 20 }, (_, index) => 100 + index * 0.2);
    expect(calculateAnnualizedVolatility(closes, 30)).toBeNull();
  });

  it("ignores invalid closes and returns null when valid history is insufficient", () => {
    const closes = [
      ...Array.from({ length: 25 }, (_, index) => 100 + index * 0.1),
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined as unknown as number,
    ];

    expect(calculateAnnualizedVolatility(closes, 30)).toBeNull();
  });

  it("supports caller-sorted close series for unsorted timestamped input", () => {
    const unsorted = [
      { capturedAt: new Date("2026-05-05T00:00:00.000Z"), close: 205 },
      { capturedAt: new Date("2026-05-01T00:00:00.000Z"), close: 200 },
      { capturedAt: new Date("2026-05-03T00:00:00.000Z"), close: 202 },
      { capturedAt: new Date("2026-05-02T00:00:00.000Z"), close: 201 },
      { capturedAt: new Date("2026-05-04T00:00:00.000Z"), close: 204 },
      ...Array.from({ length: 40 }, (_, index) => ({
        capturedAt: new Date(Date.UTC(2026, 4, 6 + index)),
        close: 205 + index * 0.15 + Math.sin(index / 4),
      })),
    ];

    const sortedCloses = [...unsorted]
      .sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime())
      .map((item) => item.close);

    const volatility = calculateAnnualizedVolatility(sortedCloses, 30);
    expect(volatility).not.toBeNull();
    expect((volatility ?? 999) < 2).toBe(true);
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

  it("deduplicates same-day rows and prefers FMP historical rows for technical inputs", async () => {
    const ticker = `TSTTECH${Date.now().toString().slice(-5)}`;

    for (let index = 0; index < 25; index += 1) {
      const day = new Date(Date.UTC(2026, 2, 1 + index, 0, 0, 0, 0));
      const fmpClose = 300 + index;
      const demoClose = 120 + index;

      await recordPriceSnapshot(ticker, {
        source: "FMP_HISTORICAL",
        price: fmpClose,
        close: fmpClose,
        high: fmpClose + 1,
        low: fmpClose - 1,
        capturedAt: day,
      });

      await recordPriceSnapshot(ticker, {
        source: "DEMO",
        price: demoClose,
        close: demoClose,
        high: demoClose + 1,
        low: demoClose - 1,
        capturedAt: new Date(Date.UTC(2026, 2, 1 + index, 20, 0, 0, 0)),
      });
    }

    const technical = await calculateTechnicalSnapshot(ticker);

    expect(technical).not.toBeNull();
    expect(technical?.sma20).not.toBeNull();
    expect((technical?.sma20 ?? 0) > 310).toBe(true);
    expect((technical?.fiftyTwoWeekLow ?? 0) > 250).toBe(true);
  });
});
