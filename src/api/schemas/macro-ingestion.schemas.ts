import { z } from "zod";

import { optionalLimitSchema } from "./common.schemas";

const isoDateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format.");

const dateInputSchema = z
  .union([isoDateOnlySchema, z.date()])
  .transform((value) => {
    if (value instanceof Date) {
      return value;
    }

    return new Date(`${value}T00:00:00.000Z`);
  });

export const macroIngestionBodySchema = z.object({
  from: dateInputSchema.optional(),
  to: dateInputSchema.optional(),
  limit: optionalLimitSchema,
});

export const macroSeriesParamsSchema = z.object({
  seriesId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "Series ID must be alphanumeric and may include '.', '_', '-'.")
    .transform((value) => value.toUpperCase()),
});
