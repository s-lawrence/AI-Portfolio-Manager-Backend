import type { FastifyInstance } from "fastify";

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
  generateMockTickerReport,
  getLatestTickerReport,
  listTickerReports,
} from "../../services/ai-reports.service";

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/:ticker/generate", async (request, reply) => {
    const params = reportTickerParamsSchema.parse(request.params);
    const body = generateReportBodySchema.parse(request.body ?? {});

    const result = await runService(() =>
      generateMockTickerReport(params.ticker, body.holdingId),
    );

    return reply.code(201).send(created(result));
  });

  app.post("/", async (request, reply) => {
    const body = createReportBodySchema.parse(request.body);

    const result = await runService(() => createTickerReportFromInput(body));
    return reply.code(201).send(created(result));
  });

  app.get("/:ticker/latest", async (request, reply) => {
    const params = reportTickerParamsSchema.parse(request.params);

    const report = await runService(() => getLatestTickerReport(params.ticker));
    if (!report) {
      throw notFound("Ticker report not found.");
    }

    return reply.send(ok(report));
  });

  app.get("/:ticker", async (request, reply) => {
    const params = reportTickerParamsSchema.parse(request.params);
    const query = listReportsQuerySchema.parse(request.query);

    const reports = await runService(() => listTickerReports(params.ticker, query.limit));

    return reply.send(
      paginated(reports, {
        total: reports.length,
        limit: query.limit,
      }),
    );
  });
}
