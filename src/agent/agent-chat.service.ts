import {
  AGENT_TOOL_EXECUTION_MODE,
  AGENT_TOOL_NAMES,
  AGENT_TOOL_RISK_LEVEL,
  AgentToolExecutionError,
  type AgentToolContext,
  type AgentToolName,
  type AgentToolResult,
} from "./agent-tool.types";
import { env } from "../config/env";
import { agentToolExecutor, agentToolRegistry } from "./index";
import {
  type AgentChatRequest,
  type AgentChatResponse,
  type AgentConfidence,
  type AgentOpenAiDiagnostics,
  type AgentSuggestedAction,
  type AgentTickerResolutionResult,
  type AgentToolCallSummary,
  type OpenAiToolCatalogItem,
  openAiToolPlanOutputSchema,
} from "./agent-chat.types";
import {
  OpenAiAgentClientError,
  generateAgentSynthesis,
  generateToolPlan,
} from "./openai-agent-client";
import {
  collectMentionedTickers,
  resolveTickerFromMessage,
} from "./agent-entity-resolution";

const FULL_REFRESH_DEFAULT_INPUT = {
  refreshMode: "quick",
  includeEconomics: true,
  includeBankOfCanada: true,
  includeFred: true,
  includeAnalystData: true,
  includeGdelt: false,
  runAnalysis: true,
} as const;

type PlannedToolExecution = {
  toolName: AgentToolName;
  input: Record<string, unknown>;
  purpose: string;
  confirmed: boolean;
};

type PlannedToolCallCandidate = {
  toolName: string;
  input: Record<string, unknown>;
  purpose: string;
};

type PlanValidationResult = {
  intent: string;
  missingContext: string[];
  clarifyingQuestion: string | null;
  plannedToolCount: number;
  droppedToolCount: number;
  warnings: string[];
  suggestedActions: AgentSuggestedAction[];
  executableCalls: PlannedToolExecution[];
};

type DeterministicPlan = {
  intent: string;
  missingContext: string[];
  clarifyingQuestion: string | null;
  toolCalls: PlannedToolCallCandidate[];
  warnings: string[];
};

