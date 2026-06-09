import { describe, expect, it } from "vitest";

import { collectMentionedTickers, resolveTickerFromMessage } from "../../src/agent/agent-entity-resolution";

describe("agent entity resolution", () => {
  it("resolves Apple to AAPL via static alias", async () => {
    const result = await resolveTickerFromMessage("Take a look at Apple", undefined, {
      searchStockRecords: false,
    });

    expect(result.ticker).toBe("AAPL");
    expect(result.source).toBe("STATIC_ALIAS");
    expect(result.confidence).toBe("HIGH");
  });

  it("resolves Microsoft to MSFT", async () => {
    const result = await resolveTickerFromMessage("Research Microsoft", undefined, {
      searchStockRecords: false,
    });

    expect(result.ticker).toBe("MSFT");
    expect(result.source).toBe("STATIC_ALIAS");
    expect(result.confidence).toBe("HIGH");
  });

  it("resolves Nvidia to NVDA", async () => {
    const result = await resolveTickerFromMessage("Analyze Nvidia", undefined, {
      searchStockRecords: false,
    });

    expect(result.ticker).toBe("NVDA");
    expect(result.source).toBe("STATIC_ALIAS");
    expect(result.confidence).toBe("HIGH");
  });

  it("resolves RY.TO by ticker pattern", async () => {
    const result = await resolveTickerFromMessage("Look at RY.TO", undefined, {
      searchStockRecords: false,
    });

    expect(result.ticker).toBe("RY.TO");
    expect(result.source).toBe("TICKER_PATTERN");
    expect(result.confidence).toBe("HIGH");
  });

  it("uses explicit ticker over message alias", async () => {
    const result = await resolveTickerFromMessage("Take a look at Apple", "TSLA", {
      searchStockRecords: false,
    });

    expect(result.ticker).toBe("TSLA");
    expect(result.source).toBe("EXPLICIT");
    expect(result.confidence).toBe("HIGH");
  });

  it("returns ambiguous for Royal Bank without market preference", async () => {
    const result = await resolveTickerFromMessage("Research Royal Bank", undefined, {
      searchStockRecords: false,
    });

    expect(result.source).toBe("AMBIGUOUS");
    expect(result.confidence).toBe("LOW");
    expect(result.candidates?.some((candidate) => candidate.ticker === "RY")).toBe(true);
    expect(result.candidates?.some((candidate) => candidate.ticker === "RY.TO")).toBe(true);
  });

  it("does not resolve FX as a ticker for FX/risk semantic context", async () => {
    const result = await resolveTickerFromMessage("Refresh FX/risk data and USD/CAD rate", undefined, {
      searchStockRecords: false,
    });

    expect(result.source).toBe("NONE");
    expect(result.ticker).toBeUndefined();
  });

  it("still resolves FX ticker token when no FX semantic context is present", async () => {
    const result = await resolveTickerFromMessage("Research FX", undefined, {
      searchStockRecords: false,
    });

    expect(result.source).toBe("TICKER_PATTERN");
    expect(result.ticker).toBe("FX");
  });

  it("ignores add command word and keeps intended ticker", () => {
    const tickers = collectMentionedTickers("Confirm add NVDA to my watchlist", undefined, {
      searchStockRecords: false,
    });

    expect(tickers).toContain("NVDA");
    expect(tickers).not.toContain("ADD");
  });
});
