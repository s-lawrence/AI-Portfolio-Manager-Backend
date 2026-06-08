import type { FastifyInstance } from "fastify";

import {
  ingestDefaultMarketDiscoverySet,
  ingestMarketDiscovery,
  listDiscoveryCandidates,
} from "../../services";
import { runService } from "../errors";
import { ok } from "../response";
import {
  discoveryCategoryParamsSchema,
  discoveryDefaultSetBodySchema,
  discoveryListQuerySchema,
  discoveryRefreshBodySchema,
} from "../schemas/discovery.schemas";

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/fmp/:category/refresh", async (request, reply) => {
    const params = discoveryCategoryParamsSchema.parse(request.params);
    const body = discoveryRefreshBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestMarketDiscovery(params.category, {
        limit: body.limit,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/default-set", async (request, reply) => {
    const body = discoveryDefaultSetBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestDefaultMarketDiscoverySet({
        limit: body.limit,
      }),
    );

    reply.send(ok(result));
  });

  app.get("/:category", async (request, reply) => {
    const params = discoveryCategoryParamsSchema.parse(request.params);
    const query = discoveryListQuerySchema.parse(request.query ?? {});

    const result = await runService(() =>
      listDiscoveryCandidates(params.category, {
        limit: query.limit,
      }),
    );

    reply.send(ok(result));
  });
}
