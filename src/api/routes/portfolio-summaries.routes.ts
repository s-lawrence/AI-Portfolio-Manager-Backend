import type { FastifyInstance } from "fastify";

import { assertPortfolioOwnership } from "../../auth";
import { notFound, runService } from "../errors";
import { created, ok, paginated } from "../response";
import {
  listPortfolioSummaryQuerySchema,
  portfolioSummaryParamsSchema,
} from "../schemas/portfolio-summaries.schemas";
import {
  generateMockPortfolioSummary,
  getLatestPortfolioSummary,
  listPortfolioSummaries,
} from "../../services/portfolio-summaries.service";

export async function portfolioSummariesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/:portfolioId/generate", async (request, reply) => {
    const params = portfolioSummaryParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    const summary = await runService(() =>
      generateMockPortfolioSummary(params.portfolioId),
    );

    return reply.code(201).send(created(summary));
  });

  app.get("/:portfolioId/latest", async (request, reply) => {
    const params = portfolioSummaryParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    const summary = await runService(() => getLatestPortfolioSummary(params.portfolioId));
    if (!summary) {
      throw notFound("Portfolio summary not found.");
    }

    return reply.send(ok(summary));
  });

  app.get("/:portfolioId", async (request, reply) => {
    const params = portfolioSummaryParamsSchema.parse(request.params);
    const query = listPortfolioSummaryQuerySchema.parse(request.query);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));

    const summaries = await runService(() =>
      listPortfolioSummaries(params.portfolioId, query.limit),
    );

    return reply.send(
      paginated(summaries, {
        total: summaries.length,
        limit: query.limit,
      }),
    );
  });
}
