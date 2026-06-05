import type { FastifyInstance } from "fastify";

import {
  ingestBankOfCanadaSeries,
  ingestBankOfCanadaUsdCad,
  ingestDefaultFredMacroSet,
  ingestDefaultMacroAndFx,
  ingestFredSeries,
} from "../../services";
import { runService } from "../errors";
import { ok } from "../response";
import {
  macroIngestionBodySchema,
  macroSeriesParamsSchema,
} from "../schemas/macro-ingestion.schemas";

export async function macroIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/macro/boc/usd-cad", async (request, reply) => {
    const body = macroIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestBankOfCanadaUsdCad(body));

    reply.send(ok(result));
  });

  app.post("/macro/boc/series/:seriesId", async (request, reply) => {
    const params = macroSeriesParamsSchema.parse(request.params);
    const body = macroIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestBankOfCanadaSeries(params.seriesId, body));

    reply.send(ok(result));
  });

  app.post("/macro/fred/:seriesId", async (request, reply) => {
    const params = macroSeriesParamsSchema.parse(request.params);
    const body = macroIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestFredSeries(params.seriesId, body));

    reply.send(ok(result));
  });

  app.post("/macro/fred/default-set", async (request, reply) => {
    const body = macroIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestDefaultFredMacroSet(body));

    reply.send(ok(result));
  });

  app.post("/macro/default", async (request, reply) => {
    const body = macroIngestionBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestDefaultMacroAndFx({
        from: body.from,
        to: body.to,
        limit: body.limit,
        includeBankOfCanada: true,
        includeFred: true,
      }),
    );

    reply.send(ok(result));
  });
}