function calculateDurationMs(startedAtDate: Date, finishedAtDate: Date): number {
  return Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function buildFullRefreshInput(portfolioId: string): Record<string, unknown> {
  return {
    portfolioId,
    ...FULL_REFRESH_DEFAULT_INPUT,
  };
}

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

function inferCanadianTickerPreference(request: AgentChatRequest): boolean | undefined {
  const message = request.message.toLowerCase();
  const contextTicker = request.context.ticker?.trim().toUpperCase();

  if (contextTicker?.endsWith(".TO")) {
    return true;
  }

  if (message.includes("tsx") || message.includes("canada") || message.includes("toronto")) {
    return true;
  }

  if (message.includes("nyse") || message.includes("us listing") || message.includes("new york")) {
    return false;
  }

  return undefined;
}

function buildTickerClarifyingQuestion(resolution: AgentTickerResolutionResult): string | null {
  if (resolution.source !== "AMBIGUOUS") {
    return null;
  }

  const candidates = (resolution.candidates ?? []).slice(0, 4);
  if (candidates.length === 0) {
    return "I found multiple ticker candidates. Which ticker should I use?";
  }

  const options = candidates
    .map((candidate) => {
      const company = candidate.companyName ? ` (${candidate.companyName})` : "";
      return `${candidate.ticker}${company}`;
    })
    .join(", ");

  return `I found multiple ticker candidates: ${options}. Which ticker should I use?`;
}

function determineIntent(message: string, tickers: string[]): string {
  const normalized = message.toLowerCase();

  if (normalized.startsWith("confirm:")) {
    return "CONFIRM_TOOL_EXECUTION";
  }

  if (
    normalized.includes("run full refresh") ||
    normalized.includes("refresh data") ||
    normalized.includes("update portfolio data") ||
    normalized.includes("refresh my portfolio")
  ) {
    return "REFRESH_REQUEST";
  }

  if (normalized.includes("add") && normalized.includes("watchlist")) {
    return "WATCHLIST_ADD";
  }

  if (
    normalized.includes("watchlist") &&
    (normalized.includes("look best") || normalized.includes("best") || normalized.includes("look good"))
  ) {
    return "WATCHLIST_SCORE";
  }

  if (normalized.includes("worried") || (normalized.includes("risk") && normalized.includes("today"))) {
    return "DAILY_RISK_CHECK";
  }

  if (normalized.includes("review") && normalized.includes("portfolio")) {
    return "PORTFOLIO_REVIEW";
  }

  if (normalized.includes("risk") && normalized.includes("portfolio")) {
    return "PORTFOLIO_RISK_SNAPSHOT";
  }

  if (normalized.includes("compare") && tickers.length >= 2) {
    return "COMPARE_TICKERS";
  }

  if (
    normalized.includes("research") ||
    normalized.includes("analy") ||
    normalized.includes("report") ||
    normalized.includes("take a look") ||
    normalized.includes("look at")
  ) {
    return "RESEARCH_TICKER";
  }

  if (tickers.length === 1) {
    return "RESEARCH_TICKER";
  }

  return "GENERAL_QA";
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

  if (toolName === "scoreWatchlist") {
    const scoredItems = Array.isArray(payload.items)
      ? (payload.items as unknown[]).length
      : 0;
    return `Watchlist scoring completed for ${scoredItems} item(s).`;
  }

  if (toolName === "getPortfolioOverview") {
    const holdings = Array.isArray(payload.holdings)
      ? (payload.holdings as unknown[]).length
      : 0;
    return `Portfolio overview returned ${holdings} holdings.`;
  }

  if (toolName === "getPortfolioRiskSnapshot") {
    const topRisks = Array.isArray(payload.topRisks)
      ? (payload.topRisks as unknown[]).slice(0, 2).map((value) => String(value)).join(" ")
      : "";
    return `Portfolio risk snapshot generated. ${topRisks}`.trim();
  }

  if (toolName === "runPortfolioFullRefresh") {
    return "Portfolio refresh executed successfully.";
  }

  if (toolName === "addTickerToWatchlist") {
    const ticker = typeof payload.ticker === "string" ? payload.ticker : "ticker";
    return `Added ${ticker} to watchlist.`;
  }

  if (toolName === "getGeopoliticalSummary") {
    return "Geopolitical summary returned.";
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

function mergeRequiredActions(
  requiredActions: AgentSuggestedAction[],
  candidateActions: AgentSuggestedAction[],
): AgentSuggestedAction[] {
  const merged = [...candidateActions];

  for (const action of requiredActions) {
    const exists = merged.some((candidate) =>
      action.toolName
        ? candidate.toolName === action.toolName
        : candidate.label === action.label,
    );

    if (!exists) {
      merged.push(action);
    }
  }

  return addConfirmationPolicy(merged);
}

function deterministicAnswer(input: {
  intent: string;
  toolCalls: AgentToolCallSummary[];
  missingContext: string[];
  clarifyingQuestion: string | null;
  warnings: string[];
  suggestedActions: AgentSuggestedAction[];
}): string {
  if (input.clarifyingQuestion) {
    return input.clarifyingQuestion;
  }

  if (input.missingContext.length > 0) {
    return `I need additional context before I can continue: ${input.missingContext.join(", ")}.`;
  }

  if (input.intent === "REFRESH_REQUEST") {
    return "I prepared a full portfolio refresh action. Confirmation is required before execution.";
  }

  if (input.intent === "WATCHLIST_ADD" && input.suggestedActions.some((action) => action.toolName === "addTickerToWatchlist")) {
    return "I prepared the watchlist update action. Please confirm before I execute it.";
  }

  if (input.toolCalls.length === 0) {
    return "I can help with portfolio risk, watchlist scoring, ticker research, and refresh planning. Tell me what you want to review.";
  }

  const firstFailure = input.toolCalls.find((call) => !call.success);
  if (firstFailure) {
    return `I ran part of the plan, but '${firstFailure.toolName}' failed: ${firstFailure.errors.join(" ")}`;
  }

  if (input.intent === "PORTFOLIO_REVIEW" || input.intent === "DAILY_RISK_CHECK") {
    return "I reviewed your portfolio context and risk signals.";
  }

  if (input.intent === "WATCHLIST_SCORE") {
    return "I reviewed your watchlist and generated ranking signals.";
  }

  if (input.intent === "RESEARCH_TICKER") {
    return "I reviewed the ticker research context and score.";
  }

  return `Deterministic summary: ${input.toolCalls[0]?.summary ?? "No summary available."}`;
}

function summaryFromFieldErrors(fieldErrors: Record<string, string[] | undefined>): string {
  const pairs = Object.entries(fieldErrors)
    .filter(([, errors]) => Array.isArray(errors) && errors.length > 0)
    .slice(0, 6)
    .map(([field, errors]) => `${field}: ${(errors ?? []).join("; ")}`);

  return pairs.length > 0 ? pairs.join(" | ") : "Input must match the registered schema.";
}

function summarizeInputSchema(toolName: AgentToolName): string {
  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return "Tool schema unavailable.";
  }

  const parseWithEmpty = tool.inputSchema.safeParse({});
  if (parseWithEmpty.success) {
    return "No required input fields.";
  }

  return summaryFromFieldErrors(parseWithEmpty.error.flatten().fieldErrors);
}

function buildToolCatalog(): OpenAiToolCatalogItem[] {
  return agentToolRegistry
    .listToolDescriptors()
    .filter((tool) => AGENT_TOOL_NAMES.includes(tool.name as AgentToolName))
    .map((tool) => ({
      name: tool.name as AgentToolName,
      description: tool.description,
      riskLevel: tool.riskLevel,
      executionMode: tool.executionMode,
      inputSchemaSummary: summarizeInputSchema(tool.name as AgentToolName),
    }));
}

function requiresConfirmation(toolName: AgentToolName): boolean {
  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return true;
  }

  return (
    tool.executionMode === AGENT_TOOL_EXECUTION_MODE.CONFIRMATION_REQUIRED ||
    tool.riskLevel === AGENT_TOOL_RISK_LEVEL.REFRESH ||
    tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION ||
    tool.riskLevel === AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT
  );
}

function labelForTool(toolName: AgentToolName, purpose: string): string {
  if (toolName === "runPortfolioFullRefresh") {
    return "Run full portfolio refresh";
  }

  if (toolName === "addTickerToWatchlist") {
    return "Add ticker to watchlist";
  }

  if (purpose.trim().length > 0) {
    return `Confirm: ${purpose.trim()}`;
  }

  return `Confirm tool execution: ${toolName}`;
}

function canExecuteConfirmedTool(toolName: AgentToolName, request: AgentChatRequest): boolean {
  const confirmed = request.confirmedToolExecutions?.includes(toolName) === true;
  if (!confirmed) {
    return false;
  }

  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return false;
  }

  if (tool.riskLevel === AGENT_TOOL_RISK_LEVEL.REFRESH && request.allowRefresh !== true) {
    return false;
  }

  if (
    (tool.riskLevel === AGENT_TOOL_RISK_LEVEL.MUTATION || tool.riskLevel === AGENT_TOOL_RISK_LEVEL.HIGH_IMPACT) &&
    request.allowMutation !== true
  ) {
    return false;
  }

  return true;
}

