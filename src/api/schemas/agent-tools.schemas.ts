import { z } from "zod";
import { AGENT_TOOL_NAMES } from "../../agent/agent-tool.types";

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
  watchlistId: z.string().trim().min(1).optional(),
  ticker: z.string().trim().min(1).optional(),
  requestId: z.string().trim().min(1).optional(),
  source: z.enum(["USER", "AGENT", "SYSTEM"]).default("USER"),
});

const agentToolNameSchema = z.enum(AGENT_TOOL_NAMES);

export const agentChatBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  userId: z.string().trim().min(1).optional(),
  portfolioId: z.string().trim().min(1).optional(),
  watchlistId: z.string().trim().min(1).optional(),
  ticker: z.string().trim().min(1).optional(),
  context: agentChatContextSchema.optional().default({
    source: "USER",
  }),
  confirmedToolExecutions: z.array(agentToolNameSchema).max(25).optional(),
  confirmedToolInputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  allowRefresh: z.boolean().optional(),
  allowMutation: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
