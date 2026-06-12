import type { FastifyInstance } from "fastify";

import {
  assertPortfolioOwnership,
  isAuthEnabled,
  resolveUserIdForRequest,
} from "../../auth";
import { runService, notFound } from "../errors";
import { created, deleted, ok, paginated } from "../response";
import {
  createPortfolioBodySchema,
  createPortfolioRouteBodySchema,
  portfolioIdParamsSchema,
  updatePortfolioBodySchema,
  userIdParamsSchema,
} from "../schemas/portfolios.schemas";
import {
  createPortfolioForUser,
  deletePortfolio,
  getPortfolioOverview,
  listUserPortfolios,
  runPortfolioAnalysis,
  updatePortfolioDetails,
  generateMockPortfolioSummary,
} from "../../services";

export async function portfoliosRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const body = createPortfolioRouteBodySchema.parse(request.body);

    // Preserve legacy validation semantics when auth is disabled.
    if (!isAuthEnabled()) {
      createPortfolioBodySchema.parse(body);
    }

    const userId = await runService(() => resolveUserIdForRequest(request, body.userId));

    const portfolio = await runService(() =>
      createPortfolioForUser(userId, {
        name: body.name,
        description: body.description,
        baseCurrency: body.baseCurrency,
      }),
    );

    reply.status(201).send(created(portfolio));
  });

  app.get("/user/:userId", async (request, reply) => {
    const params = userIdParamsSchema.parse(request.params);
    const userId = await runService(() => resolveUserIdForRequest(request, params.userId));
    const portfolios = await runService(() => listUserPortfolios(userId));

    reply.send(
      paginated(portfolios, {
        total: portfolios.length,
      }),
    );
  });

  app.get("/:portfolioId", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));
    const overview = await runService(() => getPortfolioOverview(params.portfolioId));

    if (!overview) {
      throw notFound("Portfolio not found.");
    }

    reply.send(ok(overview));
  });

  app.patch("/:portfolioId", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    const body = updatePortfolioBodySchema.parse(request.body);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    const portfolio = await runService(() =>
      updatePortfolioDetails(params.portfolioId, body),
    );

    reply.send(ok(portfolio));
  });

  app.delete("/:portfolioId", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    await runService(() => deletePortfolio(params.portfolioId));
    reply.send(deleted());
  });

  app.post("/:portfolioId/generate-summary", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    const summary = await runService(() =>
      generateMockPortfolioSummary(params.portfolioId),
    );

    reply.status(201).send(created(summary));
  });

  app.post("/:portfolioId/run-analysis", async (request, reply) => {
    const params = portfolioIdParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    const result = await runService(() => runPortfolioAnalysis(params.portfolioId));
    reply.send(ok(result));
  });
}
