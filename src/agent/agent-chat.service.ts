import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_NAMES,
  AGENT_TOOL_RISK_LEVEL,
  type AgentToolContext,
} from "./agent-tool.types";
import { env } from "../config/env";
import { agentToolExecutor, agentToolRegistry } from "./index";
import {
  type AgentChatRequest,
  type AgentChatResponse,
  type AgentConfidence,
  type AgentOpenAiDiagnostics,
  type AgentSuggestedAction,
  type AgentToolCallSummary,
} from "./agent-chat.types";
import { OpenAiAgentClientError, generateAgentSynthesis } from "./openai-agent-client";

const RESEARCH_STOP_WORDS = new Set([
  "RESEARCH",
  "ANALYZE",
  "ANALYSIS",
  "COMPARE",
  "PORTFOLIO",
  "WATCHLIST",
  "RISK",
  "FOR",
  "WITH",
  "AND",
  "THE",
  "PLEASE",
  "SHOW",
  "WHAT",
  "ABOUT",
]);

function redactDiagnosticText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const redacted = value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .trim();

  return redacted.length > 0 ? redacted.slice(0, 200) : undefined;
}

function extractTickers(message: string): string[] {
  const candidates = message.match(/\b[A-Za-z]{1,5}\b/g) ?? [];

  return [...new Set(
    candidates
      .map((value) => value.toUpperCase())
      .filter((value) => !RESEARCH_STOP_WORDS.has(value)),
  )];
}

function determineIntent(
  message: string,
  context: AgentChatRequest["context"],
): {
  intent: string;
  tickers: string[];
} {
  const normalized = message.toLowerCase();
  const tickers = extractTickers(message);

  if (normalized.includes("compare") && tickers.length >= 2) {
    return {
      intent: "COMPARE_TICKERS",
      tickers,
    };
  }

  if (normalized.includes("risk") && normalized.includes("portfolio")) {
    return {
      intent: "PORTFOLIO_RISK_SNAPSHOT",
      tickers,
    };
  }

  if (
    tickers.length > 0 &&
    (normalized.includes("research") || normalized.includes("analy") || normalized.includes("report"))
  ) {
    return {
      intent: "RESEARCH_TICKER",
      tickers,
    };
  }

  if (tickers.length === 1) {
    return {
      intent: "RESEARCH_TICKER",
      tickers,
    };
  }

  return {
    intent: "GENERAL_QA",
    tickers,
  };
}

function summarizeToolOutput(toolName: string, data: unknown): string {
  if (!data || typeof data !== "object") {
    return "No data returned.";
  }

  const payload = data as Record<string, unknown>;

  if (toolName === "scoreTickerResearch") {
    const ticker = String(payload.ticker ?? "UNKNOWN");
    const compositeScore = typeof payload.compositeScore === "number"
      ? payload.compositeScore.toFixed(2)
      : "n/a";
    const suggestedStance = String(payload.suggestedStance ?? "UNKNOWN");
    return `${ticker} scored ${compositeScore} with stance ${suggestedStance}.`;
  }

  if (toolName === "compareTickers") {
    const requested = Array.isArray(payload.requestedTickers)
      ? (payload.requestedTickers as unknown[]).length
      : 0;
    const scores = Array.isArray(payload.scores)
      ? (payload.scores as unknown[]).length
      : 0;
    return `Compared ${scores} ticker scorecards out of ${requested} requested tickers.`;
  }

  if (toolName === "getPortfolioRiskSnapshot") {
    const topRisks = Array.isArray(payload.topRisks)
      ? (payload.topRisks as unknown[]).slice(0, 2).map((value) => String(value)).join(" ")
      : "";
    const holdingRisks = Array.isArray(payload.concentrationRisks)
      ? (payload.concentrationRisks as unknown[]).length
      : 0;
    return `Portfolio risk snapshot returned ${holdingRisks} concentration signals. ${topRisks}`.trim();
  }

  return "Tool executed successfully.";
}

function toToolCallSummary(result: {
  toolName: string;
  success: boolean;
  warnings: string[];
  errors: string[];
  metadata: {
    riskLevel: AgentToolCallSummary["riskLevel"];
    executionMode: AgentToolCallSummary["executionMode"];
    durationMs: number;
  };
  data?: unknown;
}): AgentToolCallSummary {
  return {
    toolName: result.toolName,
    success: result.success,
    warnings: result.warnings,
    errors: result.errors,
    riskLevel: result.metadata.riskLevel,
    executionMode: result.metadata.executionMode,
    durationMs: result.metadata.durationMs,
    summary: summarizeToolOutput(result.toolName, result.data),
  };
}

