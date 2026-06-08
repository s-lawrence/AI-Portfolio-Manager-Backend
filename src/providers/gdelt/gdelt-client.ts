import { env } from "../../config/env";
import {
  ProviderRequestError,
  ProviderResponseError,
} from "../errors";

export const GDELT_PROVIDER_NAME = "GDELT 2.0";

export type GdeltJsonQueryValue = string | number | boolean | Date | null | undefined;
export type GdeltJsonQuery = Record<string, GdeltJsonQueryValue>;

export interface GdeltJsonClient {
  getJson<T>(path: string, query?: GdeltJsonQuery): Promise<T>;
}

function stringifyQueryValue(value: Exclude<GdeltJsonQueryValue, null | undefined>): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export class GdeltClient implements GdeltJsonClient {
  constructor(
    private readonly baseUrl: string = env.GDELT_BASE_URL,
    private readonly providerName: string = GDELT_PROVIDER_NAME,
  ) {}

  async getJson<T>(path: string, query: GdeltJsonQuery = {}): Promise<T> {
    const endpoint = this.normalizeEndpoint(path);
    const url = this.buildUrl(endpoint, query);
    const timeoutMs = env.GDELT_TIMEOUT_MS ?? env.PROVIDER_HTTP_TIMEOUT_MS;

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

  private buildUrl(endpoint: string, query: GdeltJsonQuery): URL {
    const normalizedBaseUrl = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;

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
}
