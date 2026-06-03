import {
  AlertSeverity,
  HoldingStatus,
  PredictionDirection,
  PredictionHorizon,
  Recommendation,
  RiskLevel,
  Sentiment,
} from "@prisma/client";
import { z } from "zod";

export const cuidSchema = z.string().cuid();

export const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9.\-]+$/, "Ticker must only contain letters, numbers, '.', or '-'.")
  .transform((value) => value.toUpperCase());

export const positiveNumberSchema = z.number().finite().positive();

export const nonNegativeNumberSchema = z.number().finite().min(0);

export const optionalLimitSchema = z.coerce.number().int().positive().max(500).optional();

export const isoDateStringSchema = z.string().datetime({ offset: true });

export const optionalIsoDateStringSchema = isoDateStringSchema.optional();

export const dateInputSchema = z
  .union([isoDateStringSchema, z.date()])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

export const optionalDateInputSchema = dateInputSchema.optional();

export const booleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return value;
}, z.boolean());

export const numericLikeSchema = z
  .union([
    z.number().finite(),
    z.string().trim().regex(/^-?\d+(\.\d+)?$/).transform((value) => Number(value)),
  ])
  .refine((value) => Number.isFinite(value), "Numeric value must be finite.");

export const holdingStatusSchema = z.nativeEnum(HoldingStatus);
export const recommendationSchema = z.nativeEnum(Recommendation);
export const sentimentSchema = z.nativeEnum(Sentiment);
export const riskLevelSchema = z.nativeEnum(RiskLevel);
export const alertSeveritySchema = z.nativeEnum(AlertSeverity);
export const predictionHorizonSchema = z.nativeEnum(PredictionHorizon);
export const predictionDirectionSchema = z.nativeEnum(PredictionDirection);

export const idParamSchema = z.object({
  id: cuidSchema,
});

export const limitQuerySchema = z.object({
  limit: optionalLimitSchema,
});
