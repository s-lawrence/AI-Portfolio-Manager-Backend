import { z } from "zod";

import { tickerSchema } from "./common.schemas";

export const stockTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const listStocksQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
});

export const stockSearchQuerySchema = z.object({
  query: z.string().trim().min(1),
  exchange: z.string().trim().min(1).max(20).optional(),
  country: z.string().trim().min(1).max(10).optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
});

export const updateStockMetadataBodySchema = z
  .object({
    companyName: z.string().trim().min(1).optional(),
    exchange: z.string().trim().min(1).optional(),
    sector: z.string().trim().min(1).optional(),
    industry: z.string().trim().min(1).optional(),
    country: z.string().trim().min(1).optional(),
    currency: z.string().trim().min(1).optional(),
    assetType: z.string().trim().min(1).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one metadata field must be provided.",
  });
