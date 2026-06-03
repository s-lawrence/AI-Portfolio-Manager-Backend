import { z } from "zod";

import {
  dateInputSchema,
  nonNegativeNumberSchema,
  numericLikeSchema,
  optionalLimitSchema,
  tickerSchema,
} from "./common.schemas";

export const marketDataTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const recordMarketSnapshotBodySchema = z.object({
  price: nonNegativeNumberSchema,
  open: nonNegativeNumberSchema.optional(),
  high: nonNegativeNumberSchema.optional(),
  low: nonNegativeNumberSchema.optional(),
  close: nonNegativeNumberSchema.optional(),
  previousClose: nonNegativeNumberSchema.optional(),
  volume: numericLikeSchema.optional(),
  marketCap: numericLikeSchema.optional(),
  changePercent: z.number().finite().optional(),
  capturedAt: dateInputSchema.optional(),
});

export const marketDataHistoryQuerySchema = z.object({
  limit: optionalLimitSchema,
});
