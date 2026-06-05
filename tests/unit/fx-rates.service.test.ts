import { describe, expect, it } from "vitest";

import {
  convertMoneyToCad,
  upsertFxRateSnapshot,
} from "../../src/services/fx-rates.service";

describe("fx-rates.service", () => {
  it("converts CAD amounts directly with rate 1", async () => {
    const result = await convertMoneyToCad({
      amount: 250,
      currency: "CAD",
    });

    expect(result.amountCad).toBe(250);
    expect(result.fxRate).toBe(1);
    expect(result.fxRateSource).toBeNull();
    expect(result.fxRateCapturedAt).toBeNull();
    expect(result.conversionStatus).toBe("DIRECT_CAD");
  });

  it("converts USD amounts using latest stored USD/CAD rate", async () => {
    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.35,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    await upsertFxRateSnapshot({
      baseCurrency: "USD",
      quoteCurrency: "CAD",
      rate: 1.37,
      source: "Bank of Canada Valet:FXUSDCAD",
      capturedAt: new Date("2026-06-02T00:00:00.000Z"),
    });

    const result = await convertMoneyToCad({
      amount: 100,
      currency: "USD",
    });

    expect(result.conversionStatus).toBe("CONVERTED");
    expect(result.fxRate).toBe(1.37);
    expect(result.amountCad).toBeCloseTo(137);
    expect(result.fxRateSource).toContain("Bank of Canada");
    expect(result.fxRateCapturedAt).toEqual(new Date("2026-06-02T00:00:00.000Z"));
  });

  it("returns MISSING_FX when USD/CAD is unavailable", async () => {
    const result = await convertMoneyToCad({
      amount: 50,
      currency: "USD",
    });

    expect(result.amountCad).toBeNull();
    expect(result.fxRate).toBeNull();
    expect(result.fxRateSource).toBeNull();
    expect(result.fxRateCapturedAt).toBeNull();
    expect(result.conversionStatus).toBe("MISSING_FX");
  });

  it("returns UNSUPPORTED_CURRENCY for non-USD/CAD currencies", async () => {
    const result = await convertMoneyToCad({
      amount: 75,
      currency: "EUR",
    });

    expect(result.amountCad).toBeNull();
    expect(result.fxRate).toBeNull();
    expect(result.fxRateSource).toBeNull();
    expect(result.fxRateCapturedAt).toBeNull();
    expect(result.conversionStatus).toBe("UNSUPPORTED_CURRENCY");
  });
});
