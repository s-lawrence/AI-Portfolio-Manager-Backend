import { z } from "zod";

export const agentToolNameParamsSchema = z.object({
  toolName: z.string().trim().min(1),
});

export const agentToolContextSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  portfolioId: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  source: z.enum(["USER", "AGENT", "SYSTEM"]),
  dryRun: z.boolean().optional(),
});

export const agentToolExecuteBodySchema = z.object({
  context: agentToolContextSchema,
  input: z.unknown().optional().default({}),
  confirmed: z.boolean().optional(),
});

export const agentChatContextSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  portfolioId: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  source: z.enum(["USER", "AGENT", "SYSTEM"]).default("USER"),
});

export const agentChatBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  context: agentChatContextSchema.optional().default({
    source: "USER",
  }),
});
