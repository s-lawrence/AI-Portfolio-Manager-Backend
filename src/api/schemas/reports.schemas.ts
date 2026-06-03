import { z } from "zod";

import {
  cuidSchema,
  dateInputSchema,
  nonNegativeNumberSchema,
  optionalLimitSchema,
  recommendationSchema,
  riskLevelSchema,
  sentimentSchema,
  tickerSchema,
} from "./common.schemas";

export const reportTickerParamsSchema = z.object({
  ticker: tickerSchema,
});

export const generateReportBodySchema = z.object({
  holdingId: cuidSchema.optional(),
});

export const createReportBodySchema = z.object({
  ticker: tickerSchema,
  holdingId: cuidSchema.optional(),
  reportDate: dateInputSchema.optional(),
  recommendation: recommendationSchema,
  sentiment: sentimentSchema,
  confidenceScore: z.number().finite().min(0).max(1),
  riskScore: z.number().finite().min(0).max(100),
  riskLevel: riskLevelSchema,
  keyTakeaway: z.string().trim().min(1),
  currentPrice: nonNegativeNumberSchema.optional(),
  dailyChangePercent: z.number().finite().optional(),
  shortTermOutlook: z.string().trim().min(1).optional(),
  mediumTermOutlook: z.string().trim().min(1).optional(),
  longTermOutlook: z.string().trim().min(1).optional(),
  bullishFactors: z.array(z.string().trim().min(1)).optional(),
  bearishFactors: z.array(z.string().trim().min(1)).optional(),
  technicalSummary: z.string().trim().min(1).optional(),
  fundamentalSummary: z.string().trim().min(1).optional(),
  newsSummary: z.string().trim().min(1).optional(),
  earningsSummary: z.string().trim().min(1).optional(),
  macroGeopoliticalSummary: z.string().trim().min(1).optional(),
  whatChanged: z.string().trim().min(1).optional(),
  whatWouldChangeRecommendation: z.string().trim().min(1).optional(),
  sourceReferences: z.any().optional(),
  modelName: z.string().trim().min(1).optional(),
  promptVersion: z.string().trim().min(1).optional(),
  rawModelOutput: z.any().optional(),
  createPredictions: z.boolean().optional(),
});

export const listReportsQuerySchema = z.object({
  limit: optionalLimitSchema,
});
