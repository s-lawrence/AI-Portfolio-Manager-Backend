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

function normalizeConfirmedToolInputs(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const mapped: Record<string, Record<string, unknown>> = {};

    for (const item of value) {
      if (typeof item !== "object" || item == null) {
        continue;
      }

      const candidate = item as Record<string, unknown>;
      const toolName = typeof candidate.toolName === "string" ? candidate.toolName.trim() : "";
      const input = candidate.input;

      if (!toolName || typeof input !== "object" || input == null || Array.isArray(input)) {
        continue;
      }

      mapped[toolName] = input as Record<string, unknown>;
    }

    return mapped;
  }

  if (typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const directToolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
  const directInput = record.input;

  if (
    directToolName.length > 0 &&
    typeof directInput === "object" &&
    directInput != null &&
    !Array.isArray(directInput)
  ) {
    return {
      [directToolName]: directInput,
    };
  }

  return value;
}

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
  confirmedToolInputs: z.preprocess(
    normalizeConfirmedToolInputs,
    z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  ),
  maxToolCalls: z.coerce.number().int().positive().max(20).optional(),
  allowRefresh: z.boolean().optional(),
  allowMutation: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
