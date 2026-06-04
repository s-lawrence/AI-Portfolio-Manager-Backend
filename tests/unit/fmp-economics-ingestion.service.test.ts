import { afterEach, describe, expect, it, vi } from "vitest";

import { fmpEconomicsProvider } from "../../src/providers/fmp";
import { listRecentMacroEvents } from "../../src/repositories/macro-events.repository";
import { listMacroSeriesObservations } from "../../src/repositories/macro-series-observations.repository";
import {
  ingestFmpEconomicCalendar,
  ingestFmpEconomicsDefaultSet,
  ingestFmpTreasuryRates,
} from "../../src/services/fmp-economics-ingestion.service";

describe("fmp-economics-ingestion.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts treasury rates into macro series observations", async () => {
    vi.spyOn(fmpEconomicsProvider, "getTreasuryRates").mockResolvedValue([
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        year10: 4.41,
        year2: 4.06,
      },
    ]);

    const first = await ingestFmpTreasuryRates();
    expect(first.recordsCreated).toBe(2);

    vi.spyOn(fmpEconomicsProvider, "getTreasuryRates").mockResolvedValue([
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        year10: 4.43,
        year2: 4.08,
      },
    ]);

    const second = await ingestFmpTreasuryRates();
    expect(second.recordsUpdated).toBe(2);

    const tenYearSeries = await listMacroSeriesObservations({
      provider: "FMP",
      seriesId: "FMP_TREASURY_10Y",
      limit: 5,
    });

    expect(tenYearSeries.length).toBeGreaterThanOrEqual(1);
    expect(tenYearSeries[0]?.value).toBe(4.43);
  });

  it("upserts economic calendar events", async () => {
    vi.spyOn(fmpEconomicsProvider, "getEconomicCalendar").mockResolvedValue([
      {
        title: "[TEST] US CPI",
        country: "US",
        category: "Inflation",
        importance: "HIGH",
        eventDate: new Date("2026-07-10T12:30:00.000Z"),
        estimate: 3.1,
      },
    ]);

    const first = await ingestFmpEconomicCalendar({
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(first.recordsCreated).toBe(1);

    vi.spyOn(fmpEconomicsProvider, "getEconomicCalendar").mockResolvedValue([
      {
        title: "[TEST] US CPI",
        country: "US",
        category: "Inflation",
        importance: "HIGH",
        eventDate: new Date("2026-07-10T12:30:00.000Z"),
        estimate: 3.4,
      },
    ]);

    const second = await ingestFmpEconomicCalendar({
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(second.recordsUpdated).toBe(1);

    const events = await listRecentMacroEvents(20);
    const cpiEvent = events.find((event) => event.title === "[TEST] US CPI");
    expect(cpiEvent).toBeDefined();
    expect(cpiEvent?.estimate).toBe(3.4);
  });

  it("default set continues when one section fails", async () => {
    vi.spyOn(fmpEconomicsProvider, "getTreasuryRates").mockResolvedValue([
      {
        date: new Date("2026-06-03T00:00:00.000Z"),
        year10: 4.5,
      },
    ]);

    vi.spyOn(fmpEconomicsProvider, "getEconomicIndicators").mockRejectedValue(
      new Error("indicator endpoint failed"),
    );

    vi.spyOn(fmpEconomicsProvider, "getEconomicCalendar").mockResolvedValue([
      {
        title: "[TEST] US Payrolls",
        country: "US",
        category: "Labor",
        importance: "HIGH",
        eventDate: new Date("2026-06-07T12:30:00.000Z"),
      },
    ]);

    vi.spyOn(fmpEconomicsProvider, "getMarketRiskPremium").mockResolvedValue([
      {
        date: new Date("2026-06-02T00:00:00.000Z"),
        country: "US",
        totalRiskPremium: 5.6,
      },
    ]);

    const result = await ingestFmpEconomicsDefaultSet({
      includeIndicators: true,
    });

    expect(result.treasuryRates.recordsCreated).toBeGreaterThan(0);
    expect(result.economicCalendar.recordsCreated).toBeGreaterThan(0);
    expect(result.marketRiskPremium.recordsCreated).toBeGreaterThan(0);
    expect(result.economicIndicators.recordsCreated).toBe(0);
    expect(result.warnings.some((warning) => warning.includes("Economic-indicators ingestion failed"))).toBe(true);
  });
});