function deterministicConfidence(
  toolCalls: AgentToolCallSummary[],
  warnings: string[],
  missingContext: string[],
): AgentConfidence {
  if (missingContext.length > 0) {
    return "LOW";
  }

  if (toolCalls.some((call) => !call.success || call.errors.length > 0)) {
    return "LOW";
  }

  if (warnings.length > 0) {
    return "MEDIUM";
  }

  return toolCalls.length > 0 ? "HIGH" : "MEDIUM";
}

function deterministicAnswer(intent: string, toolCalls: AgentToolCallSummary[], missingContext: string[]): string {
  if (missingContext.length > 0) {
    return `I need additional context before I can complete this request: ${missingContext.join(" ")}`;
  }

  if (toolCalls.length === 0) {
    return "I can help with ticker research, ticker comparison, and portfolio risk snapshots. Please include a ticker or portfolio context.";
  }

  const primary = toolCalls[0];
  return `Deterministic summary: ${primary.summary}`;
}

function addConfirmationPolicy(actions: AgentSuggestedAction[]): AgentSuggestedAction[] {
  return actions
    .map((action) => {
      if (!action.toolName) {
        return action;
      }

      const tool = agentToolRegistry.getTool(action.toolName);
      if (!tool) {
        return action;
      }

      const requiresConfirmation =
        tool.executionMode === AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED ||
        tool.riskLevel === AGENT_TOOL_RISK_LEVEL.REFRESH ||
        tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION ||
        tool.riskLevel === AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT;

      return {
        ...action,
        requiresConfirmation,
      };
    })
    .filter((action) => action.label.trim().length > 0);
}

function sanitizeSuggestedActions(
  actions: AgentSuggestedAction[],
): { actions: AgentSuggestedAction[]; warnings: string[] } {
  const warnings: string[] = [];
  const sanitized: AgentSuggestedAction[] = [];

  for (const action of actions) {
    if (action.toolName && !AGENT_TOOL_NAMES.includes(action.toolName as (typeof AGENT_TOOL_NAMES)[number])) {
      warnings.push(`Dropped unapproved suggested tool '${action.toolName}'.`);
      continue;
    }

    sanitized.push(action);
  }

  return {
    actions: addConfirmationPolicy(sanitized),
    warnings,
  };
}

function buildDeterministicSuggestedActions(
  intent: string,
  tickers: string[],
  toolCalls: AgentToolCallSummary[],
): AgentSuggestedAction[] {
  const actions: AgentSuggestedAction[] = [];

  if (intent === "RESEARCH_TICKER" && tickers.length > 0) {
    actions.push({
      label: `Refresh analyst data for ${tickers[0]}`,
      toolName: "refreshTickerAnalystData",
      input: {
        ticker: tickers[0],
      },
      requiresConfirmation: true,
    });
  }

  if (toolCalls.some((call) => call.toolName === "scoreTickerResearch" && call.success)) {
    actions.push({
      label: "Compare with peers",
      toolName: "compareTickers",
      input: {
        tickers,
      },
    });
  }

  return actions;
}

