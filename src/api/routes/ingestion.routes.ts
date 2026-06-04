import type { FastifyInstance } from "fastify";

import {
  ingestPortfolioFullBasic,
  ingestPortfolioFundamentals,
  ingestPortfolioMarketData,
  ingestTickerFundamentals,
  ingestTickerMarketData,
} from "../../services";
import { runService } from "../errors";
import { ok } from "../response";
import {
  ingestPortfolioFullBasicBodySchema,
  ingestPortfolioFundamentalsBodySchema,
  ingestPortfolioMarketDataBodySchema,
  ingestPortfolioParamsSchema,
  ingestTickerFundamentalsBodySchema,
  ingestTickerMarketDataBodySchema,
  ingestTickerParamsSchema,
} from "../schemas/ingestion.schemas";

export async function ingestionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/fmp/ticker/:ticker/market-data", async (request, reply) => {
    const params = ingestTickerParamsSchema.parse(request.params);
    const body = ingestTickerMarketDataBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestTickerMarketData(params.ticker, {
        historicalLimit: body.historicalLimit,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/portfolio/:portfolioId/market-data", async (request, reply) => {
    const params = ingestPortfolioParamsSchema.parse(request.params);
    const body = ingestPortfolioMarketDataBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestPortfolioMarketData(params.portfolioId, {
        historicalLimit: body.historicalLimit,
        runAnalysis: body.runAnalysis,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/ticker/:ticker/fundamentals", async (request, reply) => {
    const params = ingestTickerParamsSchema.parse(request.params);
    ingestTickerFundamentalsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestTickerFundamentals(params.ticker));

    reply.send(ok(result));
  });

  app.post("/fmp/portfolio/:portfolioId/fundamentals", async (request, reply) => {
    const params = ingestPortfolioParamsSchema.parse(request.params);
    ingestPortfolioFundamentalsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestPortfolioFundamentals(params.portfolioId));

    reply.send(ok(result));
  });

  app.post("/fmp/portfolio/:portfolioId/full-basic", async (request, reply) => {
    const params = ingestPortfolioParamsSchema.parse(request.params);
    const body = ingestPortfolioFullBasicBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestPortfolioFullBasic(params.portfolioId, {
        historicalLimit: body.historicalLimit,
        runAnalysis: body.runAnalysis,
      }),
    );

    reply.send(ok(result));
  });
}