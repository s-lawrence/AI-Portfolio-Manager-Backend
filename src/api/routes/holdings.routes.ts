import type { FastifyInstance } from "fastify";

import { notFound, runService } from "../errors";
import { created, deleted, ok, paginated } from "../response";
import {
  createHoldingBodySchema,
  holdingIdParamsSchema,
  holdingPortfolioIdParamsSchema,
  updateHoldingBodySchema,
} from "../schemas/holdings.schemas";
import {
  addTickerToPortfolio,
  getHoldingOverview,
  listPortfolioHoldings,
  removeHolding,
  updateHoldingDetails,
} from "../../services";

export async function holdingsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const body = createHoldingBodySchema.parse(request.body);

    const holding = await runService(() =>
      addTickerToPortfolio(body.portfolioId, body.ticker, {
        status: body.status,
        shares: body.shares,
        averageCost: body.averageCost,
        targetAllocation: body.targetAllocation,
        thesis: body.thesis,
        exitCriteria: body.exitCriteria,
        userNotes: body.userNotes,
      }),
    );

    reply.status(201).send(created(holding));
  });

  app.get("/:holdingId", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);
    const overview = await runService(() => getHoldingOverview(params.holdingId));

    if (!overview) {
      throw notFound("Holding not found.");
    }

    reply.send(ok(overview));
  });

  app.get("/portfolio/:portfolioId", async (request, reply) => {
    const params = holdingPortfolioIdParamsSchema.parse(request.params);
    const holdings = await runService(() => listPortfolioHoldings(params.portfolioId));

    reply.send(
      paginated(holdings, {
        total: holdings.length,
      }),
    );
  });

  app.patch("/:holdingId", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);
    const body = updateHoldingBodySchema.parse(request.body);

    const holding = await runService(() => updateHoldingDetails(params.holdingId, body));
    reply.send(ok(holding));
  });

  app.delete("/:holdingId", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);

    await runService(() => removeHolding(params.holdingId));
    reply.send(deleted());
  });
}
