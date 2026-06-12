import type { FastifyInstance, FastifyRequest } from "fastify";

import { isAuthEnabled, requireAuth } from "../../auth";
import {
  getGeopoliticalSummary,
  getLatestGeopoliticalContext,
  ingestDefaultGdeltRiskSet,
  ingestGdeltQuery,
} from "../../services";
import { runService } from "../errors";
import { ok } from "../response";
import {
  geopoliticalDefaultRiskBodySchema,
  geopoliticalLatestQuerySchema,
  geopoliticalQueryBodySchema,
  geopoliticalSummaryQuerySchema,
} from "../schemas/geopolitical.schemas";

async function enforceGeopoliticalRefreshAccess(request: FastifyRequest): Promise<void> {
  if (!isAuthEnabled()) {
    return;
  }

  await requireAuth(request);
}

export async function geopoliticalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ingestion/gdelt/query", async (request, reply) => {
    await runService(() => enforceGeopoliticalRefreshAccess(request));
    const body = geopoliticalQueryBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestGdeltQuery(body.query, {
        from: body.from,
        to: body.to,
        maxRecords: body.maxRecords,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/ingestion/gdelt/default-risk-set", async (request, reply) => {
    await runService(() => enforceGeopoliticalRefreshAccess(request));
    const body = geopoliticalDefaultRiskBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const mergedQueries = body.includeDefaults === false ? (body.queries ?? []) : body.queries;

    const result = await runService(() =>
      ingestDefaultGdeltRiskSet({
        from: body.from,
        to: body.to,
        maxRecordsPerQuery: body.maxRecordsPerQuery,
        maxRecords: body.maxRecords,
        mode: body.mode,
        queries: mergedQueries,
      }),
    );

    reply.send(ok(result));
  });

  app.get("/geopolitical/latest", async (request, reply) => {
    const query = geopoliticalLatestQuerySchema.parse(request.query ?? {});

    const result = await runService(() =>
      getLatestGeopoliticalContext({
        limit: query.limit,
        days: query.days,
      }),
    );

    reply.send(ok(result));
  });

  app.get("/geopolitical/summary", async (request, reply) => {
    const query = geopoliticalSummaryQuerySchema.parse(request.query ?? {});

    const result = await runService(() =>
      getGeopoliticalSummary({
        days: query.days,
        limit: query.limit,
      }),
    );

    reply.send(ok(result));
  });
}
