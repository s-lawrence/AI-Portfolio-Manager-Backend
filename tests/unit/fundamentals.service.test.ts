import { describe, expect, it } from "vitest";

import {
  compareFundamentalsToPrevious,
  getLatestFundamentals,
  recordFundamentalSnapshot,
} from "../../src/services/fundamentals.service";
import { getStockProfile } from "../../src/services/stocks.service";

let tickerSequence = 0;

function nextTicker(): string {
  tickerSequence += 1;
  return `TSTFND${tickerSequence}`;
}

describe("fundamentals.service", () => {
  it("records a fundamental snapshot and creates stock if missing", async () => {
    const ticker = nextTicker();

    const snapshot = await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-03-01T00:00:00.000Z"),
      marketCap: BigInt(100_000_000_000),
      peRatio: 22,
      revenueGrowth: 0.12,
      debtToEquity: 0.9,
    });

    const stock = await getStockProfile(ticker);

    expect(stock).not.toBeNull();
    expect(snapshot.stockId).toBe(stock?.id);
    expect(snapshot.peRatio).toBe(22);
  });

  it("returns latest fundamentals for a ticker", async () => {
    const ticker = nextTicker();

    await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-03-01T00:00:00.000Z"),
      peRatio: 20,
    });

    await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-03-02T00:00:00.000Z"),
      peRatio: 25,
    });

    const latest = await getLatestFundamentals(ticker);

    expect(latest?.peRatio).toBe(25);
    expect(latest?.capturedAt.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("compares current and previous snapshots with per-metric deltas", async () => {
    const ticker = nextTicker();

    await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-03-01T00:00:00.000Z"),
      peRatio: 21,
      revenueGrowth: 0.1,
      debtToEquity: 1.2,
    });

    await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-03-02T00:00:00.000Z"),
      peRatio: 26,
      revenueGrowth: 0.18,
      debtToEquity: 1,
    });

    const comparison = await compareFundamentalsToPrevious(ticker);

    expect(comparison).not.toBeNull();
    expect(comparison?.current.peRatio).toBe(26);
    expect(comparison?.previous?.peRatio).toBe(21);
    expect(comparison?.deltas.peRatio.delta).toBeCloseTo(5);
    expect(comparison?.deltas.revenueGrowth.delta).toBeCloseTo(0.08);
  });

  it("handles missing previous snapshot gracefully", async () => {
    const ticker = nextTicker();

    await recordFundamentalSnapshot(ticker, {
      capturedAt: new Date("2026-03-05T00:00:00.000Z"),
      peRatio: 19,
    });

    const comparison = await compareFundamentalsToPrevious(ticker);

    expect(comparison).not.toBeNull();
    expect(comparison?.previous).toBeNull();
    expect(comparison?.deltas.peRatio.current).toBe(19);
    expect(comparison?.deltas.peRatio.previous).toBeNull();
    expect(comparison?.deltas.peRatio.delta).toBeNull();
  });
});
