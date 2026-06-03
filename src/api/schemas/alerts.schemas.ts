import { z } from "zod";

import {
  alertSeveritySchema,
  booleanQuerySchema,
  cuidSchema,
  optionalLimitSchema,
} from "./common.schemas";

export const alertIdParamsSchema = z.object({
  alertId: cuidSchema,
});

export const alertUserParamsSchema = z.object({
  userId: cuidSchema,
});

export const createAlertBodySchema = z.object({
  userId: cuidSchema,
  stockId: cuidSchema.optional(),
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  severity: alertSeveritySchema,
  category: z.string().trim().min(1).optional(),
  sourceType: z.string().trim().min(1).optional(),
  sourceId: z.string().trim().min(1).optional(),
});

export const listUserAlertsQuerySchema = z.object({
  unreadOnly: booleanQuerySchema.optional(),
  limit: optionalLimitSchema,
});
