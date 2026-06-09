import { afterEach, describe, expect, it, vi } from "vitest";

import { bankOfCanadaProvider } from "../../src/providers/bank-of-canada";
import { fredProvider } from "../../src/providers/fred";
import { getLatestFxRate } from "../../src/services/fx-rates.service";
import { getLatestMacroObservation } from "../../src/services/macro-series.service";
import {
  ingestBankOfCanadaUsdCad,
  ingestDefaultFredMacroSet,
  ingestDefaultMacroAndFx,
  ingestFredSeries,
} from "../../src/services/macro-ingestion.service";

describe("macro-ingestion.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts USD/CAD FX snapshots from BoC data", async () => {
    const capturedAt = new Date("2026-06-10T00:00:00.000Z");

    const bocSpy = vi.spyOn(bankOfCanadaProvider, "getUsdCadRate");
    bocSpy.mockResolvedValueOnce([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.361,
        capturedAt,
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    const first = await ingestBankOfCanadaUsdCad();

    bocSpy.mockResolvedValueOnce([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.389,
        capturedAt,
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    const second = await ingestBankOfCanadaUsdCad();

    bocSpy.mockResolvedValueOnce([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.389,
        capturedAt,
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    const third = await ingestBankOfCanadaUsdCad();

    const latest = await getLatestFxRate("USD", "CAD");

    expect(first.recordsCreated).toBe(1);
    expect(first.recordsUpdated).toBe(0);
    expect(second.recordsCreated).toBe(0);
    expect(second.recordsUpdated).toBe(1);
    expect(third.recordsSkipped).toBe(1);
    expect(latest?.rate).toBe(1.389);
  });

  it("upserts FRED series observations", async () => {
    const observedAt = new Date("2026-06-11T00:00:00.000Z");

    const fredSpy = vi.spyOn(fredProvider, "getSeriesObservations");
    fredSpy.mockResolvedValueOnce([
      {
        provider: "FRED",
        seriesId: "DGS10",
        name: "10-Year Treasury Constant Maturity Rate",
        country: "US",
        category: "rates",
        unit: "percent",
        value: 4.42,
        observedAt,
        source: "FRED",
      },
    ]);

    const first = await ingestFredSeries("DGS10");

    fredSpy.mockResolvedValueOnce([
      {
        provider: "FRED",
        seriesId: "DGS10",
        name: "10-Year Treasury Constant Maturity Rate",
        country: "US",
        category: "rates",
        unit: "percent",
        value: 4.48,
        observedAt,
        source: "FRED",
      },
    ]);

    const second = await ingestFredSeries("DGS10");

    const latest = await getLatestMacroObservation("FRED", "DGS10");

    expect(first.recordsCreated).toBe(1);
    expect(second.recordsUpdated).toBe(1);
    expect(latest?.value).toBe(4.48);
  });

  it("continues default FRED set when one series fails", async () => {
    vi.spyOn(fredProvider, "getSeriesObservations").mockImplementation(async (seriesId) => {
      if (seriesId === "BROKEN") {
        throw new Error("Simulated provider failure");
      }

      return [
        {
          provider: "FRED",
          seriesId,
          name: seriesId,
          country: "US",
          category: "rates",
          unit: "percent",
          value: 4.11,
          observedAt: new Date("2026-06-12T00:00:00.000Z"),
          source: "FRED",
        },
      ];
    });

    const result = await ingestDefaultFredMacroSet({
      seriesIds: ["DGS10", "BROKEN"],
    });

    expect(result.recordsCreated).toBe(1);
    expect(result.failedSeries).toContain("BROKEN");
    expect(result.warnings.some((warning) => warning.includes("BROKEN"))).toBe(true);
  });

  it("runs combined default macro ingestion for BoC and FRED", async () => {
    vi.spyOn(bankOfCanadaProvider, "getUsdCadRate").mockResolvedValue([
      {
        baseCurrency: "USD",
        quoteCurrency: "CAD",
        rate: 1.3725,
        capturedAt: new Date("2026-06-13T00:00:00.000Z"),
        source: "Bank of Canada Valet:FXUSDCAD",
      },
    ]);

    vi.spyOn(fredProvider, "getSeriesObservations").mockImplementation(async (seriesId) => [
      {
        provider: "FRED",
        seriesId,
        name: seriesId,
        country: "US",
        category: "rates",
        unit: "percent",
        value: 4.2,
        observedAt: new Date("2026-06-13T00:00:00.000Z"),
        source: "FRED",
      },
    ]);

    const result = await ingestDefaultMacroAndFx({
      fredSeriesIds: ["DGS10"],
    });

    expect(result.bankOfCanada.recordsCreated).toBe(1);
    expect(result.fred.recordsCreated).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not call FRED provider when includeFred=false", async () => {
    const bocSpy = vi.spyOn(bankOfCanadaProvider, "getUsdCadRate").mockResolvedValue([]);
    const fredSpy = vi.spyOn(fredProvider, "getSeriesObservations").mockResolvedValue([]);

    const result = await ingestDefaultMacroAndFx({
      includeBankOfCanada: true,
      includeFred: false,
    });

    expect(bocSpy).toHaveBeenCalled();
    expect(fredSpy).not.toHaveBeenCalled();
    expect(result.fred.recordsCreated).toBe(0);
  });

  it("forwards bank and FRED observation limits to provider calls", async () => {
    const bocSpy = vi.spyOn(bankOfCanadaProvider, "getUsdCadRate").mockResolvedValue([]);
    const fredSpy = vi.spyOn(fredProvider, "getSeriesObservations").mockResolvedValue([]);

    await ingestDefaultMacroAndFx({
      includeBankOfCanada: true,
      includeFred: true,
      bankOfCanadaLimit: 44,
      fredObservationLimit: 33,
      fredSeriesIds: ["DGS10"],
    });

    expect(bocSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 44,
      }),
    );

    expect(fredSpy).toHaveBeenCalledWith(
      "DGS10",
      expect.objectContaining({
        limit: 33,
      }),
    );
  });
});
