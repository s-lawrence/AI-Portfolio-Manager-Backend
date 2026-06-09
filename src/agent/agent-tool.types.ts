import type { ZodType, ZodTypeAny } from "zod";

export const AGENT_TOOL_NAMES = [
  "getPortfolioOverview",
  "getTickerResearchBundle",
  "getWatchlistResearchBundle",
  "getDiscoveryCandidates",
  "getGeopoliticalSummary",
  "getLatestAnalystContext",
  "scoreTickerResearch",
  "scoreWatchlist",
  "compareTickers",
  "getPortfolioRiskSnapshot",
  "runPortfolioFullRefresh",
  "refreshTickerAnalystData",
  "refreshWatchlistAnalystData",
  "refreshDiscoveryCategory",
  "refreshGdeltRiskContext",
  "addTickerToWatchlist",
  "updateWatchlistItem",
  "removeWatchlistItem",
  "rebalancePaperPortfolio",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const AGENT_TOOL_RISK_LEVEL = {
  READ_ONLY: "READ_ONLY",
  REFRESH: "REFRESH",
  MUTATION: "MUTATION",
  HIGH_IMPACT: "HIGH_IMPACT",
} as const;

export type AgentToolRiskLevel =
  (typeof AGENT_TOOL_RISK_LEVEL)[keyof typeof AGENT_TOOL_RISK_LEVEL];

export const AGENT_TOOL_EXECUTION_MODE = {
  AUTO_ALLOWED: "AUTO_ALLOWED",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  DISABLED: "DISABLED",
} as const;

export type AgentToolExecutionMode =
  (typeof AGENT_TOOL_EXECUTION_MODE)[keyof typeof AGENT_TOOL_EXECUTION_MODE];

export type AgentToolRequestSource = "USER" | "AGENT" | "SYSTEM";

export interface AgentToolContext {
  userId?: string;
  portfolioId?: string;
  requestId?: string;
  source: AgentToolRequestSource;
  dryRun?: boolean;
}

export interface AgentToolMetadata {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  riskLevel: AgentToolRiskLevel;
  executionMode: AgentToolExecutionMode;
  dryRun: boolean;
}

export interface AgentToolResult<TData = unknown> {
  toolName: string;
  success: boolean;
  data?: TData;
  warnings: string[];
  errors: string[];
  metadata: AgentToolMetadata;
}

export interface AgentToolDefinition<
  TName extends string = AgentToolName,
  TInput = unknown,
  TOutput = unknown,
> {
  name: TName;
  description: string;
  riskLevel: AgentToolRiskLevel;
  executionMode: AgentToolExecutionMode;
  inputSchema: ZodType<TInput>;
  outputSchema?: ZodType<TOutput>;
  notes: string[];
  execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
}

export interface AgentToolDescriptor {
  name: string;
  description: string;
  riskLevel: AgentToolRiskLevel;
  executionMode: AgentToolExecutionMode;
  notes: string[];
}

export interface ExecuteAgentToolRequest {
  toolName: string;
  input: unknown;
  context: AgentToolContext;
  confirmed?: boolean;
}

export class AgentToolExecutionError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AgentToolExecutionError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export type AnyAgentToolDefinition = AgentToolDefinition<string, any, any>;

export type AgentToolInputSchema = ZodTypeAny;
