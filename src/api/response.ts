export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface PaginationMeta {
  limit?: number;
  total?: number;
  offset?: number;
  [key: string]: unknown;
}

function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafeValue(item));
  }

  if (value instanceof Date || value == null) {
    return value;
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = toJsonSafeValue(nestedValue);
    }

    return result;
  }

  return value;
}

function jsonSafe<T>(value: T): T {
  return toJsonSafeValue(value) as T;
}

export function ok<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data: jsonSafe(data),
  };
}

export function created<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data: jsonSafe(data),
  };
}

export function deleted(): SuccessEnvelope<{ deleted: true }> {
  return {
    success: true,
    data: {
      deleted: true,
    },
  };
}

export function paginated<T>(
  data: T,
  meta: PaginationMeta,
): SuccessEnvelope<{ items: T; meta: PaginationMeta }> {
  return {
    success: true,
    data: jsonSafe({
      items: data,
      meta,
    }),
  };
}
