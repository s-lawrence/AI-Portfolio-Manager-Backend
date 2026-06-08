import { afterEach, describe, expect, it, vi } from "vitest";

import { gdeltProvider } from "../../src/providers/gdelt";
import {
  getGeopoliticalSummary,
  getLatestGeopoliticalContext,
  ingestDefaultGdeltRiskSet,
  ingestGdeltQuery,
} from "../../src/services/geopolitical-ingestion.service";

describe("geopolitical-ingestion.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ingests a single query and upserts events", async () => {
    vi.spyOn(gdeltProvider, "searchDocArticles").mockResolvedValue([
      {
        provider: "GDELT",
        title: "Sanctions and energy",
        url: "https://example.com/sanctions-energy",
        domain: "example.com",
        sourceCountry: "US",
        language: "English",
        publishedAt: new Date("2026-06-08T12:00:00.000Z"),
        query: "war OR sanctions",
        category: "CONFLICT",
        theme: "GEOPOLITICAL_CONFLICT",
        tone: -1.4,
        sentiment: "NEGATIVE",
        raw: { sample: true },
      },
    ]);

    const first = await ingestGdeltQuery("war OR sanctions", {
      maxRecords: 10,
    });
    const second = await ingestGdeltQuery("war OR sanctions", {
      maxRecords: 10,
    });

    expect(first.eventsCreated).toBe(1);
    expect(second.eventsUpdated + second.eventsCreated).toBeGreaterThanOrEqual(1);
  });

  it("continues default risk set when one query fails", async () => {
    vi.spyOn(gdeltProvider, "searchDocArticles").mockImplementation(async (options) => {
      if (options.query?.includes("sanctions")) {
        throw new Error("query failed");
      }

      return [
        {
          provider: "GDELT",
          title: `Result for ${options.query}`,
          url: `https://example.com/${encodeURIComponent(options.query ?? "")}`,
          publishedAt: new Date("2026-06-08T12:00:00.000Z"),
          query: options.query,
          category: "GEOPOLITICAL",
          theme: "GLOBAL_RISK",
          sentiment: "NEUTRAL",
        },
      ];
    });

    const result = await ingestDefaultGdeltRiskSet({
      queries: ["war OR sanctions", "trade war OR tariffs"],
      maxRecordsPerQuery: 5,
    });

    expect(result.queriesProcessed).toBe(2);
    expect(result.queriesFailed).toBe(1);
    expect(result.failedQueries).toHaveLength(1);
    expect(result.eventsCreated + result.eventsUpdated).toBeGreaterThanOrEqual(1);
  });

  it("returns latest context and bounded summary", async () => {
    vi.spyOn(gdeltProvider, "searchDocArticles").mockResolvedValue([
      {
        provider: "GDELT",
        title: "Energy disruption risk",
        url: "https://example.com/energy-risk",
        domain: "example.com",
        sourceCountry: "CA",
        publishedAt: new Date("2026-06-08T13:00:00.000Z"),
        query: "energy crisis",
        category: "ENERGY",
        theme: "ENERGY_SUPPLY",
        tone: -0.8,
        sentiment: "NEUTRAL",
      },
      {
        provider: "GDELT",
        title: "Cyber incident updates",
        url: "https://example.com/cyber-incident",
        domain: "example.com",
        sourceCountry: "US",
        publishedAt: new Date("2026-06-08T14:00:00.000Z"),
        query: "cyber attack",
        category: "CYBER",
        theme: "CYBER_RISK",
        tone: -1.5,
        sentiment: "NEGATIVE",
      },
    ]);

    await ingestDefaultGdeltRiskSet({
      queries: ["energy crisis", "cyber attack"],
      maxRecordsPerQuery: 5,
    });

    const latest = await getLatestGeopoliticalContext({ limit: 20, days: 7 });
    const summary = await getGeopoliticalSummary({ days: 7, limit: 100 });

    expect(latest.items.length).toBeGreaterThanOrEqual(2);
    expect(summary.totalEvents).toBeGreaterThanOrEqual(2);
    expect(summary.topHeadlines.length).toBeGreaterThan(0);
    expect(summary.countsByCategory.length).toBeGreaterThan(0);
  });
});
