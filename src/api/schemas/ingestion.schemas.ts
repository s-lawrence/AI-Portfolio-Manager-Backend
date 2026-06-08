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
  includeAnalystData: booleanQuerySchema.optional(),
  includeGdelt: booleanQuerySchema.optional(),
  gdeltMaxRecordsPerQuery: optionalLimitSchema,
  gdeltLookbackDays: z.coerce.number().int().min(1).max(3650).optional(),
  includeEconomics: booleanQuerySchema.optional(),
  includeBankOfCanada: booleanQuerySchema.optional(),
  includeFred: booleanQuerySchema.optional(),
  economicsCalendarPastDays: z.coerce.number().int().min(0).max(3650).optional(),
  economicsCalendarFutureDays: z.coerce.number().int().min(0).max(3650).optional(),
  fredObservationLimit: optionalLimitSchema,
  bocObservationLimit: optionalLimitSchema,
  macroMaxSeries: optionalLimitSchema,
  refreshMode: z.enum(["quick", "full"]).optional(),
  runAnalysis: booleanQuerySchema.optional(),
});