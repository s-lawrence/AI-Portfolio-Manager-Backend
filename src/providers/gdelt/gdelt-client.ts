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

export interface GdeltJsonMetaResponse<T> {
  data: T;
  statusCode: number;
  elapsedMs: number;
  url: string;
  retryAttempted: boolean;
}

function stringifyQueryValue(value: Exclude<GdeltJsonQueryValue, null | undefined>): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  const trimmed = headerValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return undefined;
}

async function delayMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class GdeltClient implements GdeltJsonClient {
  constructor(
    private readonly baseUrl: string = env.GDELT_BASE_URL,
    private readonly providerName: string = GDELT_PROVIDER_NAME,
  ) {}

  async getJson<T>(path: string, query: GdeltJsonQuery = {}): Promise<T> {
    const response = await this.getJsonWithMeta<T>(path, query);
    return response.data;
  }

  async getJsonWithMeta<T>(path: string, query: GdeltJsonQuery = {}): Promise<GdeltJsonMetaResponse<T>> {
    const endpoint = this.normalizeEndpoint(path);
    const url = this.buildUrl(endpoint, query);
    const timeoutMs = env.GDELT_TIMEOUT_MS ?? env.PROVIDER_HTTP_TIMEOUT_MS;
    const maxRetry429 = env.GDELT_MAX_RETRY_429;
    let retryAttempted = false;
    const startedAt = Date.now();

    for (let attempt = 0; attempt <= maxRetry429; attempt += 1) {
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
        const statusCode = response.status;

        if (statusCode === 429 && attempt < maxRetry429) {
          retryAttempted = true;
          const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
          const fallbackDelayMs = Math.max(1000, env.GDELT_QUERY_DELAY_MS);
          await delayMs(retryAfterMs ?? fallbackDelayMs);
          continue;
        }

        throw new ProviderRequestError(
          this.providerName,
          `${this.providerName} request failed with status ${statusCode}.`,
          {
            endpoint,
            statusCode,
            cause: {
              retryAttempted,
              retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
            },
          },
        );
      }

      try {
        const data = (await response.json()) as T;

        return {
          data,
          statusCode: response.status,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          url: url.toString(),
          retryAttempted,
        };
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

    throw new ProviderRequestError(this.providerName, `${this.providerName} request failed.`, {
      endpoint,
      cause: { retryAttempted },
    });
  }

  buildUrlForPath(path: string, query: GdeltJsonQuery = {}): string {
    const endpoint = this.normalizeEndpoint(path);
    return this.buildUrl(endpoint, query).toString();
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
