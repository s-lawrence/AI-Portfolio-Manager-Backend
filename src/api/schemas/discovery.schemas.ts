import { z } from "zod";

import { booleanQuerySchema, optionalLimitSchema } from "./common.schemas";

const optionalNonNegativeNumberSchema = z.coerce.number().nonnegative().optional();

export const discoveryCategorySchema = z
  .enum([
    "GAINERS",
    "LOSERS",
    "ACTIVE",
    "ANALYST_UPGRADES",
    "ANALYST_DOWNGRADES",
  ])
  .or(z.string().trim().min(1).transform((value) => value.toUpperCase()));

export const discoveryCategoryParamsSchema = z.object({
  category: discoveryCategorySchema,
});

export const discoveryRefreshBodySchema = z.object({
  limit: optionalLimitSchema,
  minPrice: optionalNonNegativeNumberSchema,
  minVolume: optionalNonNegativeNumberSchema,
  minMarketCap: optionalNonNegativeNumberSchema,
  maxChangePercent: optionalNonNegativeNumberSchema,
  exchanges: z.array(z.string().trim().min(1)).optional(),
  excludeOtc: booleanQuerySchema.optional(),
  excludeLowPrice: booleanQuerySchema.optional(),
});

export const discoveryDefaultSetBodySchema = z.object({
  limit: optionalLimitSchema,
  minPrice: optionalNonNegativeNumberSchema,
  minVolume: optionalNonNegativeNumberSchema,
  minMarketCap: optionalNonNegativeNumberSchema,
  maxChangePercent: optionalNonNegativeNumberSchema,
  exchanges: z.array(z.string().trim().min(1)).optional(),
  excludeOtc: booleanQuerySchema.optional(),
  excludeLowPrice: booleanQuerySchema.optional(),
});

export const discoveryListQuerySchema = z.object({
  limit: optionalLimitSchema,
  minPrice: optionalNonNegativeNumberSchema,
  minVolume: optionalNonNegativeNumberSchema,
  minMarketCap: optionalNonNegativeNumberSchema,
  maxChangePercent: optionalNonNegativeNumberSchema,
  exchanges: z
    .preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }

      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }, z.array(z.string().trim().min(1)))
    .optional(),
  excludeOtc: booleanQuerySchema.optional(),
  excludeLowPrice: booleanQuerySchema.optional(),
});
