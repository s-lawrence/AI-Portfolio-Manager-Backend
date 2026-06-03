import type { FastifyInstance } from "fastify";

import { ok, paginated } from "../response";
import { runService } from "../errors";
import {
  predictionByStockQuerySchema,
  predictionIdParamsSchema,
  predictionOutcomeBodySchema,
  predictionStockParamsSchema,
  predictionsDueQuerySchema,
  scoreDueBodySchema,
} from "../schemas/predictions.schemas";
import {
  calculatePredictionOutcome,
  listOpenPredictions,
  listPredictionsDueForOutcome,
  listPredictionsForTicker,
  scoreDuePredictions,
} from "../../services/predictions.service";

export async function predictionsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/open", async (_request, reply) => {
    const predictions = await runService(() => listOpenPredictions());

    return reply.send(
      paginated(predictions, {
        total: predictions.length,
      }),
    );
  });

  app.get("/due", async (request, reply) => {
    const query = predictionsDueQuerySchema.parse(request.query);

    const predictions = await runService(() =>
      listPredictionsDueForOutcome(query.asOfDate ?? new Date()),
    );

    return reply.send(
      paginated(predictions, {
        total: predictions.length,
      }),
    );
  });

  app.post("/:predictionId/calculate-outcome", async (request, reply) => {
    const params = predictionIdParamsSchema.parse(request.params);
    const body = predictionOutcomeBodySchema.parse(request.body ?? {});

    const result = await runService(() =>
      calculatePredictionOutcome(params.predictionId, body.asOfDate),
    );

    return reply.send(ok(result));
  });

  app.post("/score-due", async (request, reply) => {
    const body = scoreDueBodySchema.parse(request.body ?? {});

    const result = await runService(() => scoreDuePredictions(body.asOfDate));
    return reply.send(ok(result));
  });

  app.get("/stock/:ticker", async (request, reply) => {
    const params = predictionStockParamsSchema.parse(request.params);
    const query = predictionByStockQuerySchema.parse(request.query);

    const predictions = await runService(() =>
      listPredictionsForTicker(params.ticker, query.limit),
    );

    return reply.send(
      paginated(predictions, {
        total: predictions.length,
        limit: query.limit,
      }),
    );
  });
}
