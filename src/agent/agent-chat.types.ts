import { z } from "zod";

import type {
  AgentToolExecutionMode,
  AgentToolName,
  AgentToolRiskLevel,
  AgentToolRequestSource,
} from "./agent-tool.types";

export const agentConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type AgentConfidence = z.infer<typeof agentConfidenceSchema>;

export interface AgentSuggestedAction {
  label: string;
  toolName?: string;
  input?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface AgentToolCallSummary {
  toolName: string;
  success: boolean;
  warnings: string[];
  errors: string[];
  riskLevel: AgentToolRiskLevel;
  executionMode: AgentToolExecutionMode;
  durationMs: number;
  summary: string;
}

export type OpenAiFailureStage =
  | "REQUEST_FAILED"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "PARSE_FAILED"
  | "VALIDATION_FAILED"
  | "UNSUPPORTED_MODEL"
  | "UNKNOWN";

export interface AgentOpenAiDiagnostics {
  openAiAttempted: true;
  openAiFailureStage: OpenAiFailureStage;
  openAiErrorCode?: string;
  openAiStatus?: number;
  openAiResponsePreview?: string;
  openAiModelName?: string;
}

export interface AgentChatMetadata {
  mode: "OPENAI_PLANNED_SYNTHESIS" | "OPENAI_SYNTHESIS" | "DETERMINISTIC_ROUTER";
  modelName?: string;
  fallbackUsed: boolean;
  plannerUsed: boolean;
  plannerFallbackUsed: boolean;
  plannedToolCount: number;
  executedToolCount: number;
  droppedToolCount: number;
  fallbackReason?: string;
  openAiProviderEnabled?: boolean;
  openAiKeyConfigured?: boolean;
  plannerSkipReason?: "PROVIDER_DISABLED" | "API_KEY_MISSING";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  openAiDiagnostics?: AgentOpenAiDiagnostics;
}

export interface AgentChatResponse {
  answer: string;
  intent: string;
  toolCalls: AgentToolCallSummary[];
  suggestedActions: AgentSuggestedAction[];
  warnings: string[];
  missingContext: string[];
  confidence: AgentConfidence;
  metadata: AgentChatMetadata;
}

export interface AgentChatRequest {
  message: string;
  context: {
    source: AgentToolRequestSource;
    userId?: string;
    portfolioId?: string;
    watchlistId?: string;
    ticker?: string;
    requestId?: string;
  };
  confirmedToolExecutions?: AgentToolName[];
  confirmedToolInputs?: Partial<Record<AgentToolName, Record<string, unknown>>>;
  allowRefresh?: boolean;
  allowMutation?: boolean;
  dryRun?: boolean;
}

export type AgentTickerResolutionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type AgentTickerResolutionSource =
  | "EXPLICIT"
  | "TICKER_PATTERN"
  | "STATIC_ALIAS"
  | "STOCK_DB"
  | "NONE"
  | "AMBIGUOUS";

export interface AgentTickerResolutionCandidate {
  ticker: string;
  companyName?: string;
  exchange?: string;
  currency?: string;
}

export interface AgentTickerResolutionResult {
  ticker?: string;
  confidence: AgentTickerResolutionConfidence;
  source: AgentTickerResolutionSource;
  originalText?: string;
  candidates?: AgentTickerResolutionCandidate[];
}

export interface OpenAiToolCatalogItem {
  name: AgentToolName;
  description: string;
  riskLevel: AgentToolRiskLevel;
  executionMode: AgentToolExecutionMode;
  inputSchemaSummary: string;
}

export interface OpenAiToolPlannerInput {
  userMessage: string;
  availableTools: OpenAiToolCatalogItem[];
  context: {
    userId?: string;
    portfolioId?: string;
    watchlistId?: string;
    ticker?: string;
    allowRefresh: boolean;
    allowMutation: boolean;
    dryRun: boolean;
  };
  resolvedEntities?: {
    ticker?: AgentTickerResolutionResult;
  };
  recentConversationSummary?: string;
}

export const openAiToolPlanToolCallSchema = z.object({
  toolName: z.string().trim().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  purpose: z.string().trim().min(1),
});

export const openAiToolPlanOutputSchema = z.object({
  intent: z.string().trim().min(1),
  needsTools: z.boolean(),
  toolCalls: z.array(openAiToolPlanToolCallSchema).max(20).default([]),
  missingContext: z.array(z.string().trim().min(1)).max(20).default([]),
  requiresConfirmation: z.boolean().default(false),
  clarifyingQuestion: z.string().trim().min(1).nullable().default(null),
});

export type OpenAiToolPlanOutput = z.infer<typeof openAiToolPlanOutputSchema>;

export const openAiAgentSynthesisOutputSchema = z.object({
  answer: z.string().trim().min(1),
  confidence: agentConfidenceSchema,
  warnings: z.array(z.string().trim().min(1)).max(20).default([]),
  suggestedActions: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        toolName: z.string().trim().min(1).optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        requiresConfirmation: z.boolean().optional(),
      }),
    )
    .max(10)
    .default([]),
});

export type OpenAiAgentSynthesisOutput = z.infer<typeof openAiAgentSynthesisOutputSchema>;

export interface OpenAiAgentSynthesisInput {
  userMessage: string;
  intent: string;
  toolResultSummaries: Array<{
    toolName: string;
    summary: string;
    success: boolean;
    warnings: string[];
    errors: string[];
  }>;
  warnings: string[];
  missingContext: string[];
  suggestedActions: AgentSuggestedAction[];
}
