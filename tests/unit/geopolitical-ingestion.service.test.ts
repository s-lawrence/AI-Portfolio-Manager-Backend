import { afterEach, describe, expect, it, vi } from "vitest";

import { gdeltProvider } from "../../src/providers/gdelt";
import { ProviderRequestError } from "../../src/providers/errors";
import {
  getGeopoliticalSummary,
  getLatestGeopoliticalContext,
  ingestDefaultGdeltRiskSet,
  ingestGdeltQuery,
  runGdeltQueryAudit,
} from "../../src/services/geopolitical-ingestion.service";
import { env } from "../../src/config/env";

describe("geopolitical-ingestion.service", () => {
  const originalDelayMs = env.GDELT_QUERY_DELAY_MS;

  afterEach(() => {
    env.GDELT_QUERY_DELAY_MS = originalDelayMs;
    vi.useRealTimers();
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
    env.GDELT_QUERY_DELAY_MS = 0;

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
    env.GDELT_QUERY_DELAY_MS = 0;

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

  it("runs default-set queries sequentially with configured delay", async () => {
    env.GDELT_QUERY_DELAY_MS = 1;
    const originalDelay = env.GDELT_QUERY_DELAY_MS;

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(gdeltProvider, "searchDocArticles").mockResolvedValue([
      {
        provider: "GDELT",
        title: "Sequential query result",
        url: "https://example.com/sequential-query-result",
        publishedAt: new Date("2026-06-08T12:00:00.000Z"),
      },
    ]);

    const runPromise = ingestDefaultGdeltRiskSet({
      queries: ["geopolitical risk", "Federal Reserve OR inflation"],
      maxRecordsPerQuery: 5,
    });

    await runPromise;

    expect(timeoutSpy).toHaveBeenCalled();
    expect(gdeltProvider.searchDocArticles).toHaveBeenCalledTimes(2);
    expect(gdeltProvider.searchDocArticles).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ query: "geopolitical risk" }),
    );
    expect(gdeltProvider.searchDocArticles).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ query: "Federal Reserve OR inflation" }),
    );

    env.GDELT_QUERY_DELAY_MS = originalDelay;
  });

  it("captures structured failed query details for 429 failures", async () => {
    env.GDELT_QUERY_DELAY_MS = 0;

    vi.spyOn(gdeltProvider, "searchDocArticles").mockImplementation(async (options) => {
      if (String(options.query).includes("geopolitical")) {
        throw new ProviderRequestError("GDELT 2.0", "GDELT 2.0 request failed with status 429.", {
          endpoint: "/doc/doc",
          statusCode: 429,
          cause: {
            retryAttempted: true,
          },
        });
      }

      return [
        {
          provider: "GDELT",
          title: "Inflation signal",
          url: "https://example.com/inflation-signal",
          publishedAt: new Date("2026-06-08T12:00:00.000Z"),
          query: options.query,
          category: "MACRO",
          theme: "MACRO_POLICY",
          sentiment: "NEUTRAL",
        },
      ];
    });

    const result = await ingestDefaultGdeltRiskSet({
      queries: ["geopolitical risk", "inflation"],
      maxRecordsPerQuery: 5,
    });

    expect(result.queriesFailed).toBe(1);
    expect(result.failedQueries[0]).toMatchObject({
      query: "geopolitical risk",
      statusCode: 429,
      retryAttempted: true,
      failureCode: "GDELT_HTTP_ERROR",
    });
  });

  it("summary with no local geopolitical events suggests running refresh", async () => {
    const summary = await getGeopoliticalSummary({ days: 7, limit: 50 });

    expect(summary.totalEvents).toBe(0);
    expect(summary.message).toContain("No persisted GDELT events");
    expect(summary.suggestedActions?.some((value) => value.includes("refreshGdeltRiskContext"))).toBe(
      true,
    );
  });

  it("returns mapped GDELT query audit details", async () => {
    vi.spyOn(gdeltProvider, "auditDocQuery").mockResolvedValue({
      query: "geopolitical risk",
      url: "https://api.gdeltproject.org/api/v2/doc/doc?query=geopolitical%20risk",
      statusCode: 200,
      elapsedMs: 112,
      rawTopLevelKeys: ["articles", "status"],
      articleCount: 3,
      firstArticleKeys: ["domain", "seendate", "title", "url"],
      mappedEventCount: 2,
      retryAttempted: false,
      warnings: [],
    });

    const audit = await runGdeltQueryAudit("geopolitical risk", { maxRecords: 5 });

    expect(audit.query).toBe("geopolitical risk");
    expect(audit.statusCode).toBe(200);
    expect(audit.articleCount).toBe(3);
    expect(audit.mappedEventCount).toBe(2);
    expect(audit.rawTopLevelKeys).toContain("articles");
  });
});
