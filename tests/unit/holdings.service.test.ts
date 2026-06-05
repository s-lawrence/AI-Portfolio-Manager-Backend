import { HoldingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { updateHolding } from "../../src/repositories/holdings.repository";
import { updateStock } from "../../src/repositories/stocks.repository";
import { upsertFxRateSnapshot } from "../../src/services/fx-rates.service";
import { getHoldingOverview } from "../../src/services/holdings.service";
import {
  createTestHolding,
  createTestPortfolio,
  createTestPriceSnapshot,
  createTestStock,
} from "../../src/test/factories";

describe("holdings.service", () => {
  it("includes native and CAD valuation fields for USD holdings", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTHOVUSD");
    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 10,
      averageCost: 80,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 100,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.4,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const overview = await getHoldingOverview(holding.id);

    expect(overview).not.toBeNull();
    expect(overview?.nativeCurrency).toBe("USD");
    expect(overview?.latestPriceNative).toBe(100);
    expect(overview?.marketValueNative).toBe(1000);
    expect(overview?.costBasisNative).toBe(800);
    expect(overview?.unrealizedGainLossNative).toBe(200);
    expect(overview?.unrealizedGainLossPercent).toBe(25);

    expect(overview?.latestPrice).toBe(100);
    expect(overview?.marketValue).toBe(1000);
    expect(overview?.costBasis).toBe(800);
    expect(overview?.unrealizedGainLoss).toBe(200);

    expect(overview?.cadFxRate).toBe(1.4);
    expect(overview?.conversionStatus).toBe("CONVERTED");
    expect(overview?.marketValueCad).toBe(1400);
    expect(overview?.costBasisCad).toBe(1120);
    expect(overview?.unrealizedGainLossCad).toBe(280);
  });

  it("includes direct CAD valuation fields for CAD holdings", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTHOVCAD");

    await updateStock(stock.id, {
      currency: "CAD",
    });

    const holding = await createTestHolding(portfolio.id, stock.id);

    await updateHolding(holding.id, {
      status: HoldingStatus.OWNED,
      shares: 5,
      averageCost: 40,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 50,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const overview = await getHoldingOverview(holding.id);

    expect(overview).not.toBeNull();
    expect(overview?.nativeCurrency).toBe("CAD");
    expect(overview?.conversionStatus).toBe("DIRECT_CAD");
    expect(overview?.cadFxRate).toBe(1);
    expect(overview?.marketValueNative).toBe(250);
    expect(overview?.costBasisNative).toBe(200);
    expect(overview?.unrealizedGainLossNative).toBe(50);
    expect(overview?.marketValueCad).toBe(250);
    expect(overview?.costBasisCad).toBe(200);
    expect(overview?.unrealizedGainLossCad).toBe(50);
  });
});
