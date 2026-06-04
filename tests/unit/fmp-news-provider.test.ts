import { describe, expect, it } from "vitest";

import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../../src/providers/errors";
import { FmpJsonClient, FmpJsonQuery } from "../../src/providers/fmp/fmp-client";
import { FmpNewsProvider } from "../../src/providers/fmp/fmp-news.provider";

function createMockClient(
  resolver: (path: string, query?: FmpJsonQuery) => unknown,
): FmpJsonClient {
  return {
    async getJson<T>(path: string, query?: FmpJsonQuery): Promise<T> {
      return resolver(path, query) as T;
    },
  };
}

describe("fmp news provider", () => {
  it("maps and deduplicates stock news payload", async () => {
    const provider = new FmpNewsProvider(
      createMockClient((path, query) => {
        expect(path).toBe("/news/stock");
        expect(query).toMatchObject({ symbols: "AAPL", limit: 5 });

        return [
          {
            symbol: "AAPL",
            title: "Apple beats estimates",
            text: "Strong quarter",
            source: "Wire",
            author: "Reporter",
            url: "https://example.com/aapl/news-1",
            publishedDate: "2026-05-02T10:00:00.000Z",
            sentiment: "positive",
            sentimentScore: 0.6,
          },
          {
            symbol: "AAPL",
            title: "Apple beats estimates duplicate",
            text: "Duplicate URL should be ignored",
            source: "Wire",
            author: "Reporter",
            url: "https://example.com/aapl/news-1",
            publishedDate: "2026-05-02T10:00:00.000Z",
          },
          {
            symbol: "AAPL",
            headline: "Apple guidance update",
            content: "Management comments",
            site: "AltWire",
            url: "https://example.com/aapl/news-2",
            publishedAt: "2026-05-03T10:00:00.000Z",
          },
        ];
      }),
    );

    const news = await provider.getCompanyNews("aapl", { limit: 5 });

    expect(news).toHaveLength(2);
    expect(news[0]?.headline).toBe("Apple guidance update");
    expect(news[1]?.headline).toBe("Apple beats estimates");
    expect(news[1]?.sentiment).toBe("positive");
    expect(news[1]?.isDemo).toBe(false);
  });

  it("returns empty list for missing news payload", async () => {
    const provider = new FmpNewsProvider(
      createMockClient((path) => {
        if (path === "/news/stock") {
          throw new ProviderRequestError("Financial Modeling Prep", "Not found", {
            endpoint: path,
            statusCode: 404,
          });
        }

        return [];
      }),
    );

    const news = await provider.getCompanyNews("MSFT");
    expect(news).toEqual([]);
  });

  it("throws mapped errors for unauthorized and rate-limited responses", async () => {
    const unauthorizedProvider = new FmpNewsProvider(
      createMockClient((path) => {
        throw new ProviderRequestError("Financial Modeling Prep", "Forbidden", {
          endpoint: path,
          statusCode: 403,
        });
      }),
    );

    await expect(unauthorizedProvider.getCompanyNews("AAPL")).rejects.toBeInstanceOf(
      ProviderConfigurationError,
    );

    const rateLimitedProvider = new FmpNewsProvider(
      createMockClient((path) => {
        throw new ProviderRequestError("Financial Modeling Prep", "Rate limited", {
          endpoint: path,
          statusCode: 429,
        });
      }),
    );

    await expect(rateLimitedProvider.getCompanyNews("AAPL")).rejects.toBeInstanceOf(
      ProviderRateLimitError,
    );
  });
});
