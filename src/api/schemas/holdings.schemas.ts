import { z } from "zod";

import {
  cuidSchema,
  holdingStatusSchema,
  nonNegativeNumberSchema,
  tickerSchema,
} from "./common.schemas";

export const holdingIdParamsSchema = z.object({
  holdingId: cuidSchema,
});

export const holdingPortfolioIdParamsSchema = z.object({
  portfolioId: cuidSchema,
});

export const createHoldingBodySchema = z.object({
  portfolioId: cuidSchema,
  ticker: tickerSchema,
  status: holdingStatusSchema.optional(),
  shares: nonNegativeNumberSchema.optional(),
  averageCost: nonNegativeNumberSchema.optional(),
  targetAllocation: nonNegativeNumberSchema.optional(),
  thesis: z.string().trim().min(1).optional(),
  exitCriteria: z.string().trim().min(1).optional(),
  userNotes: z.string().trim().min(1).optional(),
});

export const updateHoldingBodySchema = z
  .object({
    status: holdingStatusSchema.optional(),
    shares: nonNegativeNumberSchema.optional(),
    averageCost: nonNegativeNumberSchema.optional(),
    targetAllocation: nonNegativeNumberSchema.optional(),
    thesis: z.string().trim().min(1).optional(),
    exitCriteria: z.string().trim().min(1).optional(),
    userNotes: z.string().trim().min(1).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided.",
  });

export const correctHoldingStockBodySchema = z
  .object({
    stockId: cuidSchema.optional(),
    ticker: tickerSchema.optional(),
    companyName: z.string().trim().min(1).optional(),
    exchange: z.string().trim().min(1).max(20).optional(),
    currency: z.string().trim().min(1).max(10).optional(),
    country: z.string().trim().min(1).max(10).optional(),
    provider: z.string().trim().min(1).max(40).optional(),
    refreshAfterCorrection: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    const hasStockId = typeof value.stockId === "string" && value.stockId.trim().length > 0;
    const hasTicker = typeof value.ticker === "string" && value.ticker.trim().length > 0;

    if (!hasStockId && !hasTicker) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either stockId or ticker is required.",
      });
      return;
    }

    if (hasStockId && hasTicker) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either stockId or ticker, not both.",
      });
    }
  });
