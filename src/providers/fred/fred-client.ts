import { env } from "../../config/env";
import {
  ProviderConfigurationError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderResponseError,
} from "../errors";

export const FRED_PROVIDER_NAME = "FRED";

export type FredJsonQueryValue = string | number | boolean | Date | null | undefined;

export type FredJsonQuery = Record<string, FredJsonQueryValue>;

export interface FredClientOptions {
  baseUrl?: string;
  apiKey?: string;
  providerName?: string;
}

export interface FredJsonClient {
  getJson<T>(path: string, query?: FredJsonQuery): Promise<T>;
}

function formatDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stringifyQueryValue(value: Exclude<FredJsonQueryValue, null | undefined>): string {
  if (value instanceof Date) {
    return formatDateOnly(value);
  }

  return String(value);
}

export class FredClient implements FredJsonClient {
  private readonly providerName: string;

  private readonly baseUrlOverride?: string;

  private readonly apiKeyOverride?: string;

  constructor(options: FredClientOptions = {}) {
    this.providerName = options.providerName ?? FRED_PROVIDER_NAME;
    this.baseUrlOverride = options.baseUrl;
    this.apiKeyOverride = options.apiKey;
  }

  async getJson<T>(path: string, query: FredJsonQuery = {}): Promise<T> {
    const endpoint = this.normalizeEndpoint(path);
    const apiKey = this.requireApiKey(endpoint);
    const url = this.buildUrl(endpoint, query, apiKey);
    const timeoutMs = this.resolveTimeoutMs();

    let response: Response;
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: timeoutController.signal,
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";

      throw new ProviderRequestError(
        this.providerName,
        isTimeout
          ? `Request to ${this.providerName} timed out after ${timeoutMs}ms.`
          : `Request to ${this.providerName} failed.`,
        { endpoint, cause: error },
      );
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new ProviderRateLimitError(
          this.providerName,
          `${this.providerName} rate limit exceeded.`,
          {
            endpoint,
            statusCode: response.status,
          },
        );
      }

      throw new ProviderRequestError(
        this.providerName,
        `${this.providerName} request failed with status ${response.status}.`,
        {
          endpoint,
          statusCode: response.status,
        },
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ProviderResponseError(
        this.providerName,
        `Invalid JSON response from ${this.providerName}.`,
        {
          endpoint,
          statusCode: response.status,
          cause: error,
        },
      );
    }
  }

  private normalizeEndpoint(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
      throw new ProviderRequestError(this.providerName, "Provider path is required.");
    }

    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  private requireApiKey(endpoint: string): string {
    const apiKey = (this.apiKeyOverride ?? env.FRED_API_KEY)?.trim();
    if (!apiKey) {
      throw new ProviderConfigurationError(
        this.providerName,
        `${this.providerName} API key is not configured.`,
        { endpoint },
      );
    }

    return apiKey;
  }

  private buildUrl(endpoint: string, query: FredJsonQuery, apiKey: string): URL {
    const baseUrl = this.baseUrlOverride ?? env.FRED_BASE_URL;
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    const base = new URL(normalizedBaseUrl);
    const url = new URL(endpoint.replace(/^\//, ""), base);

    for (const [key, value] of Object.entries(query)) {
      if (value == null) {
        continue;
      }

      url.searchParams.set(key, stringifyQueryValue(value));
    }

    if (!url.searchParams.has("file_type")) {
      url.searchParams.set("file_type", "json");
    }

    url.searchParams.set("api_key", apiKey);

    return url;
  }

  private resolveTimeoutMs(): number {
    return env.PROVIDER_HTTP_TIMEOUT_MS;
  }
}
