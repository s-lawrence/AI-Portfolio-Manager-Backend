import { env } from "../../config/env";
import {
  ProviderRequestError,
  ProviderResponseError,
} from "../errors";

export const GDELT_PROVIDER_NAME = "GDELT 2.0";

export const GDELT_FAILURE_CODES = {
  HTTP_ERROR: "GDELT_HTTP_ERROR",
  TIMEOUT: "GDELT_TIMEOUT",
  NON_JSON_RESPONSE: "GDELT_NON_JSON_RESPONSE",
  EMPTY_RESPONSE: "GDELT_EMPTY_RESPONSE",
  PARSE_ERROR: "GDELT_PARSE_ERROR",
  NO_RESULTS: "GDELT_NO_RESULTS",
} as const;

export type GdeltFailureCode =
  (typeof GDELT_FAILURE_CODES)[keyof typeof GDELT_FAILURE_CODES];

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
  responseDiagnostics?: GdeltResponseDiagnostics;
}

export interface GdeltResponseDiagnostics {
  statusCode?: number;
  contentType?: string | null;
  contentLength?: number;
  responsePreview?: string;
  retryAttempted?: boolean;
}

const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|token|key)=)[^&#\s]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /(\b(?:api[_-]?key|token|authorization|bearer)\b\s*[:=]\s*)[^\s,;]+/gi;
const DEFAULT_PREVIEW_MAX_CHARS = 320;

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

function sanitizePreviewText(value: string): string {
  return value
    .replace(SECRET_QUERY_PATTERN, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]");
}

function toSafePreview(value: string, maxChars: number = DEFAULT_PREVIEW_MAX_CHARS): string {
  const compact = sanitizePreviewText(value.replace(/\s+/g, " ").trim());
  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, maxChars)}...`;
}

function isLikelyJsonContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function isLikelyJsonBody(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseJsonSafely<T>(rawText: string): T {
  return JSON.parse(rawText) as T;
}

function shouldRetryHttpStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
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

        if (attempt < maxRetry429) {
          retryAttempted = true;
          await delayMs(Math.max(500, env.GDELT_QUERY_DELAY_MS));
          continue;
        }

        throw new ProviderRequestError(
          this.providerName,
          isTimeout
            ? `Request to ${this.providerName} timed out after ${timeoutMs}ms.`
            : `Request to ${this.providerName} failed.`,
          {
            endpoint,
            cause: {
              originalError: error,
              failureCode: isTimeout
                ? GDELT_FAILURE_CODES.TIMEOUT
                : GDELT_FAILURE_CODES.HTTP_ERROR,
              retryAttempted,
            },
          },
        );
      } finally {
        clearTimeout(timeoutHandle);
      }

      const contentType = response.headers.get("content-type");
      const rawText = await response.text();
      const trimmedText = rawText.trim();
      const diagnostics: GdeltResponseDiagnostics = {
        statusCode: response.status,
        contentType,
        contentLength: rawText.length,
        responsePreview: rawText ? toSafePreview(rawText) : undefined,
        retryAttempted,
      };

      if (!response.ok) {
        const statusCode = response.status;

        if (shouldRetryHttpStatus(statusCode) && attempt < maxRetry429) {
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
              failureCode: GDELT_FAILURE_CODES.HTTP_ERROR,
              retryAttempted,
              retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
              responseDiagnostics: diagnostics,
            },
          },
        );
      }

      if (!trimmedText) {
        throw new ProviderResponseError(
          this.providerName,
          `Empty response from ${this.providerName}.`,
          {
            endpoint,
            statusCode: response.status,
            cause: {
              failureCode: GDELT_FAILURE_CODES.EMPTY_RESPONSE,
              responseDiagnostics: diagnostics,
            },
          },
        );
      }

      const jsonByHeader = isLikelyJsonContentType(contentType);
      const jsonByBody = isLikelyJsonBody(trimmedText);

      if (!jsonByHeader && !jsonByBody) {
        throw new ProviderResponseError(
          this.providerName,
          `Non-JSON response from ${this.providerName}.`,
          {
            endpoint,
            statusCode: response.status,
            cause: {
              failureCode: GDELT_FAILURE_CODES.NON_JSON_RESPONSE,
              responseDiagnostics: diagnostics,
            },
          },
        );
      }

      try {
        const data = parseJsonSafely<T>(trimmedText);

        return {
          data,
          statusCode: response.status,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          url: url.toString(),
          retryAttempted,
          responseDiagnostics: diagnostics,
        };
      } catch (error) {
        throw new ProviderResponseError(
          this.providerName,
          `Invalid JSON response from ${this.providerName}.`,
          {
            endpoint,
            statusCode: response.status,
            cause: {
              originalError: error,
              failureCode: GDELT_FAILURE_CODES.PARSE_ERROR,
              responseDiagnostics: diagnostics,
            },
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
