import type { FastifyInstance } from "fastify";

import { internalError } from "../errors";
import { ok } from "../response";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";

function hasConfiguredValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    reply.send(
      ok({
        status: "ok",
        service: "portfolio-ai-backend",
        timestamp: new Date().toISOString(),
      }),
    );
  });

  app.get("/dependencies", async (_request, reply) => {
    const databaseOk = await isDatabaseReachable();

    reply.send(
      ok({
        status: databaseOk ? "ok" : "degraded",
        service: "portfolio-ai-backend",
        timestamp: new Date().toISOString(),
        dependencies: {
          database: {
            ok: databaseOk,
          },
          providerConfig: {
            fmpApiKeyConfigured: hasConfiguredValue(env.FMP_API_KEY),
            fredApiKeyConfigured: hasConfiguredValue(env.FRED_API_KEY),
            gdeltBaseUrlConfigured: hasConfiguredValue(env.GDELT_BASE_URL),
            bankOfCanadaBaseUrlConfigured: hasConfiguredValue(env.BANK_OF_CANADA_BASE_URL),
            providerHttpTimeoutMs: env.PROVIDER_HTTP_TIMEOUT_MS,
          },
          openAi: {
            enabled: env.OPENAI_AGENT_PROVIDER_ENABLED,
            apiKeyConfigured: hasConfiguredValue(env.OPENAI_API_KEY),
            maxToolCalls: env.OPENAI_AGENT_MAX_TOOL_CALLS,
            maxCompletionTokens: env.OPENAI_AGENT_MAX_COMPLETION_TOKENS ?? null,
          },
          auth: {
            enabled: env.AUTH_ENABLED,
            googleOAuthConfigured:
              hasConfiguredValue(env.GOOGLE_CLIENT_ID) &&
              hasConfiguredValue(env.GOOGLE_CLIENT_SECRET) &&
              hasConfiguredValue(env.GOOGLE_REDIRECT_URI),
            sessionSecretConfigured: hasConfiguredValue(env.AUTH_SESSION_SECRET),
          },
        },
      }),
    );
  });

  app.get("/db", async (_request, reply) => {
    const databaseOk = await isDatabaseReachable();
    if (!databaseOk) {
      throw internalError("Database is unreachable.");
    }

    reply.send(
      ok({
        status: "ok",
        database: "reachable",
        timestamp: new Date().toISOString(),
      }),
    );
  });
}
