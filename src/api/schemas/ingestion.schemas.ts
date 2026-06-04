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

export const ingestTickerEarningsBodySchema = z.object({});

export const ingestPortfolioEarningsBodySchema = z.object({});

export const ingestTickerNewsBodySchema = z.object({
  limit: optionalLimitSchema,
});

export const ingestPortfolioNewsBodySchema = z.object({
  limitPerTicker: optionalLimitSchema,
});

export const ingestPortfolioFullBasicBodySchema = z.object({
  historicalLimit: optionalLimitSchema,
  runAnalysis: booleanQuerySchema.optional(),
});

export const ingestPortfolioFullRefreshBodySchema = z.object({
  historicalLimit: optionalLimitSchema,
  newsLimitPerTicker: optionalLimitSchema,
  includeEconomics: booleanQuerySchema.optional(),
  runAnalysis: booleanQuerySchema.optional(),
});