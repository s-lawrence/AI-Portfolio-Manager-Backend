import { z } from "zod";

import { cuidSchema, dateInputSchema, optionalLimitSchema, tickerSchema } from "./common.schemas";

export const predictionIdParamsSchema = z.object({
  predictionId: cuidSchema,
});

export const predictionsDueQuerySchema = z.object({
  asOfDate: dateInputSchema.optional(),
});

export const predictionOutcomeBodySchema = z.object({
  asOfDate: dateInputSchema.optional(),
});

export const scoreDueBodySchema = z.object({
  asOfDate: dateInputSchema.optional(),
});

export const predictionStockParamsSchema = z.object({
  ticker: tickerSchema,
});

export const predictionByStockQuerySchema = z.object({
  limit: optionalLimitSchema,
});
