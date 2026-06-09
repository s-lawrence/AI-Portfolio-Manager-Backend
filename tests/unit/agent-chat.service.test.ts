import { afterEach, describe, expect, it, vi } from "vitest";

import { runAgentChat } from "../../src/agent/agent-chat.service";
import { agentToolExecutor } from "../../src/agent";
import * as openAiClient from "../../src/agent/openai-agent-client";
import * as entityResolution from "../../src/agent/agent-entity-resolution";
import { OpenAiAgentClientError } from "../../src/agent/openai-agent-client";
import { env } from "../../src/config/env";

function mockToolResult(toolName: string, data: Record<string, unknown> = {}) {
  return {
    toolName,
    success: true,
    data,
    warnings: [],
    errors: [],
    metadata: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 5,
      riskLevel: "READ_ONLY",
      executionMode: "AUTO_ALLOWED",
      dryRun: false,
    },
  };
}

function mockSynthesis(answer: string) {
  return {
    synthesis: {
      answer,
      confidence: "MEDIUM" as const,
      warnings: [],
      suggestedActions: [],
    },
    modelName: env.OPENAI_AGENT_MODEL,
    usedFallbackModel: false,
  };
}

describe("agent-chat.service planner flow", () => {
  const originalProviderEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const originalApiKey = env.OPENAI_API_KEY;
  const originalModel = env.OPENAI_AGENT_MODEL;

  afterEach(() => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = originalProviderEnabled;
    env.OPENAI_API_KEY = originalApiKey;
    env.OPENAI_AGENT_MODEL = originalModel;
    vi.restoreAllMocks();
  });

  it("provider enabled with key configured attempts planner even when deterministic route could answer", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    const plannerSpy = vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: "scoreTickerResearch",
            input: { ticker: "AAPL" },
            purpose: "Score ticker",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Planner attempted."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", { ticker: "AAPL" }) as never,
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(plannerSpy).toHaveBeenCalledTimes(1);
    expect(result.metadata.plannerUsed).toBe(true);
    expect(result.metadata.plannerFallbackUsed).toBe(false);
  });

  it("Take a look at Apple resolves AAPL and planner receives ticker context", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    const plannerSpy = vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: "scoreTickerResearch",
            input: { ticker: "AAPL" },
            purpose: "Score ticker",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Ticker path."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", { ticker: "AAPL" }) as never,
    );

    const result = await runAgentChat({
      message: "Take a look at Apple",
      context: {
        source: "USER",
      },
    });

    expect(plannerSpy).toHaveBeenCalledTimes(1);
    expect(plannerSpy).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        ticker: "AAPL",
      }),
      resolvedEntities: {
        ticker: expect.objectContaining({
          ticker: "AAPL",
          source: "STATIC_ALIAS",
          confidence: "HIGH",
        }),
      },
    }));
    expect(result.metadata.plannerUsed).toBe(true);
    expect(result.missingContext).toEqual([]);
  });

  it("planner output using toolName/input validates normally", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: "scoreTickerResearch",
            input: { ticker: "AAPL" },
            purpose: "Score ticker",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Normalized."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", { ticker: "AAPL" }) as never,
    );

    const result = await runAgentChat({
      message: "Take a look at Apple",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "scoreTickerResearch",
    }));
    expect(result.metadata.plannerFallbackUsed).toBe(false);
  });

  it("planner output using name/arguments is normalized and accepted", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            name: "getTickerResearchBundle",
            arguments: { ticker: "AAPL" },
            purpose: "Load research",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Alias normalized."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getTickerResearchBundle", { ticker: "AAPL" }) as never,
    );

    const result = await runAgentChat({
      message: "Take a look at Apple",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "getTickerResearchBundle",
      input: { ticker: "AAPL" },
    }));
    expect(result.metadata.plannerFallbackUsed).toBe(false);
  });

  it("planner output using name/args is normalized and accepted", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            name: "scoreTickerResearch",
            args: { ticker: "AAPL" },
            purpose: "Score",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Alias args normalized."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", { ticker: "AAPL" }) as never,
    );

    await runAgentChat({
      message: "Take a look at Apple",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "scoreTickerResearch",
      input: { ticker: "AAPL" },
    }));
  });

  it("unknown tool using name/arguments is still dropped", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "GENERAL_QA",
        needsTools: true,
        toolCalls: [
          {
            name: "doSomethingUnsafe",
            arguments: {},
            purpose: "unsafe",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Dropped."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Do something",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.metadata.droppedToolCount).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("Dropped unknown planned tool"))).toBe(true);
  });

  it("invalid input after alias normalization is still dropped", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "COMPARE_TICKERS",
        needsTools: true,
        toolCalls: [
          {
            name: "compareTickers",
            args: { tickers: "AAPL,MSFT" },
            purpose: "compare",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Invalid dropped."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Compare AAPL and MSFT",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.metadata.droppedToolCount).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("Dropped invalid planned input"))).toBe(true);
  });

  it("confirmation-required tool using name/arguments still requires confirmation", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "REFRESH_REQUEST",
        needsTools: true,
        toolCalls: [
          {
            name: "runPortfolioFullRefresh",
            arguments: {
              portfolioId: "portfolio-1",
              refreshMode: "quick",
              includeEconomics: true,
              includeBankOfCanada: true,
              includeFred: true,
              includeAnalystData: true,
              includeGdelt: false,
              runAnalysis: true,
            },
            purpose: "Refresh all portfolio data",
          },
        ],
        missingContext: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Confirm."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Run full refresh",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
      allowRefresh: false,
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.suggestedActions.some((action) => action.toolName === "runPortfolioFullRefresh" && action.requiresConfirmation)).toBe(true);
  });

  it("planner output missing purpose is accepted", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "DAILY_RISK_CHECK",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getGeopoliticalSummary",
            input: {},
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Macro complete."));
    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getGeopoliticalSummary", { ok: true }) as never,
    );

    const result = await runAgentChat({
      message: "Anything I should be worried about?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "getGeopoliticalSummary",
      input: {},
    }));
    expect(result.metadata.plannerFallbackUsed).toBe(false);
  });

  it("planner output missing missingContext is accepted", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "DAILY_RISK_CHECK",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getGeopoliticalSummary",
            input: {},
            purpose: "Check global risk",
          },
        ],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Macro complete."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getGeopoliticalSummary", { ok: true }) as never,
    );

    const result = await runAgentChat({
      message: "Anything I should be worried about?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.plannerFallbackUsed).toBe(false);
    expect(result.missingContext).toEqual([]);
  });

  it("planner output missing requiresConfirmation is accepted", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "DAILY_RISK_CHECK",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getGeopoliticalSummary",
            input: {},
            purpose: "Check macro risk",
          },
        ],
        missingContext: [],
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Macro complete."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getGeopoliticalSummary", { ok: true }) as never,
    );

    const result = await runAgentChat({
      message: "Anything I should be worried about?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.plannerFallbackUsed).toBe(false);
  });

  it("planner output missing clarifyingQuestion is accepted", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "DAILY_RISK_CHECK",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getGeopoliticalSummary",
            input: {},
            purpose: "Check macro risk",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Macro complete."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getGeopoliticalSummary", { ok: true }) as never,
    );

    const result = await runAgentChat({
      message: "Anything I should be worried about?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.plannerFallbackUsed).toBe(false);
  });

  it("planner output with input omitted defaults to {}", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "DAILY_RISK_CHECK",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getGeopoliticalSummary",
            purpose: "Check macro risk",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Macro complete."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getGeopoliticalSummary", { ok: true }) as never,
    );

    await runAgentChat({
      message: "Anything I should be worried about?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "getGeopoliticalSummary",
      input: {},
    }));
  });

  it("invalid actual tool input is dropped after planner validation", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: "scoreTickerResearch",
            purpose: "Score ticker",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Dropped invalid input."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.warnings.some((warning) => warning.includes("Dropped invalid planned input"))).toBe(true);
  });

  it("validation failure diagnostics include issue path, code, and message when planner JSON is truly invalid", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: 123,
            input: { ticker: "AAPL" },
            purpose: "Score",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      } as never,
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Unused."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", {
        ticker: "AAPL",
        compositeScore: 65,
        suggestedStance: "WATCH",
      }) as never,
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.plannerFallbackUsed).toBe(true);
    expect(result.metadata.openAiDiagnostics?.openAiFailureStage).toBe("VALIDATION_FAILED");
    expect(result.metadata.openAiDiagnostics?.validationIssueCount).toBeGreaterThan(0);
    expect(result.metadata.openAiDiagnostics?.validationIssues?.[0]).toEqual(
      expect.objectContaining({
        path: expect.any(String),
        code: expect.any(String),
        message: expect.any(String),
      }),
    );
  });

  it("missing portfolio context includes non-prod received context diagnostics", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const result = await runAgentChat({
      message: "Anything I should be worried about today?",
      context: {
        source: "USER",
      },
    });

    expect(result.missingContext).toContain("portfolioId");
    expect(result.metadata.receivedContextKeys).toEqual(["source"]);
    expect(result.metadata.receivedPortfolioIdConfigured).toBe(false);
    expect(result.metadata.receivedWatchlistIdConfigured).toBe(false);
    expect(result.metadata.receivedTickerConfigured).toBe(false);
  });

  it("provider disabled skips planner with plannerSkipReason=PROVIDER_DISABLED", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const plannerSpy = vi.spyOn(openAiClient, "generateToolPlan");
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", { ticker: "AAPL" }) as never,
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(plannerSpy).not.toHaveBeenCalled();
    expect(result.metadata.plannerUsed).toBe(false);
    expect(result.metadata.plannerSkipReason).toBe("PROVIDER_DISABLED");
  });

  it("key missing skips planner with plannerSkipReason=API_KEY_MISSING", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = undefined;

    const plannerSpy = vi.spyOn(openAiClient, "generateToolPlan");
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", { ticker: "AAPL" }) as never,
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(plannerSpy).not.toHaveBeenCalled();
    expect(result.metadata.plannerUsed).toBe(false);
    expect(result.metadata.plannerSkipReason).toBe("API_KEY_MISSING");
  });

  it("ambiguous company name returns missing ticker context and clarifying question", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Research Royal Bank",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.missingContext).toContain("ticker");
    expect(result.answer).toContain("multiple ticker candidates");
  });

  it("deterministic fallback uses shared ticker resolver", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const resolverSpy = vi.spyOn(entityResolution, "resolveTickerFromMessage").mockResolvedValue({
      ticker: "AAPL",
      confidence: "HIGH",
      source: "STATIC_ALIAS",
      originalText: "apple",
      candidates: [{ ticker: "AAPL", companyName: "Apple Inc." }],
    });

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      return mockToolResult(request.toolName, { ticker: "AAPL" }) as never;
    });

    const result = await runAgentChat({
      message: "Take a look at that fruit company",
      context: {
        source: "USER",
      },
    });

    expect(resolverSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "getTickerResearchBundle",
      input: { ticker: "AAPL" },
    }));
    expect(result.missingContext).toEqual([]);
  });

  it("natural worried message plans portfolio overview, risk snapshot, and geopolitical summary", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "DAILY_RISK_CHECK",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getPortfolioOverview",
            input: { portfolioId: "portfolio-1" },
            purpose: "Review holdings",
          },
          {
            toolName: "getPortfolioRiskSnapshot",
            input: { portfolioId: "portfolio-1" },
            purpose: "Assess concentration risk",
          },
          {
            toolName: "getGeopoliticalSummary",
            input: {},
            purpose: "Assess macro risk",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Risk review complete."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      return mockToolResult(request.toolName, { ok: true }) as never;
    });

    const result = await runAgentChat({
      message: "Anything I should be worried about today?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(executeSpy).toHaveBeenCalledTimes(3);
    expect(executeSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ toolName: "getPortfolioOverview" }));
    expect(executeSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ toolName: "getPortfolioRiskSnapshot" }));
    expect(executeSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ toolName: "getGeopoliticalSummary" }));
    expect(result.metadata.mode).toBe("OPENAI_PLANNED_SYNTHESIS");
  });

  it("take a look at Apple plans research bundle and score for AAPL", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getTickerResearchBundle",
            input: { ticker: "AAPL" },
            purpose: "Load research bundle",
          },
          {
            toolName: "scoreTickerResearch",
            input: { ticker: "AAPL" },
            purpose: "Score ticker",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("AAPL review complete."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      return mockToolResult(request.toolName, { ticker: "AAPL" }) as never;
    });

    const result = await runAgentChat({
      message: "Take a look at Apple",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(executeSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ toolName: "getTickerResearchBundle" }));
    expect(executeSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ toolName: "scoreTickerResearch" }));
    expect(result.metadata.mode).toBe("OPENAI_PLANNED_SYNTHESIS");
  });

  it("watchlist message plans scoreWatchlist when watchlistId exists", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "WATCHLIST_SCORE",
        needsTools: true,
        toolCalls: [
          {
            toolName: "scoreWatchlist",
            input: { watchlistId: "watchlist-1" },
            purpose: "Rank watchlist names",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Watchlist ranked."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreWatchlist", { items: [] }) as never,
    );

    const result = await runAgentChat({
      message: "Which watchlist names look best?",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ toolName: "scoreWatchlist" }));
    expect(result.intent).toBe("WATCHLIST_SCORE");
  });

  it("add to watchlist returns confirmation suggestion and does not mutate without confirmation", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "WATCHLIST_ADD",
        needsTools: true,
        toolCalls: [
          {
            toolName: "addTickerToWatchlist",
            input: { watchlistId: "watchlist-1", ticker: "NVDA", status: "WATCHING" },
            purpose: "Add NVDA to watchlist",
          },
        ],
        missingContext: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Please confirm."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Add NVDA to my watchlist",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.suggestedActions.some((action) => action.toolName === "addTickerToWatchlist" && action.requiresConfirmation)).toBe(true);
  });

  it("unknown planner tool is dropped", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "GENERAL_QA",
        needsTools: true,
        toolCalls: [
          {
            toolName: "doSomethingUnsafe",
            input: {},
            purpose: "unsafe",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("No tools run."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Do something",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.metadata.droppedToolCount).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("Dropped unknown planned tool"))).toBe(true);
  });

  it("invalid planner tool input is dropped with warning", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "COMPARE_TICKERS",
        needsTools: true,
        toolCalls: [
          {
            toolName: "compareTickers",
            input: { tickers: "AAPL,MSFT" },
            purpose: "compare",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Input was invalid."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Compare AAPL and MSFT",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.metadata.droppedToolCount).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("Dropped invalid planned input"))).toBe(true);
  });

  it("planner failure falls back to deterministic router", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockRejectedValue(
      new OpenAiAgentClientError(
        {
          stage: "REQUEST_FAILED",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "planner failed",
      ),
    );

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Unused"));

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      return mockToolResult(request.toolName, { ticker: "AAPL" }) as never;
    });

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.plannerUsed).toBe(true);
    expect(result.metadata.mode).toBe("DETERMINISTIC_ROUTER");
    expect(result.metadata.plannerFallbackUsed).toBe(true);
    expect(result.metadata.fallbackReason).toBe("PLANNER_FAILED");
  });

  it("synthesis failure after planning falls back to deterministic answer with tool results", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "RESEARCH_TICKER",
        needsTools: true,
        toolCalls: [
          {
            toolName: "scoreTickerResearch",
            input: { ticker: "AAPL" },
            purpose: "score",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockRejectedValue(
      new OpenAiAgentClientError(
        {
          stage: "PARSE_FAILED",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "synthesis failed",
      ),
    );

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreTickerResearch", {
        ticker: "AAPL",
        compositeScore: 65,
        suggestedStance: "WATCH",
      }) as never,
    );

    const result = await runAgentChat({
      message: "Take a look at Apple",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.mode).toBe("DETERMINISTIC_ROUTER");
    expect(result.metadata.fallbackReason).toBe("SYNTHESIS_FAILED");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.warnings).toContain("OpenAI synthesis failed; deterministic fallback used.");
  });

  it("refresh tool is not executed without confirmation", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "REFRESH_REQUEST",
        needsTools: true,
        toolCalls: [
          {
            toolName: "runPortfolioFullRefresh",
            input: {
              portfolioId: "portfolio-1",
              refreshMode: "quick",
              includeEconomics: true,
              includeBankOfCanada: true,
              includeFred: true,
              includeAnalystData: true,
              includeGdelt: false,
              runAnalysis: true,
            },
            purpose: "Refresh all portfolio data",
          },
        ],
        missingContext: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Please confirm refresh."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Run full refresh",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
      allowRefresh: false,
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.suggestedActions.some((action) => action.toolName === "runPortfolioFullRefresh" && action.requiresConfirmation)).toBe(true);
  });

  it("confirmed refresh executes only with allowRefresh=true and confirmedToolExecutions includes tool name", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "REFRESH_REQUEST",
        needsTools: true,
        toolCalls: [
          {
            toolName: "runPortfolioFullRefresh",
            input: {
              portfolioId: "portfolio-1",
              refreshMode: "quick",
              includeEconomics: true,
              includeBankOfCanada: true,
              includeFred: true,
              includeAnalystData: true,
              includeGdelt: false,
              runAnalysis: true,
            },
            purpose: "Refresh all portfolio data",
          },
        ],
        missingContext: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Refresh executed."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("runPortfolioFullRefresh", { refreshMode: "quick" }) as never,
    );

    const result = await runAgentChat({
      message: "Confirm refresh",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
      confirmedToolExecutions: ["runPortfolioFullRefresh"],
      allowRefresh: true,
      dryRun: false,
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "runPortfolioFullRefresh",
      confirmed: true,
    }));
    expect(result.metadata.executedToolCount).toBe(1);
  });
});
