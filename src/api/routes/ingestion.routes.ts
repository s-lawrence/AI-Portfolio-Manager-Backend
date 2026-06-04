import type { FastifyInstance } from "fastify";

import {
  ingestPortfolioFmpFullRefresh,
  ingestPortfolioFullBasic,
  ingestPortfolioEarnings,
  ingestPortfolioFundamentals,
  ingestPortfolioMarketData,
  ingestPortfolioNews,
  ingestTickerEarnings,
  ingestTickerFundamentals,
  ingestTickerMarketData,
  ingestTickerNews,
} from "../../services";
import { runService } from "../errors";
import { ok } from "../response";
import {
  ingestPortfolioFullRefreshBodySchema,
  ingestPortfolioFullBasicBodySchema,
  ingestPortfolioEarningsBodySchema,
  ingestPortfolioFundamentalsBodySchema,
  ingestPortfolioMarketDataBodySchema,
  ingestPortfolioNewsBodySchema,
  ingestPortfolioParamsSchema,
  ingestTickerEarningsBodySchema,
  ingestTickerFundamentalsBodySchema,
  ingestTickerMarketDataBodySchema,
  ingestTickerNewsBodySchema,
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

  app.post("/fmp/ticker/:ticker/earnings", async (request, reply) => {
    const params = ingestTickerParamsSchema.parse(request.params);
    ingestTickerEarningsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestTickerEarnings(params.ticker));

    reply.send(ok(result));
  });

  app.post("/fmp/portfolio/:portfolioId/earnings", async (request, reply) => {
    const params = ingestPortfolioParamsSchema.parse(request.params);
    ingestPortfolioEarningsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() => ingestPortfolioEarnings(params.portfolioId));

    reply.send(ok(result));
  });

  app.post("/fmp/ticker/:ticker/news", async (request, reply) => {
    const params = ingestTickerParamsSchema.parse(request.params);
    const body = ingestTickerNewsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestTickerNews(params.ticker, {
        limit: body.limit,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/portfolio/:portfolioId/news", async (request, reply) => {
    const params = ingestPortfolioParamsSchema.parse(request.params);
    const body = ingestPortfolioNewsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestPortfolioNews(params.portfolioId, {
        limitPerTicker: body.limitPerTicker,
      }),
    );

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

  app.post("/fmp/portfolio/:portfolioId/full-refresh", async (request, reply) => {
    const params = ingestPortfolioParamsSchema.parse(request.params);
    const body = ingestPortfolioFullRefreshBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestPortfolioFmpFullRefresh(params.portfolioId, {
        historicalLimit: body.historicalLimit,
        newsLimitPerTicker: body.newsLimitPerTicker,
        includeEconomics: body.includeEconomics,
        runAnalysis: body.runAnalysis,
      }),
    );

    reply.send(ok(result));
  });
}