function resolveConfirmedToolInput(
  toolName: AgentToolName,
  request: AgentChatRequest,
  tickers: string[],
): Record<string, unknown> | undefined {
  const explicitInput = request.confirmedToolInputs?.[toolName];
  if (explicitInput && typeof explicitInput === "object") {
    return explicitInput;
  }

  if (toolName === "runPortfolioFullRefresh") {
    if (!request.context.portfolioId) {
      return undefined;
    }

    return buildFullRefreshInput(request.context.portfolioId);
  }

  if (toolName === "addTickerToWatchlist") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];
    if (!request.context.watchlistId || !ticker) {
      return undefined;
    }

    return {
      watchlistId: request.context.watchlistId,
      ticker,
      status: "WATCHING",
    };
  }

  return {};
}

function isContextFreeReadOnly(toolName: AgentToolName): boolean {
  const tool = agentToolRegistry.getTool(toolName);
  if (!tool) {
    return false;
  }

  if (tool.riskLevel !== AGENT_TOOL_RISK_LEVEL.READ_ONLY || tool.executionMode !== AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED) {
    return false;
  }

  return tool.inputSchema.safeParse({}).success;
}

function validateAndPrepareToolCalls(input: {
  intent: string;
  toolCalls: PlannedToolCallCandidate[];
  missingContext: string[];
  clarifyingQuestion: string | null;
  request: AgentChatRequest;
}): PlanValidationResult {
  const cappedToolCalls = input.toolCalls.slice(0, env.OPENAI_AGENT_MAX_TOOL_CALLS);
  const executableCalls: PlannedToolExecution[] = [];
  const warnings: string[] = [];
  const suggestedActions: AgentSuggestedAction[] = [];
  let droppedToolCount = Math.max(0, input.toolCalls.length - cappedToolCalls.length);

  for (const planned of cappedToolCalls) {
    if (!AGENT_TOOL_NAMES.includes(planned.toolName as AgentToolName)) {
      droppedToolCount += 1;
      warnings.push(`Dropped unknown planned tool '${planned.toolName}'.`);
      continue;
    }

    const toolName = planned.toolName as AgentToolName;
    const tool = agentToolRegistry.getTool(toolName);
    if (!tool) {
      droppedToolCount += 1;
      warnings.push(`Dropped unavailable planned tool '${toolName}'.`);
      continue;
    }

    if (tool.executionMode === AGENT_TOOL_EXECUTION_MODE.DISABLED) {
      droppedToolCount += 1;
      warnings.push(`Dropped disabled tool '${toolName}'.`);
      continue;
    }

    let normalizedInput: Record<string, unknown>;
    try {
      normalizedInput = agentToolRegistry.validateToolInput(toolName, planned.input ?? {}) as Record<string, unknown>;
    } catch (error) {
      droppedToolCount += 1;
      const message = error instanceof AgentToolExecutionError
        ? error.message
        : "Invalid planner tool input.";
      warnings.push(`Dropped invalid planned input for '${toolName}': ${message}`);
      continue;
    }

    if (requiresConfirmation(toolName)) {
      if (canExecuteConfirmedTool(toolName, input.request)) {
        executableCalls.push({
          toolName,
          input: normalizedInput,
          purpose: planned.purpose,
          confirmed: true,
        });
      } else {
        suggestedActions.push({
          label: labelForTool(toolName, planned.purpose),
          toolName,
          input: normalizedInput,
          requiresConfirmation: true,
        });
      }

      continue;
    }

    executableCalls.push({
      toolName,
      input: normalizedInput,
      purpose: planned.purpose,
      confirmed: false,
    });
  }

  const missingContext = dedupe(input.missingContext);
  const hasOpenQuestions = missingContext.length > 0 || Boolean(input.clarifyingQuestion);

  if (hasOpenQuestions) {
    const contextFreeCalls = executableCalls.filter((call) => isContextFreeReadOnly(call.toolName));
    const skippedCount = executableCalls.length - contextFreeCalls.length;

    if (skippedCount > 0) {
      warnings.push("Planner requested context-dependent tools before required context was provided.");
      droppedToolCount += skippedCount;
    }

    return {
      intent: input.intent,
      missingContext,
      clarifyingQuestion: input.clarifyingQuestion,
      plannedToolCount: cappedToolCalls.length,
      droppedToolCount,
      warnings,
      suggestedActions: addConfirmationPolicy(suggestedActions),
      executableCalls: contextFreeCalls,
    };
  }

  return {
    intent: input.intent,
    missingContext,
    clarifyingQuestion: input.clarifyingQuestion,
    plannedToolCount: cappedToolCalls.length,
    droppedToolCount,
    warnings,
    suggestedActions: addConfirmationPolicy(suggestedActions),
    executableCalls,
  };
}

