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

export function ok<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data,
  };
}

export function created<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data,
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
    data: {
      items: data,
      meta,
    },
  };
}
