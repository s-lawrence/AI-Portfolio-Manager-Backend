import { describe, expect, it } from "vitest";

import { normalizeProviderTickerOrThrow } from "../../src/providers/types";

describe("providers.types", () => {
  it("normalizes tickers to uppercase", () => {
    expect(normalizeProviderTickerOrThrow(" aapl ")).toBe("AAPL");
  });

  it("preserves exchange suffixes while uppercasing", () => {
    expect(normalizeProviderTickerOrThrow("bns.to")).toBe("BNS.TO");
    expect(normalizeProviderTickerOrThrow("xbb.v")).toBe("XBB.V");
  });

  it("throws for blank ticker", () => {
    expect(() => normalizeProviderTickerOrThrow("  ")).toThrow(
      "Ticker must be a non-empty string.",
    );
  });
});