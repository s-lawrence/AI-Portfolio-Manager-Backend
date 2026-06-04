import { z } from "zod";

import { booleanQuerySchema, cuidSchema, optionalLimitSchema, tickerSchema } from "./common.schemas";

export const ingestTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const ingestPortfolioParamsSchema = z.object({
  portfolioId: cuidSchema,
});

export const ingestTickerMarketDataBodySchema = z.object({
  historicalLimit: optionalLimitSchema,
});

export const ingestPortfolioMarketDataBodySchema = z.object({
  historicalLimit: optionalLimitSchema,
  runAnalysis: booleanQuerySchema.optional(),
});

export const ingestTickerFundamentalsBodySchema = z.object({});

export const ingestPortfolioFundamentalsBodySchema = z.object({});

export const ingestPortfolioFullBasicBodySchema = z.object({
  historicalLimit: optionalLimitSchema,
  runAnalysis: booleanQuerySchema.optional(),
});