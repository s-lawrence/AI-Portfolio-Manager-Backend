import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_RISK_LEVEL,
  AgentToolExecutionError,
  type AgentToolResult,
  type ExecuteAgentToolRequest,
} from "./agent-tool.types";
import type { AgentToolRegistry } from "./agent-tool-registry";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function calculateDurationMs(startedAt: Date, finishedAt: Date): number {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

export class AgentToolExecutor {
  constructor(private readonly registry: AgentToolRegistry) {}

  async executeByName(request: ExecuteAgentToolRequest): Promise<AgentToolResult> {
    const tool = this.registry.getTool(request.toolName);
    if (!tool) {
      throw new AgentToolExecutionError(
        404,
        "AGENT_TOOL_NOT_FOUND",
        `Unknown agent tool '${request.toolName}'.`,
      );
    }

    if (tool.executionMode === AGENT_TOOL_EXECUTION_MODE.DISABLED) {
      throw new AgentToolExecutionError(
        403,
        "AGENT_TOOL_DISABLED",
        `Tool '${tool.name}' is currently disabled.`,
        {
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
        },
      );
    }

    if (
      tool.executionMode === AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED &&
      request.confirmed !== true
    ) {
      throw new AgentToolExecutionError(
        409,
        "AGENT_TOOL_CONFIRMATION_REQUIRED",
        "Tool requires confirmation.",
        {
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
        },
      );
    }

    const input = this.registry.validateToolInput(tool.name, request.input);

    const startedAtDate = new Date();
    const warnings: string[] = [];
    const errors: string[] = [];
    const dryRun = Boolean(request.context.dryRun);

    if (dryRun && tool.riskLevel !== AGENT_TOOL_RISK_LEVEL.READ_ONLY) {
      warnings.push("Dry-run mode: execution was not performed.");
      const plannedData = tool.dryRunPlan
        ? await tool.dryRunPlan(input, request.context)
        : {
            plannedAction: true,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            executionMode: tool.executionMode,
            input,
            message:
              tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION
                ? "Dry-run validated mutation input. No database write was performed."
                : "Dry-run validated refresh input. No provider call or data write was performed.",
          };
      const finishedAtDate = new Date();

      return {
        toolName: tool.name,
        success: true,
        data: plannedData,
        warnings,
        errors,
        metadata: {
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
          dryRun,
        },
      };
    }

    try {
      const data = await tool.execute(input, request.context);

      if (tool.outputSchema) {
        const parsedOutput = tool.outputSchema.safeParse(data);
        if (!parsedOutput.success) {
          errors.push("Tool output validation failed.");
        }
      }

      const finishedAtDate = new Date();
      return {
        toolName: tool.name,
        success: errors.length === 0,
        data,
        warnings,
        errors,
        metadata: {
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
          dryRun,
        },
      };
    } catch (error) {
      if (error instanceof AgentToolExecutionError) {
        throw error;
      }

      errors.push(toErrorMessage(error));
      const finishedAtDate = new Date();

      return {
        toolName: tool.name,
        success: false,
        warnings,
        errors,
        metadata: {
          startedAt: startedAtDate.toISOString(),
          finishedAt: finishedAtDate.toISOString(),
          durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
          riskLevel: tool.riskLevel,
          executionMode: tool.executionMode,
          dryRun,
        },
      };
    }
  }
}
