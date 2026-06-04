export interface ProviderErrorOptions {
  endpoint?: string;
  statusCode?: number;
  cause?: unknown;
}

const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|token|key)=)[^&#\s]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /(\b(?:api[_-]?key|token)\b\s*[:=]\s*)[^\s,;]+/gi;

function sanitizeProviderText(value: string): string {
  return value
    .replace(SECRET_QUERY_PATTERN, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]");
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly endpoint?: string;
  readonly statusCode?: number;

  constructor(
    name: string,
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      sanitizeProviderText(message),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = name;
    this.provider = provider;
    this.endpoint =
      options.endpoint === undefined
        ? undefined
        : sanitizeProviderText(options.endpoint);
    this.statusCode = options.statusCode;
  }
}

export class ProviderConfigurationError extends ProviderError {
  constructor(
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super("ProviderConfigurationError", provider, message, options);
  }
}

export class ProviderRequestError extends ProviderError {
  constructor(
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super("ProviderRequestError", provider, message, options);
  }
}

export class ProviderNotFoundError extends ProviderError {
  constructor(
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super("ProviderNotFoundError", provider, message, {
      ...options,
      statusCode: options.statusCode ?? 404,
    });
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super("ProviderRateLimitError", provider, message, {
      ...options,
      statusCode: options.statusCode ?? 429,
    });
  }
}

export class ProviderResponseError extends ProviderError {
  constructor(
    provider: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super("ProviderResponseError", provider, message, options);
  }
}