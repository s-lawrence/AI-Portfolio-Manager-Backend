import { z } from "zod";

import { booleanQuerySchema, optionalLimitSchema } from "./common.schemas";

export const geopoliticalQueryBodySchema = z.object({
  query: z.string().trim().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  maxRecords: optionalLimitSchema,
});

export const geopoliticalDefaultRiskBodySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  maxRecordsPerQuery: optionalLimitSchema,
  maxRecords: optionalLimitSchema,
  mode: z.enum(["quick", "full"]).optional(),
  queries: z.array(z.string().trim().min(1)).optional(),
  includeDefaults: booleanQuerySchema.optional(),
});

export const geopoliticalLatestQuerySchema = z.object({
  limit: optionalLimitSchema,
  days: z.coerce.number().int().positive().max(3650).optional(),
});

export const geopoliticalSummaryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(3650).optional(),
  limit: optionalLimitSchema,
});
