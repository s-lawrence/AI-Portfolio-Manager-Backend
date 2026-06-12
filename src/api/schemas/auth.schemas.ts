import { z } from "zod";

export const authGoogleCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  error_description: z.string().trim().min(1).optional(),
});

export const authDevLoginBodySchema = z.object({
  email: z.string().trim().email().optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
});
