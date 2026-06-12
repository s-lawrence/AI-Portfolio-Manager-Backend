import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { registerRoutes } from "./api/routes";
import { registerApiErrorHandler } from "./api/errors";
import { env } from "./config/env";

function resolveTrustedCorsOrigins(): string[] {
  const configured = [
    env.FRONTEND_ORIGIN,
    env.FRONTEND_BASE_URL,
    ...(env.CORS_ALLOWED_ORIGINS ?? "").split(","),
  ];

  const origins = [...new Set(
    configured
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];

  if (origins.includes("*")) {
    throw new Error("CORS wildcard origin is not allowed when credentials are enabled.");
  }

  return origins;
}

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  const localFallbackCookieSecret = "dev-local-auth-session-secret";
  const cookieSecret =
    env.AUTH_SESSION_SECRET ??
    (env.NODE_ENV === "production" ? undefined : localFallbackCookieSecret);

  if (env.AUTH_ENABLED && !cookieSecret) {
    throw new Error("AUTH_SESSION_SECRET is required when AUTH_ENABLED=true.");
  }

  const authCookieSecure =
    typeof env.AUTH_COOKIE_SECURE === "boolean"
      ? env.AUTH_COOKIE_SECURE
      : env.NODE_ENV === "production";
  const authCookieSameSite = env.AUTH_COOKIE_SAME_SITE ?? "lax";

  if (env.AUTH_ENABLED && env.NODE_ENV === "production" && !authCookieSecure) {
    throw new Error("AUTH_COOKIE_SECURE must be true when AUTH_ENABLED=true in production.");
  }

  if (authCookieSameSite === "none" && !authCookieSecure) {
    throw new Error("AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true.");
  }

  const trustedCorsOrigins = resolveTrustedCorsOrigins();

  app.register(cookie, cookieSecret ? { secret: cookieSecret } : {});

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, trustedCorsOrigins.includes(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  if (options.logger) {
    app.addHook("onRequest", async (request) => {
      request.log.info({ method: request.method, url: request.url }, "incoming request");
    });
  }

  app.register(registerRoutes);
  registerApiErrorHandler(app);

  return app;
}
