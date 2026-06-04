import { describe, expect, it } from "vitest";

import {
  ProviderConfigurationError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "../../src/providers/errors";

describe("providers.errors", () => {
  it("includes provider metadata", () => {
    const error = new ProviderConfigurationError(
      "FRED",
      "Missing API key.",
      { endpoint: "/series/observations" },
    );

    expect(error.name).toBe("ProviderConfigurationError");
    expect(error.provider).toBe("FRED");
    expect(error.endpoint).toBe("/series/observations");
    expect(error.statusCode).toBeUndefined();
  });

  it("defaults status codes for not found and rate limit errors", () => {
    const notFound = new ProviderNotFoundError("Financial Modeling Prep", "Ticker not found.");
    const rateLimit = new ProviderRateLimitError("FRED", "Rate limit exceeded.");

    expect(notFound.statusCode).toBe(404);
    expect(rateLimit.statusCode).toBe(429);
  });

  it("redacts secrets from messages and endpoints", () => {
    const error = new ProviderRequestError(
      "Financial Modeling Prep",
      "Request failed with token=secret-token and apiKey=secret-key.",
      {
        endpoint: "/v3/quote/AAPL?apikey=secret-value",
        statusCode: 401,
      },
    );

    expect(error.message).not.toContain("secret-token");
    expect(error.message).not.toContain("secret-key");
    expect(error.message).toContain("token=[REDACTED]");
    expect(error.message).toContain("apiKey=[REDACTED]");
    expect(error.endpoint).toBe("/v3/quote/AAPL?apikey=[REDACTED]");
    expect(error.statusCode).toBe(401);
  });
});