import { z } from "zod";

import { cuidSchema, optionalLimitSchema } from "./common.schemas";

export const portfolioIdParamsSchema = z.object({
  portfolioId: cuidSchema,
});

export const userIdParamsSchema = z.object({
  userId: cuidSchema,
});

export const createPortfolioBodySchema = z.object({
  userId: cuidSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  baseCurrency: z.string().trim().min(1).max(10).optional(),
});

export const updatePortfolioBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    baseCurrency: z.string().trim().min(1).max(10).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided.",
  });

export const listPortfolioSummariesQuerySchema = z.object({
  limit: optionalLimitSchema,
});
