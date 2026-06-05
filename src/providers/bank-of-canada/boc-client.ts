import { env } from "../../config/env";
import { ProviderRateLimitError, ProviderRequestError, ProviderResponseError } from "../errors";

export const BANK_OF_CANADA_PROVIDER_NAME = "Bank of Canada Valet";

export type BocJsonQueryValue = string | number | boolean | Date | null | undefined;

export type BocJsonQuery = Record<string, BocJsonQueryValue>;

export interface BocClientOptions {
  baseUrl?: string;
  providerName?: string;
}

export interface BocJsonClient {
  getJson<T>(path: string, query?: BocJsonQuery): Promise<T>;
}

function formatDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stringifyQueryValue(value: Exclude<BocJsonQueryValue, null | undefined>): string {
  if (value instanceof Date) {
    return formatDateOnly(value);
  }

  return String(value);
}

export class BocClient implements BocJsonClient {
  private readonly providerName: string;

  private readonly baseUrlOverride?: string;

  constructor(options: BocClientOptions = {}) {
    this.providerName = options.providerName ?? BANK_OF_CANADA_PROVIDER_NAME;
    this.baseUrlOverride = options.baseUrl;
  }

  async getJson<T>(path: string, query: BocJsonQuery = {}): Promise<T> {
    const endpoint = this.normalizeEndpoint(path);
    const url = this.buildUrl(endpoint, query);
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
      throw new ProviderRequestError(
        this.providerName,
        "Provider path is required.",
      );
    }

    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  private buildUrl(endpoint: string, query: BocJsonQuery): URL {
    const baseUrl = this.baseUrlOverride ?? env.BANK_OF_CANADA_BASE_URL;
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    const base = new URL(normalizedBaseUrl);
    const url = new URL(endpoint.replace(/^\//, ""), base);

    for (const [key, value] of Object.entries(query)) {
      if (value == null) {
        continue;
      }

      url.searchParams.set(key, stringifyQueryValue(value));
    }

    return url;
  }

  private resolveTimeoutMs(): number {
    return env.PROVIDER_HTTP_TIMEOUT_MS;
  }
}
