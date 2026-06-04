import { env } from "../../config/env";
import {
  ProviderConfigurationError,
  ProviderRequestError,
  ProviderResponseError,
} from "../errors";

export const FMP_PROVIDER_NAME = "Financial Modeling Prep";

export type FmpJsonQueryValue = string | number | boolean | Date | null | undefined;

export type FmpJsonQuery = Record<string, FmpJsonQueryValue>;

export interface FmpClientOptions {
  baseUrl?: string;
  apiKey?: string;
  providerName?: string;
}

export interface FmpJsonClient {
  getJson<T>(path: string, query?: FmpJsonQuery): Promise<T>;
}

function stringifyQueryValue(value: Exclude<FmpJsonQueryValue, null | undefined>): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export class FmpClient implements FmpJsonClient {
  private readonly providerName: string;

  private readonly baseUrlOverride?: string;

  private readonly apiKeyOverride?: string;

  constructor(options: FmpClientOptions = {}) {
    this.providerName = options.providerName ?? FMP_PROVIDER_NAME;
    this.baseUrlOverride = options.baseUrl;
    this.apiKeyOverride = options.apiKey;
  }

  async getJson<T>(path: string, query: FmpJsonQuery = {}): Promise<T> {
    const endpoint = this.normalizeEndpoint(path);
    const apiKey = this.requireApiKey(endpoint);
    const url = this.buildUrl(endpoint, query, apiKey);

    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
    } catch (error) {
      throw new ProviderRequestError(
        this.providerName,
        `Request to ${this.providerName} failed.`,
        { endpoint, cause: error },
      );
    }

    if (!response.ok) {
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
      throw new ProviderRequestError(
        this.providerName,
        "Provider path is required.",
      );
    }

    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  private requireApiKey(endpoint: string): string {
    const apiKey = (this.apiKeyOverride ?? env.FMP_API_KEY)?.trim();

    if (!apiKey) {
      throw new ProviderConfigurationError(
        this.providerName,
        `${this.providerName} API key is not configured.`,
        { endpoint },
      );
    }

    return apiKey;
  }

  private buildUrl(endpoint: string, query: FmpJsonQuery, apiKey: string): URL {
    const baseUrl = this.baseUrlOverride ?? env.FMP_BASE_URL;
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    const base = new URL(normalizedBaseUrl);
    const url = new URL(endpoint.replace(/^\//, ""), base);

    for (const [key, value] of Object.entries(query)) {
      if (value == null) {
        continue;
      }

      url.searchParams.set(key, stringifyQueryValue(value));
    }

    url.searchParams.set("apikey", apiKey);

    return url;
  }
}