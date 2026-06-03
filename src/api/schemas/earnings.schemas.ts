import { z } from "zod";

import { cuidSchema, dateInputSchema, numericLikeSchema, tickerSchema } from "./common.schemas";

export const earningsTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const earningsEventIdParamsSchema = z.object({
  eventId: cuidSchema,
});

export const earningsPortfolioParamsSchema = z.object({
  portfolioId: cuidSchema,
});

export const recordEarningsBodySchema = z.object({
  fiscalQuarter: z.string().trim().min(1).optional(),
  fiscalYear: z.number().int().optional(),
  earningsDate: dateInputSchema.optional(),
  earningsTime: z.string().trim().min(1).optional(),
  isDateConfirmed: z.boolean().optional(),
  estimatedEps: z.number().finite().optional(),
  reportedEps: z.number().finite().optional(),
  epsSurprise: z.number().finite().optional(),
  estimatedRevenue: numericLikeSchema.optional(),
  reportedRevenue: numericLikeSchema.optional(),
  revenueSurprise: z.number().finite().optional(),
  guidanceSummary: z.string().trim().min(1).optional(),
  earningsCallUrl: z.string().trim().url().optional(),
  transcriptUrl: z.string().trim().url().optional(),
});

export const updateEarningsBodySchema = recordEarningsBodySchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  {
    message: "At least one field must be provided.",
  },
);
