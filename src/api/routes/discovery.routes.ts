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
        minPrice: body.minPrice,
        minVolume: body.minVolume,
        minMarketCap: body.minMarketCap,
        maxChangePercent: body.maxChangePercent,
        exchanges: body.exchanges,
        excludeOtc: body.excludeOtc,
        excludeLowPrice: body.excludeLowPrice,
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
        minPrice: body.minPrice,
        minVolume: body.minVolume,
        minMarketCap: body.minMarketCap,
        maxChangePercent: body.maxChangePercent,
        exchanges: body.exchanges,
        excludeOtc: body.excludeOtc,
        excludeLowPrice: body.excludeLowPrice,
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
        minPrice: query.minPrice,
        minVolume: query.minVolume,
        minMarketCap: query.minMarketCap,
        maxChangePercent: query.maxChangePercent,
        exchanges: query.exchanges,
        excludeOtc: query.excludeOtc,
        excludeLowPrice: query.excludeLowPrice,
      }),
    );

    reply.send(ok(result));
  });
}
