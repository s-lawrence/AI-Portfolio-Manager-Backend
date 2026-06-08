import { z } from "zod";

import { optionalLimitSchema } from "./common.schemas";

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
});

export const discoveryDefaultSetBodySchema = z.object({
  limit: optionalLimitSchema,
});

export const discoveryListQuerySchema = z.object({
  limit: optionalLimitSchema,
});
