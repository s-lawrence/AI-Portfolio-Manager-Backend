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
