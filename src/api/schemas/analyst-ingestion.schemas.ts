import { z } from "zod";

import { cuidSchema, optionalLimitSchema, tickerSchema } from "./common.schemas";

export const analystTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const analystPortfolioParamsSchema = z.object({
  portfolioId: cuidSchema,
});

export const analystWatchlistParamsSchema = z.object({
  watchlistId: cuidSchema,
});

export const analystActionsQuerySchema = z.object({
  limit: optionalLimitSchema,
});

export const analystIngestionBodySchema = z.object({});
