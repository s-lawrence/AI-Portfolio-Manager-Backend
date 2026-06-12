import type { FastifyInstance } from "fastify";

import {
  assertPortfolioOwnership,
  assertReportTickerAccess,
  assertWatchlistOwnership,
} from "../../auth";
import { notFound, runService } from "../errors";
import { created, ok, paginated } from "../response";
import {
  createReportBodySchema,
  generateReportBodySchema,
  listReportsQuerySchema,
  reportTickerParamsSchema,
} from "../schemas/reports.schemas";
import {
  createTickerReportFromInput,
  generateTickerReport,
  getLatestTickerReport,
  listTickerReports,
} from "../../services/ai-reports.service";

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/:ticker/generate", async (request, reply) => {
    const params = reportTickerParamsSchema.parse(request.params);
    const body = generateReportBodySchema.parse(request.body ?? {});
    await runService(() => assertReportTickerAccess(request, params.ticker, body.holdingId));
    if (body.portfolioId) {
      const portfolioId = body.portfolioId;
      await runService(() => assertPortfolioOwnership(request, portfolioId));
    }
    if (body.watchlistId) {
      const watchlistId = body.watchlistId;
      await runService(() => assertWatchlistOwnership(request, watchlistId));
    }

    const result = await runService(() =>
      generateTickerReport(params.ticker, {
        holdingId: body.holdingId,
        portfolioId: body.portfolioId,
        watchlistId: body.watchlistId,
        useOpenAi: body.useOpenAi,
        refreshBeforeGenerate: body.refreshBeforeGenerate,
        includeMacro: body.includeMacro,
        includeGeopolitical: body.includeGeopolitical,
        includeNews: body.includeNews,
        includeAnalyst: body.includeAnalyst,
        includeScore: body.includeScore,
        createPredictions: body.createPredictions,
      }),
    );

    return reply.code(201).send(created(result));
  });

  app.post("/", async (request, reply) => {
    const body = createReportBodySchema.parse(request.body);
    await runService(() => assertReportTickerAccess(request, body.ticker, body.holdingId));

    const result = await runService(() => createTickerReportFromInput(body));
    return reply.code(201).send(created(result));
  });

  app.get("/:ticker/latest", async (request, reply) => {
    const params = reportTickerParamsSchema.parse(request.params);
    await runService(() => assertReportTickerAccess(request, params.ticker));

    const report = await runService(() => getLatestTickerReport(params.ticker));
    if (!report) {
      throw notFound("Ticker report not found.");
    }

    return reply.send(ok(report));
  });

  app.get("/:ticker", async (request, reply) => {
    const params = reportTickerParamsSchema.parse(request.params);
    const query = listReportsQuerySchema.parse(request.query);
    await runService(() => assertReportTickerAccess(request, params.ticker));

    const reports = await runService(() => listTickerReports(params.ticker, query.limit));

    return reply.send(
      paginated(reports, {
        total: reports.length,
        limit: query.limit,
      }),
    );
  });
}
