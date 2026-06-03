export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface DateRangeOptions {
  from?: Date;
  to?: Date;
}

export interface RepositoryListOptions extends PaginationOptions, DateRangeOptions {}

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 500;

export function normalizeListLimit(
  limit?: number,
  fallback: number = DEFAULT_LIST_LIMIT,
): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }

  const normalized = Math.floor(limit);
  if (normalized <= 0) {
    return fallback;
  }

  return Math.min(normalized, MAX_LIST_LIMIT);
}

export function normalizeTickerOrThrow(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Ticker must be a non-empty string.");
  }

  return normalized;
}
