import type { FastifyInstance } from "fastify";

import { notFound, runService } from "../errors";
import { created, ok, paginated } from "../response";
import {
  earningsEventIdParamsSchema,
  earningsPortfolioParamsSchema,
  earningsTickerParamsSchema,
  recordEarningsBodySchema,
  updateEarningsBodySchema,
} from "../schemas/earnings.schemas";
import {
  getNextEarningsForTicker,
  listUpcomingPortfolioEarnings,
  recordEarningsEvent,
  updateEarningsEvent,
} from "../../services/earnings.service";

export async function earningsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/:ticker", async (request, reply) => {
    const params = earningsTickerParamsSchema.parse(request.params);
    const body = recordEarningsBodySchema.parse(request.body);

    const event = await runService(() => recordEarningsEvent(params.ticker, body));
    return reply.code(201).send(created(event));
  });

  app.patch("/events/:eventId", async (request, reply) => {
    const params = earningsEventIdParamsSchema.parse(request.params);
    const body = updateEarningsBodySchema.parse(request.body);

    const updated = await runService(() => updateEarningsEvent(params.eventId, body));
    return reply.send(ok(updated));
  });

  app.get("/:ticker/next", async (request, reply) => {
    const params = earningsTickerParamsSchema.parse(request.params);

    const event = await runService(() => getNextEarningsForTicker(params.ticker));
    if (!event) {
      throw notFound("Next earnings event not found.");
    }

    return reply.send(ok(event));
  });

  app.get("/portfolio/:portfolioId/upcoming", async (request, reply) => {
    const params = earningsPortfolioParamsSchema.parse(request.params);

    const upcoming = await runService(() => listUpcomingPortfolioEarnings(params.portfolioId));

    return reply.send(
      paginated(upcoming, {
        total: upcoming.length,
      }),
    );
  });
}