function buildDeterministicPlan(
  request: AgentChatRequest,
  tickers: string[],
  tickerResolution: AgentTickerResolutionResult,
): DeterministicPlan {
  const missingContext: string[] = [];
  const warnings: string[] = [];
  const toolCalls: PlannedToolCallCandidate[] = [];
  let clarifyingQuestion: string | null = null;

  if ((request.confirmedToolExecutions?.length ?? 0) > 0) {
    for (const toolName of request.confirmedToolExecutions ?? []) {
      const resolvedInput = resolveConfirmedToolInput(toolName, request, tickers);
      if (!resolvedInput) {
        warnings.push(`Missing context for confirmed tool '${toolName}'.`);
        if (toolName === "runPortfolioFullRefresh") {
          missingContext.push("portfolioId");
        }
        if (toolName === "addTickerToWatchlist") {
          if (!request.context.watchlistId) {
            missingContext.push("watchlistId");
          }
          if (!request.context.ticker && tickers.length === 0) {
            missingContext.push("ticker");
          }
        }
        continue;
      }

      toolCalls.push({
        toolName,
        input: resolvedInput,
        purpose: "Confirmed tool execution",
      });
    }

    return {
      intent: "CONFIRM_TOOL_EXECUTION",
      missingContext,
      clarifyingQuestion,
      toolCalls,
      warnings,
    };
  }

  const intent = determineIntent(request.message, tickers);

  if (intent === "DAILY_RISK_CHECK") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push(
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Inspect portfolio composition",
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Evaluate concentration and risk profile",
        },
        {
          toolName: "getGeopoliticalSummary",
          input: {},
          purpose: "Check global risk backdrop",
        },
      );
    }
  }

  if (intent === "PORTFOLIO_REVIEW") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push(
        {
          toolName: "getPortfolioOverview",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Review portfolio holdings overview",
        },
        {
          toolName: "getPortfolioRiskSnapshot",
          input: { portfolioId: request.context.portfolioId },
          purpose: "Review portfolio risk summary",
        },
      );
    }
  }

  if (intent === "PORTFOLIO_RISK_SNAPSHOT") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push({
        toolName: "getPortfolioRiskSnapshot",
        input: { portfolioId: request.context.portfolioId },
        purpose: "Evaluate portfolio risk",
      });
    }
  }

  if (intent === "WATCHLIST_SCORE") {
    if (!request.context.watchlistId) {
      missingContext.push("watchlistId");
    } else {
      toolCalls.push({
        toolName: "scoreWatchlist",
        input: { watchlistId: request.context.watchlistId },
        purpose: "Score watchlist holdings",
      });
    }
  }

  if (intent === "WATCHLIST_ADD") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];

    if (!request.context.watchlistId) {
      missingContext.push("watchlistId");
    }

    if (!ticker) {
      missingContext.push("ticker");
      clarifyingQuestion = clarifyingQuestion ?? buildTickerClarifyingQuestion(tickerResolution);
    }

    if (request.context.watchlistId && ticker) {
      toolCalls.push({
        toolName: "addTickerToWatchlist",
        input: {
          watchlistId: request.context.watchlistId,
          ticker,
          status: "WATCHING",
        },
        purpose: "Add ticker to watchlist",
      });
    }
  }

  if (intent === "RESEARCH_TICKER") {
    const ticker = request.context.ticker?.toUpperCase() ?? tickers[0];

    if (!ticker) {
      missingContext.push("ticker");
      clarifyingQuestion = clarifyingQuestion ?? buildTickerClarifyingQuestion(tickerResolution);
    } else {
      toolCalls.push(
        {
          toolName: "getTickerResearchBundle",
          input: { ticker },
          purpose: "Load full ticker research context",
        },
        {
          toolName: "scoreTickerResearch",
          input: { ticker },
          purpose: "Score ticker deterministically",
        },
      );
    }
  }

  if (intent === "COMPARE_TICKERS") {
    if (tickers.length < 2) {
      missingContext.push("tickers");
    } else {
      toolCalls.push({
        toolName: "compareTickers",
        input: { tickers: tickers.slice(0, 10) },
        purpose: "Compare ticker scorecards",
      });
    }
  }

  if (intent === "REFRESH_REQUEST") {
    if (!request.context.portfolioId) {
      missingContext.push("portfolioId");
    } else {
      toolCalls.push({
        toolName: "runPortfolioFullRefresh",
        input: buildFullRefreshInput(request.context.portfolioId),
        purpose: "Run full portfolio refresh",
      });
    }
  }

  return {
    intent,
    missingContext,
    clarifyingQuestion,
    toolCalls,
    warnings,
  };
}

function toExecutionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Tool execution failed.";
}

async function executePlannedTool(
  planned: PlannedToolExecution,
  context: AgentToolContext,
): Promise<AgentToolResult> {
  const startedAtDate = new Date();

  try {
    return await agentToolExecutor.executeByName({
      toolName: planned.toolName,
      input: planned.input,
      context,
      confirmed: planned.confirmed,
    });
  } catch (error) {
    const finishedAtDate = new Date();
    const tool = agentToolRegistry.getTool(planned.toolName);
    const message = toExecutionErrorMessage(error);
    const warnings =
      error instanceof AgentToolExecutionError && error.statusCode === 404
        ? [message]
        : [];

    return {
      toolName: planned.toolName,
      success: false,
      warnings,
      errors: [message],
      metadata: {
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
        riskLevel: tool?.riskLevel ?? AGENT_TOOL_RISK_LEVEL.READ_ONLY,
        executionMode: tool?.executionMode ?? AGENT_TOOL_EXECUTION_MODE.AUTO_ALLOWED,
        dryRun: Boolean(context.dryRun),
      },
    };
  }
}

export async function runAgentChat(request: AgentChatRequest): Promise<AgentChatResponse> {
  const startedAtDate = new Date();
  const message = request.message.trim();
  const preferCanadianTicker = inferCanadianTickerPreference(request);
  const tickerResolution = await resolveTickerFromMessage(message, request.context.ticker, {
    preferCanadianTicker,
  });

  const resolvedTickerForContext = tickerResolution.confidence === "HIGH"
    ? tickerResolution.ticker
    : undefined;

  const effectiveRequest: AgentChatRequest = {
    ...request,
    message,
    context: {
      ...request.context,
      ticker: resolvedTickerForContext ?? request.context.ticker,
    },
  };

  const tickers = dedupe([
    ...collectMentionedTickers(message, effectiveRequest.context.ticker, {
      preferCanadianTicker,
    }),
    ...(tickerResolution.ticker ? [tickerResolution.ticker] : []),
  ]);

  const resolvedEntities = tickerResolution.source !== "NONE"
    ? { ticker: tickerResolution }
    : undefined;

  const executionContext: AgentToolContext = {
    source: effectiveRequest.context.source,
    userId: effectiveRequest.context.userId,
    portfolioId: effectiveRequest.context.portfolioId,
    requestId: effectiveRequest.context.requestId,
    dryRun: effectiveRequest.dryRun ?? false,
  };

  let modelName: string | undefined;
  let openAiDiagnostics: AgentOpenAiDiagnostics | undefined;
  let plannerUsed = false;
  let plannerFallbackUsed = false;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let plannerSkipReason: "PROVIDER_DISABLED" | "API_KEY_MISSING" | undefined;

  let planningIntent = "GENERAL_QA";
  let planningMissingContext: string[] = [];
  let planningClarifyingQuestion: string | null = null;
  let planningWarnings: string[] = [];
  let plannedToolCount = 0;
  let droppedToolCount = 0;
  let suggestedActions: AgentSuggestedAction[] = [];
  let executableCalls: PlannedToolExecution[] = [];

  const openAiProviderEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const openAiKeyConfigured = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim().length > 0);
  const shouldAttemptPlanner = openAiProviderEnabled && openAiKeyConfigured;

  if (!shouldAttemptPlanner) {
    plannerSkipReason = !openAiProviderEnabled ? "PROVIDER_DISABLED" : "API_KEY_MISSING";
  }

  if (shouldAttemptPlanner) {
    plannerUsed = true;

    try {
      const planResult = await generateToolPlan({
        userMessage: message,
        availableTools: buildToolCatalog(),
        context: {
          userId: effectiveRequest.context.userId,
          portfolioId: effectiveRequest.context.portfolioId,
          watchlistId: effectiveRequest.context.watchlistId,
          ticker: effectiveRequest.context.ticker,
          allowRefresh: effectiveRequest.allowRefresh === true,
          allowMutation: effectiveRequest.allowMutation === true,
          dryRun: effectiveRequest.dryRun === true,
        },
        resolvedEntities,
      });

      modelName = planResult.modelName;

      const parsedPlan = openAiToolPlanOutputSchema.safeParse(planResult.plan);
      if (!parsedPlan.success) {
        throw new OpenAiAgentClientError(
          {
            stage: "VALIDATION_FAILED",
            modelName: planResult.modelName,
          },
          "OpenAI planner JSON did not match schema.",
        );
      }

      if (planResult.usedFallbackModel) {
        planningWarnings.push("Primary OpenAI model was unavailable; fallback model was used for planning.");
      }

      const validatedPlan = validateAndPrepareToolCalls({
        intent: parsedPlan.data.intent,
        toolCalls: parsedPlan.data.toolCalls,
        missingContext: parsedPlan.data.missingContext,
        clarifyingQuestion: parsedPlan.data.clarifyingQuestion,
        request: effectiveRequest,
      });

      planningIntent = validatedPlan.intent;
      planningMissingContext = validatedPlan.missingContext;
      planningClarifyingQuestion = validatedPlan.clarifyingQuestion;
      planningWarnings = dedupe([...planningWarnings, ...validatedPlan.warnings]);
      plannedToolCount = validatedPlan.plannedToolCount;
      droppedToolCount = validatedPlan.droppedToolCount;
      suggestedActions = validatedPlan.suggestedActions;
      executableCalls = validatedPlan.executableCalls;
    } catch (error) {
      plannerFallbackUsed = true;
      fallbackUsed = true;
      fallbackReason = "PLANNER_FAILED";
      planningWarnings.push("OpenAI planner failed; deterministic router fallback used.");

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
  }

  if (!shouldAttemptPlanner || plannerFallbackUsed) {
    const deterministicPlan = buildDeterministicPlan(
      effectiveRequest,
      tickers,
      tickerResolution,
    );

    const validatedPlan = validateAndPrepareToolCalls({
      intent: deterministicPlan.intent,
      toolCalls: deterministicPlan.toolCalls,
      missingContext: deterministicPlan.missingContext,
      clarifyingQuestion: deterministicPlan.clarifyingQuestion,
      request: effectiveRequest,
    });

    planningIntent = validatedPlan.intent;
    planningMissingContext = validatedPlan.missingContext;
    planningClarifyingQuestion = validatedPlan.clarifyingQuestion;
    planningWarnings = dedupe([
      ...planningWarnings,
      ...deterministicPlan.warnings,
      ...validatedPlan.warnings,
    ]);
    plannedToolCount = validatedPlan.plannedToolCount;
    droppedToolCount = validatedPlan.droppedToolCount;
    suggestedActions = mergeRequiredActions(validatedPlan.suggestedActions, suggestedActions);
    executableCalls = validatedPlan.executableCalls;
  }

  const cappedExecutableCalls = executableCalls.slice(0, env.OPENAI_AGENT_MAX_TOOL_CALLS);
  if (executableCalls.length > cappedExecutableCalls.length) {
    droppedToolCount += executableCalls.length - cappedExecutableCalls.length;
  }

  const toolResults = await Promise.all(
    cappedExecutableCalls.map((planned) => executePlannedTool(planned, executionContext)),
  );

  const toolCalls = toolResults.map((result) => toToolCallSummary(result));
  const executedToolCount = toolCalls.length;

  let warnings = dedupe([
    ...planningWarnings,
    ...toolCalls.flatMap((call) => [...call.warnings, ...call.errors]),
  ]);

  let answer = deterministicAnswer({
    intent: planningIntent,
    toolCalls,
    missingContext: planningMissingContext,
    clarifyingQuestion: planningClarifyingQuestion,
    warnings,
    suggestedActions,
  });

  let confidence = deterministicConfidence(toolCalls, warnings, planningMissingContext);
  let mode: AgentChatResponse["metadata"]["mode"] = "DETERMINISTIC_ROUTER";

  if (shouldAttemptPlanner && !plannerFallbackUsed) {
    try {
      const synthesis = await generateAgentSynthesis({
        userMessage: message,
        intent: planningIntent,
        toolResultSummaries: toolCalls.map((call) => ({
          toolName: call.toolName,
          summary: call.summary,
          success: call.success,
          warnings: call.warnings,
          errors: call.errors,
        })),
        warnings,
        missingContext: planningMissingContext,
        suggestedActions,
      });

      const sanitized = sanitizeSuggestedActions(synthesis.synthesis.suggestedActions);

      answer = synthesis.synthesis.answer;
      confidence = synthesis.synthesis.confidence;
      warnings = dedupe([...warnings, ...synthesis.synthesis.warnings, ...sanitized.warnings]);
      suggestedActions = mergeRequiredActions(suggestedActions, sanitized.actions);
      mode = "OPENAI_PLANNED_SYNTHESIS";
      modelName = synthesis.modelName;

      if (synthesis.usedFallbackModel) {
        warnings = dedupe([
          ...warnings,
          "Primary OpenAI model was unavailable; fallback model was used for synthesis.",
        ]);

        if (env.NODE_ENV !== "production" && synthesis.primaryModelFailure) {
          openAiDiagnostics = {
            openAiAttempted: true,
            openAiFailureStage: synthesis.primaryModelFailure.stage,
            openAiErrorCode: synthesis.primaryModelFailure.errorCode,
            openAiStatus: synthesis.primaryModelFailure.status,
            openAiResponsePreview: redactDiagnosticText(
              synthesis.primaryModelFailure.responsePreview,
            ),
            openAiModelName: synthesis.modelName,
          };
        }
      }
    } catch (error) {
      fallbackUsed = true;
      fallbackReason = fallbackReason ?? "SYNTHESIS_FAILED";
      warnings = dedupe([...warnings, "OpenAI synthesis failed; deterministic fallback used."]);
      mode = "DETERMINISTIC_ROUTER";

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
  }

  const finishedAtDate = new Date();

  return {
    answer,
    intent: planningIntent,
    toolCalls,
    suggestedActions: addConfirmationPolicy(suggestedActions),
    warnings,
    missingContext: planningMissingContext,
    confidence,
    metadata: {
      mode,
      modelName,
      fallbackUsed,
      plannerUsed,
      plannerFallbackUsed,
      plannedToolCount,
      executedToolCount,
      droppedToolCount,
      fallbackReason,
      openAiProviderEnabled: env.NODE_ENV !== "production" ? openAiProviderEnabled : undefined,
      openAiKeyConfigured: env.NODE_ENV !== "production" ? openAiKeyConfigured : undefined,
      plannerSkipReason: env.NODE_ENV !== "production" ? plannerSkipReason : undefined,
      startedAt: startedAtDate.toISOString(),
      finishedAt: finishedAtDate.toISOString(),
      durationMs: calculateDurationMs(startedAtDate, finishedAtDate),
      openAiDiagnostics,
    },
  };
}
