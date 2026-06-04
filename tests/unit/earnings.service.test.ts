import { describe, expect, it } from "vitest";

import { createEarningsEvent } from "../../src/repositories/earnings-events.repository";
import { listUpcomingPortfolioEarnings } from "../../src/services/earnings.service";
import {
  createTestHolding,
  createTestPortfolio,
  createTestStock,
} from "../../src/test/factories";

describe("earnings.service", () => {
  it("returns only useful upcoming earnings events and excludes placeholder rows", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTEARN01");

    await createTestHolding(portfolio.id, stock.id);

    await createEarningsEvent({
      stockId: stock.id,
      earningsDate: new Date("2026-08-01T12:00:00.000Z"),
      // Placeholder-style row: has date but no useful details.
      fiscalQuarter: null,
      fiscalYear: null,
      estimatedEps: null,
      estimatedRevenue: null,
      reportedEps: null,
      reportedRevenue: null,
      isDateConfirmed: false,
    });

    await createEarningsEvent({
      stockId: stock.id,
      earningsDate: new Date("2026-08-10T12:00:00.000Z"),
      fiscalQuarter: "Q3",
      fiscalYear: 2026,
      estimatedEps: 1.22,
      estimatedRevenue: BigInt(22_500_000_000),
      isDateConfirmed: true,
    });

    const upcoming = await listUpcomingPortfolioEarnings(portfolio.id);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.ticker).toBe(stock.ticker);
    expect(upcoming[0]?.event.fiscalQuarter).toBe("Q3");
    expect(upcoming[0]?.event.estimatedEps).toBe(1.22);
  });

  it("returns empty array when no useful upcoming earnings exist", async () => {
    const portfolio = await createTestPortfolio();
    const stock = await createTestStock("TSTEARN02");

    await createTestHolding(portfolio.id, stock.id);

    const upcoming = await listUpcomingPortfolioEarnings(portfolio.id);
    expect(upcoming).toEqual([]);
  });
});
