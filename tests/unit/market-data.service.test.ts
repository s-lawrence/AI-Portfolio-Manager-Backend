import { describe, expect, it } from "vitest";

import {
  calculateDailyChange,
  getHistoricalPrices,
  getLatestMarketSnapshot,
  recordPriceSnapshot,
  upsertHistoricalPriceSnapshotForDay,
} from "../../src/services/market-data.service";
import { getStockProfile } from "../../src/services/stocks.service";
import { testPrisma } from "../../src/test/test-db";

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

  it("prefers FMP quote source over newer historical or demo rows", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      source: "DEMO",
      price: 250,
      previousClose: 245,
      capturedAt: new Date("2026-02-03T16:00:00.000Z"),
    });

    await recordPriceSnapshot(ticker, {
      source: "FMP_QUOTE",
      price: 310,
      previousClose: 305,
      capturedAt: new Date("2026-02-03T15:00:00.000Z"),
    });

    await recordPriceSnapshot(ticker, {
      source: "FMP_HISTORICAL",
      price: 217,
      previousClose: 214,
      capturedAt: new Date("2026-02-03T23:00:00.000Z"),
    });

    const latest = await getLatestMarketSnapshot(ticker);

    expect(latest).not.toBeNull();
    expect(latest?.source).toBe("FMP_QUOTE");
    expect(latest?.price).toBe(310);
  });

  it("returns an empty list for unknown ticker history", async () => {
    const historical = await getHistoricalPrices("TSTMKT-UNKNOWN", 10);
    expect(historical).toEqual([]);
  });

  it("updates canonical historical row when it already exists", async () => {
    const ticker = nextTicker();
    const marketDate = new Date("2026-02-10T14:00:00.000Z");
    const canonicalCapturedAt = new Date("2026-02-10T00:00:00.000Z");

    await recordPriceSnapshot(ticker, {
      source: null,
      price: 210,
      close: 210,
      capturedAt: canonicalCapturedAt,
    });

    const result = await upsertHistoricalPriceSnapshotForDay(ticker, {
      source: "FMP_HISTORICAL",
      price: 310,
      close: 310,
      high: 312,
      low: 308,
      volume: 1_200,
      capturedAt: marketDate,
    });

    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.skipped).toBe(false);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const rows = await testPrisma.priceSnapshot.findMany({
      where: {
        stockId: stock!.id,
        capturedAt: {
          gte: new Date("2026-02-10T00:00:00.000Z"),
          lt: new Date("2026-02-11T00:00:00.000Z"),
        },
      },
      orderBy: {
        capturedAt: "asc",
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.capturedAt.toISOString()).toBe("2026-02-10T00:00:00.000Z");
    expect(rows[0]?.source).toBe("FMP_HISTORICAL");
    expect(rows[0]?.price).toBe(310);
  });

  it("creates canonical historical row when same-day legacy row exists", async () => {
    const ticker = nextTicker();

    await recordPriceSnapshot(ticker, {
      source: null,
      price: 199,
      close: 199,
      capturedAt: new Date("2026-02-11T20:00:00.000Z"),
    });

    const result = await upsertHistoricalPriceSnapshotForDay(ticker, {
      source: "FMP_HISTORICAL",
      price: 305,
      close: 305,
      capturedAt: new Date("2026-02-11T12:00:00.000Z"),
    });

    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.skipped).toBe(false);

    const stock = await getStockProfile(ticker);
    expect(stock).not.toBeNull();

    const rows = await testPrisma.priceSnapshot.findMany({
      where: {
        stockId: stock!.id,
        capturedAt: {
          gte: new Date("2026-02-11T00:00:00.000Z"),
          lt: new Date("2026-02-12T00:00:00.000Z"),
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(
      rows.some(
        (row) =>
          row.source === "FMP_HISTORICAL" &&
          row.capturedAt.toISOString() === "2026-02-11T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("updates canonical row when canonical and legacy same-day rows both exist", async () => {
    const ticker = nextTicker();

    const canonical = await recordPriceSnapshot(ticker, {
      source: "FMP_HISTORICAL",
      price: 250,
      close: 250,
      capturedAt: new Date("2026-02-12T00:00:00.000Z"),
    });

    const legacy = await recordPriceSnapshot(ticker, {
      source: null,
      price: 190,
      close: 190,
      capturedAt: new Date("2026-02-12T20:00:00.000Z"),
    });

    const result = await upsertHistoricalPriceSnapshotForDay(ticker, {
      source: "FMP_HISTORICAL",
      price: 333,
      close: 333,
      capturedAt: new Date("2026-02-12T17:00:00.000Z"),
    });

    expect(result.updated).toBe(true);
    expect(result.snapshot.id).toBe(canonical.id);

    const stock = await getStockProfile(ticker);
    const rows = await testPrisma.priceSnapshot.findMany({
      where: {
        stockId: stock!.id,
        capturedAt: {
          gte: new Date("2026-02-12T00:00:00.000Z"),
          lt: new Date("2026-02-13T00:00:00.000Z"),
        },
      },
      orderBy: {
        capturedAt: "asc",
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === canonical.id)?.price).toBe(333);
    expect(rows.find((row) => row.id === legacy.id)?.source).toBeNull();
  });

  it("does not convert same-day quote row into historical row", async () => {
    const ticker = nextTicker();

    const quote = await recordPriceSnapshot(ticker, {
      source: "FMP_QUOTE",
      price: 410,
      close: 410,
      capturedAt: new Date("2026-02-13T15:30:00.000Z"),
    });

    const result = await upsertHistoricalPriceSnapshotForDay(ticker, {
      source: "FMP_HISTORICAL",
      price: 305,
      close: 305,
      capturedAt: new Date("2026-02-13T09:00:00.000Z"),
    });

    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);

    const stock = await getStockProfile(ticker);
    const rows = await testPrisma.priceSnapshot.findMany({
      where: {
        stockId: stock!.id,
        capturedAt: {
          gte: new Date("2026-02-13T00:00:00.000Z"),
          lt: new Date("2026-02-14T00:00:00.000Z"),
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === quote.id)?.source).toBe("FMP_QUOTE");
    expect(rows.some((row) => row.source === "FMP_HISTORICAL")).toBe(true);
  });
});
