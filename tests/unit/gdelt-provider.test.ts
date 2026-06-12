import { describe, expect, it } from "vitest";

import { GdeltJsonClient, GdeltJsonQuery } from "../../src/providers/gdelt/gdelt-client";
import { GdeltProvider } from "../../src/providers/gdelt/gdelt-provider";

function createMockClient(
  resolver: (path: string, query?: GdeltJsonQuery) => unknown,
): GdeltJsonClient {
  return {
    async getJson<T>(path: string, query?: GdeltJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("gdelt.provider", () => {
  it("maps GDELT DOC articles and sentiment from tone", async () => {
    let capturedStartDatetime: unknown;
    let capturedEndDatetime: unknown;

    const provider = new GdeltProvider(
      createMockClient((path, query) => {
        expect(path).toBe("/doc/doc");
        expect(query?.mode).toBe("ArtList");
        expect(query?.format).toBe("json");
        capturedStartDatetime = query?.startdatetime;
        capturedEndDatetime = query?.enddatetime;

        return {
          articles: [
            {
              title: "Sanctions update",
              url: "https://example.com/a",
              domain: "example.com",
              seendate: "20260608103000",
              sourcecountry: "US",
              language: "English",
              tone: 2.4,
            },
            {
              title: "Energy disruption",
              url: "https://example.com/b",
              domain: "example.com",
              seendate: "20260608113000",
              sourcecountry: "GB",
              language: "English",
              tone: -2.2,
            },
            {
              title: "Neutral macro coverage",
              url: "https://example.com/c",
              domain: "example.com",
              seendate: "20260608123000",
              sourcecountry: "CA",
              language: "English",
              tone: 0.3,
            },
          ],
        };
      }),
    );

    const events = await provider.searchDocArticles({
      query: "war OR sanctions",
      maxRecords: 5,
    });

    expect(events).toHaveLength(3);
    expect(events[0]?.sentiment).toBe("NEUTRAL");
    expect(events[1]?.sentiment).toBe("NEGATIVE");
    expect(events[2]?.sentiment).toBe("POSITIVE");
    expect(String(capturedStartDatetime)).toMatch(/^\d{14}$/);
    expect(String(capturedEndDatetime)).toMatch(/^\d{14}$/);
  });

  it("skips items missing title/date and dedupes by URL", async () => {
    const provider = new GdeltProvider(
      createMockClient(() => ({
        articles: [
          {
            title: "Valid article",
            url: "https://example.com/one",
            domain: "example.com",
            seendate: "20260608103000",
            tone: 0,
          },
          {
            title: "Valid article duplicate",
            url: "https://example.com/one",
            domain: "example.com",
            seendate: "20260608113000",
            tone: 0,
          },
          {
            title: "",
            url: "https://example.com/no-title",
            seendate: "20260608123000",
          },
          {
            title: "Missing date",
            url: "https://example.com/no-date",
          },
        ],
      })),
    );

    const events = await provider.searchDocArticles({
      query: "trade war OR tariffs",
      maxRecords: 10,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.url).toBe("https://example.com/one");
  });

  it("collects default global risk events from all default queries", async () => {
    const calledQueries: string[] = [];

    const provider = new GdeltProvider(
      createMockClient((_path, query) => {
        const nextQuery = typeof query?.query === "string" ? query.query : "";
        calledQueries.push(nextQuery);

        return {
          articles: [
            {
              title: `Headline for ${nextQuery}`,
              url: `https://example.com/${encodeURIComponent(nextQuery)}`,
              seendate: "20260608103000",
            },
          ],
        };
      }),
    );

    const events = await provider.getDefaultGlobalRiskEvents({
      maxRecordsPerQuery: 3,
      maxRecords: 20,
    });

    expect(calledQueries.length).toBe(2);
    expect(events.length).toBeGreaterThan(0);
  });

  it("uses reduced quick-mode query set for default global risk events", async () => {
    const calledQueries: string[] = [];

    const provider = new GdeltProvider(
      createMockClient((_path, query) => {
        calledQueries.push(String(query?.query ?? ""));

        return {
          articles: [
            {
              title: `Headline for ${query?.query}`,
              url: `https://example.com/${encodeURIComponent(String(query?.query ?? ""))}`,
              seendate: "20260608103000",
            },
          ],
        };
      }),
    );

    await provider.getDefaultGlobalRiskEvents({
      mode: "quick",
      maxRecordsPerQuery: 3,
      maxRecords: 10,
    });

    expect(calledQueries).toHaveLength(2);
  });
});
