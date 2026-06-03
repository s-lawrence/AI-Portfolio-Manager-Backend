import type { FastifyInstance } from "fastify";

import { notFound, runService } from "../errors";
import { created, ok, paginated } from "../response";
import {
  marketDataHistoryQuerySchema,
  marketDataTickerParamsSchema,
  recordMarketSnapshotBodySchema,
} from "../schemas/market-data.schemas";
import {
  getHistoricalPrices,
  getLatestMarketSnapshot,
  recordPriceSnapshot,
} from "../../services";

export async function marketDataRoutes(app: FastifyInstance): Promise<void> {
  app.post("/:ticker/snapshots", async (request, reply) => {
    const params = marketDataTickerParamsSchema.parse(request.params);
    const body = recordMarketSnapshotBodySchema.parse(request.body);

    const snapshot = await runService(() => recordPriceSnapshot(params.ticker, body));
    reply.status(201).send(created(snapshot));
  });

  app.get("/:ticker/latest", async (request, reply) => {
    const params = marketDataTickerParamsSchema.parse(request.params);
    const snapshot = await runService(() => getLatestMarketSnapshot(params.ticker));

    if (!snapshot) {
      throw notFound("Latest market snapshot not found.");
    }

    reply.send(ok(snapshot));
  });

  app.get("/:ticker/history", async (request, reply) => {
    const params = marketDataTickerParamsSchema.parse(request.params);
    const query = marketDataHistoryQuerySchema.parse(request.query);

    const snapshots = await runService(() => getHistoricalPrices(params.ticker, query.limit));

    reply.send(
      paginated(snapshots, {
        total: snapshots.length,
        limit: query.limit,
      }),
    );
  });
}
