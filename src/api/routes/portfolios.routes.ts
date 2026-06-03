import type { FastifyInstance } from "fastify";

import { runService, notFound } from "../errors";
import { created, deleted, ok, paginated } from "../response";
import {
  createPortfolioBodySchema,
  portfolioIdParamsSchema,
  updatePortfolioBodySchema,
  userIdParamsSchema,
} from "../schemas/portfolios.schemas";
import {
  createPortfolioForUser,
  deletePortfolio,
  getPortfolioOverview,
  listUserPortfolios,
  updatePortfolioDetails,
  generateMockPortfolioSummary,
} from "../../services";

export async function portfoliosRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const body = createPortfolioBodySchema.parse(request.body);

    const portfolio = await runService(() =>
      createPortfolioForUser(body.userId, {
        name: body.name,
        description: body.description,
        baseCurrency: body.baseCurrency,
      }),
    );

    reply.status(201).send(created(portfolio));
  });

  app.get("/user/:userId", async (request, reply) => {
    const params = userIdParamsSchema.parse(request.params);
    const portfolios = await runService(() => listUserPortfolios(params.userId));

    reply.send(
      paginated(portfolios, {
        total: portfolios.length,
      }),
    );
  });

  app.get("/:portfolioId", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    const overview = await runService(() => getPortfolioOverview(params.portfolioId));

    if (!overview) {
      throw notFound("Portfolio not found.");
    }

    reply.send(ok(overview));
  });

  app.patch("/:portfolioId", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    const body = updatePortfolioBodySchema.parse(request.body);

    const portfolio = await runService(() =>
      updatePortfolioDetails(params.portfolioId, body),
    );

    reply.send(ok(portfolio));
  });

  app.delete("/:portfolioId", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);

    await runService(() => deletePortfolio(params.portfolioId));
    reply.send(deleted());
  });

  app.post("/:portfolioId/generate-summary", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);

    const summary = await runService(() =>
      generateMockPortfolioSummary(params.portfolioId),
    );

    reply.status(201).send(created(summary));
  });
}
