import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/config/env";
import {
  GDELT_FAILURE_CODES,
  GdeltClient,
} from "../../src/providers/gdelt/gdelt-client";
import { ProviderRequestError, ProviderResponseError } from "../../src/providers/errors";

describe("gdelt.client", () => {
  const originalTimeoutMs = env.GDELT_TIMEOUT_MS;

  afterEach(() => {
    env.GDELT_TIMEOUT_MS = originalTimeoutMs;
    vi.restoreAllMocks();
  });

  it("handles valid JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ articles: [{ title: "Headline" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new GdeltClient("https://api.gdeltproject.org/api/v2");
    const result = await client.getJson<{ articles: Array<{ title: string }> }>("/doc/doc", {
      query: "inflation risk",
      format: "json",
    });

    expect(result.articles[0]?.title).toBe("Headline");
  });

  it("handles non-JSON responses with classified error and no raw HTML leakage", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("<html><body>Rate limit page</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const client = new GdeltClient("https://api.gdeltproject.org/api/v2");

    try {
      await client.getJson("/doc/doc", { query: "war" });
      throw new Error("Expected non-JSON response error.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResponseError);
      expect((error as ProviderResponseError).message).toContain("Non-JSON response");
      const cause = (error as ProviderResponseError).cause as
        | { failureCode?: string; responseDiagnostics?: { responsePreview?: string } }
        | undefined;
      expect(cause?.failureCode).toBe(GDELT_FAILURE_CODES.NON_JSON_RESPONSE);
      expect(cause?.responseDiagnostics?.responsePreview).toContain("Rate limit page");
      expect((error as ProviderResponseError).message).not.toContain("<html>");
    }
  });

  it("returns GDELT_PARSE_ERROR when JSON is malformed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new GdeltClient("https://api.gdeltproject.org/api/v2");

    try {
      await client.getJson("/doc/doc", { query: "inflation" });
      throw new Error("Expected malformed JSON error.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResponseError);
      const cause = (error as ProviderResponseError).cause as
        | { failureCode?: string }
        | undefined;
      expect(cause?.failureCode).toBe(GDELT_FAILURE_CODES.PARSE_ERROR);
    }
  });

  it("returns GDELT_EMPTY_RESPONSE when body is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new GdeltClient("https://api.gdeltproject.org/api/v2");

    try {
      await client.getJson("/doc/doc", { query: "inflation" });
      throw new Error("Expected empty response error.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResponseError);
      const cause = (error as ProviderResponseError).cause as
        | { failureCode?: string }
        | undefined;
      expect(cause?.failureCode).toBe(GDELT_FAILURE_CODES.EMPTY_RESPONSE);
    }
  });

  it("encodes query parameters in built URL", () => {
    const client = new GdeltClient("https://api.gdeltproject.org/api/v2");

    const url = client.buildUrlForPath("/doc/doc", {
      query: "Federal Reserve OR oil prices & inflation",
      mode: "ArtList",
      format: "json",
    });

    expect(url).toContain("query=Federal+Reserve+OR+oil+prices+%26+inflation");
    expect(url).toContain("mode=ArtList");
    expect(url).toContain("format=json");
  });

  it("classifies timeout request errors", async () => {
    env.GDELT_TIMEOUT_MS = 5;

    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );

    const client = new GdeltClient("https://api.gdeltproject.org/api/v2");

    try {
      await client.getJson("/doc/doc", { query: "oil" });
      throw new Error("Expected timeout error.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRequestError);
      const cause = (error as ProviderRequestError).cause as
        | { failureCode?: string }
        | undefined;
      expect(cause?.failureCode).toBe(GDELT_FAILURE_CODES.TIMEOUT);
    }
  });
});
