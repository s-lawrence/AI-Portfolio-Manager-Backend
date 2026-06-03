import { describe, expect, it } from "vitest";

import {
  calculateDailyChange,
  getHistoricalPrices,
  getLatestMarketSnapshot,
  recordPriceSnapshot,
} from "../../src/services/market-data.service";
import { getStockProfile } from "../../src/services/stocks.service";

let tickerSequence = 0;

function nextTicker(): string {
  tickerSequence += 1;
  return `TSTMKT${tickerSequence}`;
}

describe("market-data.service", () => {
  it("calculates daily change correctly", () => {
    expect(calculateDailyChange(110, 100)).toBeCloseTo(10);
    expect(calculateDailyChange(90, 100)).toBeCloseTo(-10);
    expect(calculateDailyChange(100, null)).toBeNull();
    expect(calculateDailyChange(100, 0)).toBeNull();
  });

  it("records a snapshot and creates the stock if missing", async () => {
    const ticker = nextTicker();

    const snapshot = await recordPriceSnapshot(ticker, {
      price: 110,
      previousClose: 100,
      volume: 123_000,
      capturedAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const stock = await getStockProfile(ticker);

    expect(stock).not.toBeNull();
    expect(snapshot.stockId).toBe(stock?.id);
    expect(snapshot.changePercent).toBeCloseTo(10);
  });

  it("uses current time when capturedAt is omitted", async () => {
    const ticker = nextTicker();

    const snapshot = await recordPriceSnapshot(ticker, {
      price: 101,
      previousClose: 100,
    });

    expect(snapshot.capturedAt).toBeInstanceOf(Date);
  });

  it("returns latest snapshot and historical prices in descending capturedAt order", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      price: 100,
      previousClose: 98,
      capturedAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    await recordPriceSnapshot(ticker, {
      price: 105,
      previousClose: 100,
      capturedAt: new Date("2026-02-02T00:00:00.000Z"),
    });

    await recordPriceSnapshot(ticker, {
      price: 108,
      previousClose: 105,
      capturedAt: new Date("2026-02-03T00:00:00.000Z"),
    });

    const latest = await getLatestMarketSnapshot(ticker);
    const historical = await getHistoricalPrices(ticker, 2);

    expect(latest?.price).toBe(108);
    expect(historical).toHaveLength(2);
    expect(historical[0]?.capturedAt.getTime()).toBeGreaterThan(
      historical[1]?.capturedAt.getTime() ?? 0,
    );
  });

  it("returns an empty list for unknown ticker history", async () => {
    const historical = await getHistoricalPrices("TSTMKT-UNKNOWN", 10);
    expect(historical).toEqual([]);
  });
});
