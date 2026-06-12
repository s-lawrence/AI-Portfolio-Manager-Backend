import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { AgentToolExecutionError } from "../agent/agent-tool.types";
import { env } from "../config/env";
import {
  ProviderConfigurationError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderResponseError,
} from "../providers/errors";
import { type ErrorEnvelope } from "./response";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, "BAD_REQUEST", message, details);
}

export function unauthorized(message: string = "Authentication required."): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message: string = "Forbidden."): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function conflict(message: string): ApiError {
  return new ApiError(409, "CONFLICT", message);
}

export function internalError(message: string): ApiError {
  return new ApiError(500, "INTERNAL_ERROR", message);
}

function providerErrorDetails(error: {
  provider: string;
  endpoint?: string;
  statusCode?: number;
}): {
  provider: string;
  endpoint?: string;
  statusCode?: number;
} {
  return {
    provider: error.provider,
    endpoint: error.endpoint,
    statusCode: error.statusCode,
  };
}

export function mapKnownError(error: unknown): Error {
  if (error instanceof ApiError || error instanceof ZodError) {
    return error;
  }

  if (error instanceof AgentToolExecutionError) {
    return new ApiError(error.statusCode, error.code, error.message, error.details);
  }

  if (error instanceof ProviderConfigurationError) {
    return badRequest(error.message, providerErrorDetails(error));
  }

  if (error instanceof ProviderNotFoundError) {
    return notFound(error.message);
  }

  if (error instanceof ProviderRateLimitError) {
    return new ApiError(429, "PROVIDER_RATE_LIMIT", error.message, providerErrorDetails(error));
  }

  if (error instanceof ProviderRequestError) {
    return new ApiError(
      502,
      "PROVIDER_REQUEST_ERROR",
      error.message,
      providerErrorDetails(error),
    );
  }

  if (error instanceof ProviderResponseError) {
    return new ApiError(
      502,
      "PROVIDER_RESPONSE_ERROR",
      error.message,
      providerErrorDetails(error),
    );
  }

  if (error instanceof Error) {
    const message = error.message;

    if (/not found/i.test(message)) {
      return notFound(message);
    }

    if (/already exists|duplicate|unique/i.test(message)) {
      return conflict(message);
    }

    if (/required|must be|invalid|cannot|does not match/i.test(message)) {
      return badRequest(message);
    }

    return error;
  }

  return internalError("An unexpected error occurred.");
}

export async function runService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapKnownError(error);
  }
}

function logError(request: FastifyRequest, logger: FastifyBaseLogger, error: unknown): void {
  if (logger && logger !== request.log) {
    logger.error(error);
    return;
  }

  request.log.error(error);
}

export function registerApiErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method}:${request.url} not found.`,
      },
    } satisfies ErrorEnvelope);
  });

  app.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const mapped = mapKnownError(error);

      if (mapped instanceof ZodError) {
        const payload: ErrorEnvelope = {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request payload.",
            details: mapped.flatten(),
          },
        };

        reply.status(400).send(payload);
        return;
      }

      if (mapped instanceof ApiError) {
        const payload: ErrorEnvelope = {
          success: false,
          error: {
            code: mapped.code,
            message: mapped.message,
            details: mapped.details,
          },
        };

        if (mapped.statusCode >= 500) {
          logError(request, app.log, mapped);
        }

        reply.status(mapped.statusCode).send(payload);
        return;
      }

      const message =
        env.NODE_ENV === "production"
          ? "Internal server error."
          : mapped instanceof Error
            ? mapped.message
            : "Internal server error.";

      const payload: ErrorEnvelope = {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message,
          details:
            env.NODE_ENV === "production"
              ? undefined
              : mapped instanceof Error
                ? { stack: mapped.stack }
                : undefined,
        },
      };

      logError(request, app.log, mapped);
      reply.status(500).send(payload);
    },
  );
}
