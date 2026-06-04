import { z } from "zod";

import { booleanQuerySchema, optionalLimitSchema } from "./common.schemas";

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

export const ingestFmpTreasuryRatesBodySchema = z.object({
  from: dateInputSchema.optional(),
  to: dateInputSchema.optional(),
  limit: optionalLimitSchema,
});

export const ingestFmpEconomicIndicatorsBodySchema = z.object({
  nameOrSeries: z.string().trim().min(1).optional(),
  namesOrSeries: z.array(z.string().trim().min(1)).min(1).optional(),
  from: dateInputSchema.optional(),
  to: dateInputSchema.optional(),
  limit: optionalLimitSchema,
});

export const ingestFmpEconomicCalendarBodySchema = z.object({
  from: dateInputSchema,
  to: dateInputSchema,
});

export const ingestFmpMarketRiskPremiumBodySchema = z.object({
  from: dateInputSchema.optional(),
  to: dateInputSchema.optional(),
});

export const ingestFmpEconomicsDefaultSetBodySchema = z.object({
  includeTreasuryRates: booleanQuerySchema.optional(),
  includeIndicators: booleanQuerySchema.optional(),
  includeCalendar: booleanQuerySchema.optional(),
  includeMarketRiskPremium: booleanQuerySchema.optional(),
  treasuryRatesFrom: dateInputSchema.optional(),
  treasuryRatesTo: dateInputSchema.optional(),
  treasuryRatesLimit: optionalLimitSchema,
  indicatorsFrom: dateInputSchema.optional(),
  indicatorsTo: dateInputSchema.optional(),
  indicatorsLimit: optionalLimitSchema,
  indicatorNamesOrSeries: z.array(z.string().trim().min(1)).optional(),
  calendarFrom: dateInputSchema.optional(),
  calendarTo: dateInputSchema.optional(),
  marketRiskPremiumFrom: dateInputSchema.optional(),
  marketRiskPremiumTo: dateInputSchema.optional(),
});
