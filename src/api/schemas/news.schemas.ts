import { z } from "zod";

import {
  dateInputSchema,
  optionalLimitSchema,
  sentimentSchema,
  tickerSchema,
} from "./common.schemas";

export const newsTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const newsArticleBodySchema = z.object({
  headline: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  author: z.string().trim().min(1).optional(),
  url: z.string().trim().url(),
  publishedAt: dateInputSchema,
  summary: z.string().trim().min(1).optional(),
  rawExcerpt: z.string().trim().min(1).optional(),
  sentiment: sentimentSchema.optional(),
  sentimentScore: z.number().finite().optional(),
  materialityScore: z.number().finite().optional(),
  relevanceExplanation: z.string().trim().min(1).optional(),
});

export const bulkNewsBodySchema = z.object({
  articles: z.array(newsArticleBodySchema).min(1),
});

export const newsListQuerySchema = z.object({
  limit: optionalLimitSchema,
});
