import { z } from "zod";

import type { AgentToolExecutionMode, AgentToolRiskLevel, AgentToolRequestSource } from "./agent-tool.types";

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
  mode: "OPENAI_SYNTHESIS" | "DETERMINISTIC_ROUTER";
  modelName?: string;
  fallbackUsed: boolean;
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
    requestId?: string;
  };
}

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
