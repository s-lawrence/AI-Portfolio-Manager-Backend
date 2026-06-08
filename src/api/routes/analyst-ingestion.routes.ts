import type { FastifyInstance } from "fastify";

import {
  getLatestTickerAnalystSnapshot,
  ingestPortfolioAnalystData,
  ingestTickerAnalystData,
  ingestWatchlistAnalystData,
  listTickerAnalystActions,
} from "../../services";
import { notFound, runService } from "../errors";
import { ok } from "../response";
import {
  analystActionsQuerySchema,
  analystIngestionBodySchema,
  analystPortfolioParamsSchema,
  analystTickerParamsSchema,
  analystWatchlistParamsSchema,
} from "../schemas/analyst-ingestion.schemas";

export async function analystIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ingestion/fmp/ticker/:ticker/analyst", async (request, reply) => {
    const params = analystTickerParamsSchema.parse(request.params);
    analystIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestTickerAnalystData(params.ticker));

    reply.send(ok(result));
  });

  app.post("/ingestion/fmp/portfolio/:portfolioId/analyst", async (request, reply) => {
    const params = analystPortfolioParamsSchema.parse(request.params);
    analystIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestPortfolioAnalystData(params.portfolioId));

    reply.send(ok(result));
  });

  app.post("/ingestion/fmp/watchlist/:watchlistId/analyst", async (request, reply) => {
    const params = analystWatchlistParamsSchema.parse(request.params);
    analystIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestWatchlistAnalystData(params.watchlistId));

    reply.send(ok(result));
  });

  app.get("/analyst/:ticker/latest", async (request, reply) => {
    const params = analystTickerParamsSchema.parse(request.params);

    const snapshot = await runService(() => getLatestTickerAnalystSnapshot(params.ticker));
    if (!snapshot) {
      throw notFound("Analyst snapshot not found.");
    }

    reply.send(ok(snapshot));
  });

  app.get("/analyst/:ticker/actions", async (request, reply) => {
    const params = analystTickerParamsSchema.parse(request.params);
    const query = analystActionsQuerySchema.parse(request.query ?? {});

    const actions = await runService(() =>
      listTickerAnalystActions(params.ticker, query.limit),
    );

    reply.send(ok(actions));
  });
}