export async function runAgentChat(request: AgentChatRequest): Promise<AgentChatResponse> {
  const startedAtDate = new Date();
  const message = request.message.trim();

  const { intent, tickers } = determineIntent(message, request.context);
  const missingContext: string[] = [];
  const toolExecutionPlan: Array<{ toolName: string; input: Record<string, unknown> }> = [];

  if (intent === "RESEARCH_TICKER") {
    if (tickers.length === 0) {
      missingContext.push("Ticker symbol is required for research intent.");
    } else {
      toolExecutionPlan.push({
        toolName: "scoreTickerResearch",
        input: {
          ticker: tickers[0],
        },
      });
    }
  } else if (intent === "COMPARE_TICKERS") {
    if (tickers.length < 2) {
      missingContext.push("At least two ticker symbols are required to compare tickers.");
    } else {
      toolExecutionPlan.push({
        toolName: "compareTickers",
        input: {
          tickers: tickers.slice(0, 10),
        },
      });
    }
  } else if (intent === "PORTFOLIO_RISK_SNAPSHOT") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId is required for portfolio risk snapshot intent.");
    } else {
      toolExecutionPlan.push({
        toolName: "getPortfolioRiskSnapshot",
        input: {
          portfolioId: request.context.portfolioId,
        },
      });
    }
  }

  const cappedExecutionPlan = toolExecutionPlan.slice(0, env.OPENAI_AGENT_MAX_TOOL_CALLS);

  const executionContext: AgentToolContext = {
    source: request.context.source,
    userId: request.context.userId,
    portfolioId: request.context.portfolioId,
    requestId: request.context.requestId,
    dryRun: false,
  };

  const toolResults = await Promise.all(
    cappedExecutionPlan.map((planned) =>
      agentToolExecutor.executeByName({
        toolName: planned.toolName,
        input: planned.input,
        context: executionContext,
      }),
    ),
  );

  const toolCalls = toolResults.map((result) => toToolCallSummary(result));
  const deterministicWarnings = [
    ...toolCalls.flatMap((call) => [...call.warnings, ...call.errors]),
  ];

  const deterministicSuggestedActions = buildDeterministicSuggestedActions(intent, tickers, toolCalls);

  let answer = deterministicAnswer(intent, toolCalls, missingContext);
  let confidence = deterministicConfidence(toolCalls, deterministicWarnings, missingContext);
  let warnings = [...deterministicWarnings];
  let suggestedActions = deterministicSuggestedActions;
  let mode: AgentChatResponse["metadata"]["mode"] = "DETERMINISTIC_ROUTER";
  let fallbackUsed = false;
  let modelName: string | undefined;
  let openAiDiagnostics: AgentOpenAiDiagnostics | undefined;

  const openAiEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;

  if (openAiEnabled) {
    modelName = env.OPENAI_AGENT_MODEL;

    try {
      const synthesized = await generateAgentSynthesis({
        userMessage: message,
        intent,
        toolResultSummaries: toolCalls.map((call) => ({
          toolName: call.toolName,
          summary: call.summary,
          success: call.success,
          warnings: call.warnings,
          errors: call.errors,
        })),
        warnings,
        missingContext,
        suggestedActions: deterministicSuggestedActions,
      });

      const sanitized = sanitizeSuggestedActions(synthesized.synthesis.suggestedActions);

      answer = synthesized.synthesis.answer;
      confidence = synthesized.synthesis.confidence;
      warnings = [...new Set([...warnings, ...synthesized.synthesis.warnings, ...sanitized.warnings])];
      suggestedActions = sanitized.actions;
      mode = "OPENAI_SYNTHESIS";
      modelName = synthesized.modelName;

      if (synthesized.usedFallbackModel) {
        warnings = [...new Set([
          ...warnings,
          "Primary OpenAI model was unavailable; fallback model was used.",
        ])];

        if (env.NODE_ENV !== "production" && synthesized.primaryModelFailure) {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: synthesized.primaryModelFailure.stage,
            openAiErrorCode: synthesized.primaryModelFailure.errorCode,
            openAiStatus: synthesized.primaryModelFailure.status,
            openAiResponsePreview: redactDiagnosticText(
              synthesized.primaryModelFailure.responsePreview,
            ),
            openAiModelName: synthesized.modelName,
          };
        }
      }
    } catch (error) {
      fallbackUsed = true;
      warnings = [...new Set([...warnings, "OpenAI synthesis failed; deterministic fallback used."])];
      suggestedActions = addConfirmationPolicy(deterministicSuggestedActions);

      if (env.NODE_ENV !== "production") {
        if (error instanceof OpenAiAgentClientError) {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: error.failure.stage,
            openAiErrorCode: error.failure.errorCode,
            openAiStatus: error.failure.status,
            openAiResponsePreview: redactDiagnosticText(error.failure.responsePreview),
            openAiModelName: error.failure.modelName ?? modelName,
          };
        } else {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: "UNKNOWN",
            openAiModelName: modelName,
          };
        }
      }
    }
  } else {
    suggestedActions = addConfirmationPolicy(deterministicSuggestedActions);
  }

  const finishedAtDate = new Date();

  return {
    answer,
    intent,
    toolCalls,
    suggestedActions,
    warnings,
    missingContext,
    confidence,
    metadata: {
      mode,
      modelName,
      fallbackUsed,
      startedAt: startedAtDate.toISOString(),
      finishedAt: finishedAtDate.toISOString(),
      durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
      openAiDiagnostics,
    },
  };
}
