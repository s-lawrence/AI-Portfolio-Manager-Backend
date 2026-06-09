import { z } from "zod";

import {
  booleanQuerySchema,
  cuidSchema,
  nonNegativeNumberSchema,
  optionalLimitSchema,
  tickerSchema,
  watchlistItemPrioritySchema,
  watchlistItemSourceSchema,
  watchlistItemStatusSchema,
} from "./common.schemas";

export const watchlistIdParamsSchema = z.object({
  watchlistId: cuidSchema,
});

export const userIdParamsSchema = z.object({
  userId: cuidSchema,
});

export const watchlistItemIdParamsSchema = z.object({
  itemId: cuidSchema,
});

export const createWatchlistBodySchema = z.object({
  userId: cuidSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  isDefault: z.boolean().optional(),
});

export const updateWatchlistBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional().nullable(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided.",
  });

export const addWatchlistItemBodySchema = z.object({
  ticker: tickerSchema,
  status: watchlistItemStatusSchema.optional(),
  priority: watchlistItemPrioritySchema.optional(),
  thesis: z.string().trim().min(1).optional(),
  riskNotes: z.string().trim().min(1).optional(),
  targetEntryPrice: nonNegativeNumberSchema.optional(),
  targetExitPrice: nonNegativeNumberSchema.optional(),
  targetAllocation: nonNegativeNumberSchema.optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  source: watchlistItemSourceSchema.optional(),
  addedReason: z.string().trim().min(1).optional(),
  rejectionReason: z.string().trim().min(1).optional(),
  convertedHoldingId: cuidSchema.optional(),
  lastReviewedAt: z.union([z.coerce.date(), z.string().datetime({ offset: true })]).optional(),
});

export const updateWatchlistItemBodySchema = z
  .object({
    status: watchlistItemStatusSchema.optional(),
    priority: watchlistItemPrioritySchema.optional(),
    thesis: z.string().trim().min(1).optional().nullable(),
    riskNotes: z.string().trim().min(1).optional().nullable(),
    targetEntryPrice: nonNegativeNumberSchema.optional().nullable(),
    targetExitPrice: nonNegativeNumberSchema.optional().nullable(),
    targetAllocation: nonNegativeNumberSchema.optional().nullable(),
    tags: z.array(z.string().trim().min(1)).optional(),
    source: watchlistItemSourceSchema.optional(),
    addedReason: z.string().trim().min(1).optional().nullable(),
    rejectionReason: z.string().trim().min(1).optional().nullable(),
    convertedHoldingId: cuidSchema.optional().nullable(),
    lastReviewedAt: z.union([z.coerce.date(), z.string().datetime({ offset: true })]).optional().nullable(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided.",
  });

export const refreshWatchlistResearchDataBodySchema = z.object({
  historicalLimit: optionalLimitSchema,
  newsLimitPerTicker: optionalLimitSchema,
  includeMarketData: booleanQuerySchema.optional(),
  includeFundamentals: booleanQuerySchema.optional(),
  includeEarnings: booleanQuerySchema.optional(),
  includeNews: booleanQuerySchema.optional(),
  includeAnalystData: booleanQuerySchema.optional(),
  runReports: booleanQuerySchema.optional(),
});
