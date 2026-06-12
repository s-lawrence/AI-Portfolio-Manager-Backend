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
  const originalFallbackModel = env.OPENAI_AGENT_MODEL_FALLBACK;
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = originalProviderEnabled;
    env.OPENAI_API_KEY = originalApiKey;
    env.OPENAI_AGENT_MODEL = originalModel;
    env.OPENAI_AGENT_MODEL_FALLBACK = originalFallbackModel;
    env.NODE_ENV = originalNodeEnv;
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

  it("scoreWatchlist summary uses scored counters and top ranked ticker", async () => {
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
            purpose: "Rank watchlist entries",
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

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreWatchlist", {
        totalItems: 5,
        activeItemsCount: 4,
        scoredItemsCount: 1,
        skippedItemsCount: 3,
        rankedItems: [{ ticker: "NVDA", compositeScore: 78.4 }],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Which watchlist names look best?",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    expect(result.toolCalls[0]?.summary).toContain("total=5");
    expect(result.toolCalls[0]?.summary).toContain("scored=1");
    expect(result.toolCalls[0]?.summary).toContain("NVDA");
  });

  it("suggests watchlist refresh when scoreWatchlist indicates coverage gaps", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreWatchlist", {
        watchlistId: "watchlist-1",
        totalItems: 4,
        activeItemsCount: 4,
        scoredItemsCount: 1,
        skippedItemsCount: 3,
        rankedItems: [{ ticker: "NVDA", compositeScore: 75.2 }],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Are any of the items in my watchlist a good time to buy?",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    expect(result.suggestedActions.some((action) =>
      action.toolName === "refreshWatchlistResearchData" && action.requiresConfirmation,
    )).toBe(true);
  });

  it("suggests ticker analyst refresh when ticker data quality is weak", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "TICKER_DEEP_DIVE",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getTickerDataQuality",
            input: { ticker: "NVDA" },
            purpose: "Check ticker data quality",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(
      mockSynthesis("Ticker quality reviewed."),
    );

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getTickerDataQuality", {
        ticker: "NVDA",
        missingData: ["analyst", "news"],
        staleDataWarnings: [],
        suggestedRefreshActions: ["refreshTickerAnalystData"],
      }) as never,
    );

    const result = await runAgentChat({
      message: "How complete is NVDA data?",
      context: {
        source: "USER",
        ticker: "NVDA",
      },
    });

    expect(result.suggestedActions.some((action) =>
      action.toolName === "refreshTickerAnalystData" && action.requiresConfirmation,
    )).toBe(true);
  });

  it("deterministic watchlist intent handles buy-timing phrasing", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("scoreWatchlist", {
        totalItems: 3,
        activeItemsCount: 3,
        scoredItemsCount: 1,
        skippedItemsCount: 2,
        rankedItems: [{ ticker: "NVDA", compositeScore: 64.6 }],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Are any of the items in my watchlist a good time to buy?",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    expect(result.intent).toBe("WATCHLIST_SCORE");
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "scoreWatchlist",
      input: { watchlistId: "watchlist-1" },
    }));
  });

  it("watchlist synthesis warnings use snapshot wording and avoid false absent-price/fundamental claims", async () => {
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
            purpose: "Rank watchlist entries",
          },
          {
            toolName: "getWatchlistResearchBundle",
            input: { watchlistId: "watchlist-1" },
            purpose: "Load persisted watchlist snapshots",
          },
          {
            toolName: "getWatchlistDataQuality",
            input: { watchlistId: "watchlist-1" },
            purpose: "Assess watchlist data quality",
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

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "scoreWatchlist") {
        return mockToolResult("scoreWatchlist", {
          watchlistId: "watchlist-1",
          totalItems: 3,
          activeItemsCount: 3,
          scoredItemsCount: 3,
          skippedItemsCount: 0,
          rankedItems: [{ ticker: "NVDA", compositeScore: 82.1 }],
        }) as never;
      }

      if (request.toolName === "getWatchlistResearchBundle") {
        return mockToolResult("getWatchlistResearchBundle", {
          watchlist: { id: "watchlist-1" },
          itemCount: 3,
          items: [
            {
              ticker: "NVDA",
              latestPriceSnapshot: { price: 100 },
              latestFundamentalSnapshot: { peRatio: 30 },
              missingResearchData: [],
            },
          ],
        }) as never;
      }

      if (request.toolName === "getWatchlistDataQuality") {
        return mockToolResult("getWatchlistDataQuality", {
          watchlistId: "watchlist-1",
          perTickerQuality: [
            {
              ticker: "NVDA",
              hasPrice: true,
              hasFundamental: true,
              missingData: [],
              staleDataWarnings: [],
            },
          ],
        }) as never;
      }

      return mockToolResult(request.toolName, {}) as never;
    });

    const result = await runAgentChat({
      message: "Are any of the items in my watchlist a good time to buy?",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    const warningsText = result.warnings.join(" ").toLowerCase();
    expect(warningsText).toContain("persisted backend snapshots");
    expect(warningsText).toContain("not live brokerage quotes");
    expect(warningsText).not.toContain("no live market prices or fresh fundamentals were provided");
    expect(warningsText).not.toContain("lacks persisted price and fundamental snapshots");
  });

  it("watchlist synthesis warnings mention specific missing/stale fields when reported", async () => {
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
            purpose: "Rank watchlist entries",
          },
          {
            toolName: "getWatchlistDataQuality",
            input: { watchlistId: "watchlist-1" },
            purpose: "Assess watchlist data quality",
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

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "scoreWatchlist") {
        return mockToolResult("scoreWatchlist", {
          watchlistId: "watchlist-1",
          totalItems: 2,
          activeItemsCount: 2,
          scoredItemsCount: 1,
          skippedItemsCount: 1,
          rankedItems: [{ ticker: "NVDA", compositeScore: 75.5 }],
        }) as never;
      }

      if (request.toolName === "getWatchlistDataQuality") {
        return mockToolResult("getWatchlistDataQuality", {
          watchlistId: "watchlist-1",
          perTickerQuality: [
            {
              ticker: "NVDA",
              hasPrice: true,
              hasFundamental: false,
              missingData: ["fundamental", "news"],
              staleDataWarnings: ["Price snapshot appears stale (5 days old)."],
            },
          ],
        }) as never;
      }

      return mockToolResult(request.toolName, {}) as never;
    });

    const result = await runAgentChat({
      message: "Are any of the items in my watchlist a good time to buy?",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    const warningsText = result.warnings.join(" ").toLowerCase();
    expect(warningsText).toContain("missing/stale fields detected");
    expect(warningsText).toContain("price");
    expect(warningsText).toContain("fundamental");
    expect(warningsText).toContain("news");
  });

  it("watchlist refresh prompt suggests confirmation action for refreshWatchlistResearchData", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Refresh my watchlist research data",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.intent).toBe("WATCHLIST_REFRESH_REQUEST");
    expect(result.suggestedActions.some((action) =>
      action.toolName === "refreshWatchlistResearchData" && action.requiresConfirmation === true,
    )).toBe(true);
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

  it("confirmed add uses resolved NVDA ticker and does not use ADD command word", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("addTickerToWatchlist", { ticker: "NVDA" }) as never,
    );

    await runAgentChat({
      message: "Confirm add NVDA to my watchlist",
      context: {
        source: "USER",
        watchlistId: "watchlist-1",
      },
      confirmedToolExecutions: ["addTickerToWatchlist"],
      allowMutation: true,
      dryRun: false,
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "addTickerToWatchlist",
      input: expect.objectContaining({
        ticker: "NVDA",
      }),
      confirmed: true,
    }));
    expect(executeSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        ticker: "ADD",
      }),
    }));
  });

  it("drops FX pseudo-ticker analyst refresh and suggests USD/CAD FX refresh", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "REFRESH_REQUEST",
        needsTools: true,
        toolCalls: [
          {
            toolName: "refreshTickerAnalystData",
            input: { ticker: "FX" },
            purpose: "Refresh FX/risk data",
          },
        ],
        missingContext: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Use safer refresh."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Refresh FX/risk data and USD/CAD rate",
      context: {
        source: "USER",
      },
      allowRefresh: false,
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.warnings.some((warning) => warning.includes("Dropped ticker refresh for FX/risk context"))).toBe(true);
    expect(result.suggestedActions.some((action) => action.toolName === "refreshUsdCadFxRate")).toBe(true);
    expect(result.suggestedActions.some((action) => action.toolName === "refreshTickerAnalystData")).toBe(false);
  });

  it("drops non-geopolitical GDELT refresh planning", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "REFRESH_REQUEST",
        needsTools: true,
        toolCalls: [
          {
            toolName: "refreshGdeltRiskContext",
            input: { mode: "quick" },
            purpose: "Refresh risk data",
          },
        ],
        missingContext: [],
        requiresConfirmation: true,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("No GDELT action."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Refresh FX/risk data",
      context: {
        source: "USER",
      },
      allowRefresh: false,
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.warnings.some((warning) => warning.includes("Dropped non-geopolitical GDELT refresh request."))).toBe(true);
    expect(result.suggestedActions.some((action) => action.toolName === "refreshGdeltRiskContext")).toBe(false);
  });

  it("suggests USD/CAD FX refresh when risk snapshot reports missing FX rates", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getPortfolioRiskSnapshot", {
        topRisks: [],
        holdingsMissingFx: [{ ticker: "SHOP", currency: "USD" }],
        missingData: ["Missing FX rates for 1 holding(s): SHOP."],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Show portfolio risk",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.suggestedActions.some((action) => action.toolName === "refreshUsdCadFxRate" && action.requiresConfirmation)).toBe(true);
  });

  it("does not suggest USD/CAD FX refresh when holdingsMissingFx is empty", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("getPortfolioRiskSnapshot", {
        topRisks: ["Some holdings are missing currency metadata"],
        holdingsMissingFx: [],
        missingData: ["Some holdings are missing currency metadata: SHOP."],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Show portfolio risk",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.suggestedActions.some((action) => action.toolName === "refreshUsdCadFxRate")).toBe(false);
  });

  it("confirmed USD/CAD FX refresh executes only with allowRefresh=true", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("refreshUsdCadFxRate", { recordsCreated: 1 }) as never,
    );

    const result = await runAgentChat({
      message: "Confirm: Refresh USD/CAD FX rate",
      context: {
        source: "USER",
      },
      confirmedToolExecutions: ["refreshUsdCadFxRate"],
      allowRefresh: true,
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "refreshUsdCadFxRate",
      confirmed: true,
    }));
    expect(result.metadata.executedToolCount).toBe(1);
  });

  it("planner failure still executes deterministic portfolio review tools when portfolioId is present", async () => {
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

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      return mockToolResult(request.toolName, {
        portfolioId: "portfolio-1",
      }) as never;
    });

    const result = await runAgentChat({
      message: "Review my portfolio",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.plannerFallbackUsed).toBe(true);
    expect(result.toolCalls.map((call) => call.toolName)).toEqual(expect.arrayContaining([
      "getPortfolioOverview",
      "getPortfolioRiskSnapshot",
      "getPortfolioDataQuality",
    ]));
  });

  it("missing portfolioId returns missingContext portfolioId for portfolio review intent", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName");

    const result = await runAgentChat({
      message: "Review my portfolio",
      context: {
        source: "USER",
      },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.missingContext).toContain("portfolioId");
    expect(result.answer).toContain("I need additional context");
  });

  it("production mode hides raw planner diagnostics and keeps user-safe warning", async () => {
    env.NODE_ENV = "production";
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

    vi.spyOn(agentToolExecutor, "executeByName").mockRejectedValue(
      new Error("internal details should not leak"),
    );

    const result = await runAgentChat({
      message: "Review my portfolio",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.openAiDiagnostics).toBeUndefined();
    expect(result.warnings).toContain("Tool execution failed.");
    expect(result.warnings.some((warning) => warning.includes("OpenAI planner failed"))).toBe(false);
  });

  it("non-production includes blocked tool and execution error diagnostics", async () => {
    env.NODE_ENV = "development";
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "PORTFOLIO_REVIEW",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getPortfolioOverview",
            input: { portfolioId: "portfolio-other" },
            purpose: "Try alternate portfolio",
          },
          {
            toolName: "getGeopoliticalSummary",
            input: {},
            purpose: "Macro context",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Fallback summary."));

    vi.spyOn(agentToolExecutor, "executeByName").mockRejectedValue(new Error("boom"));

    const result = await runAgentChat({
      message: "Review my portfolio",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.blockedToolCount).toBe(1);
    expect(result.metadata.blockedTools?.[0]).toMatchObject({
      toolName: "getPortfolioOverview",
    });
    expect(result.metadata.toolExecutionErrors?.[0]).toMatchObject({
      toolName: "getGeopoliticalSummary",
      code: "TOOL_EXECUTION_FAILED",
    });
  });

  it("top-three recommendation prompts execute ranking, risk, and quality tools even when planner under-tools", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "PORTFOLIO_REVIEW",
        needsTools: true,
        toolCalls: [
          {
            toolName: "getPortfolioOverview",
            input: { portfolioId: "portfolio-1" },
            purpose: "Inspect portfolio",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Ranked summary."));

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) =>
      mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never,
    );

    const result = await runAgentChat({
      message: "What are your top three recommendations for my portfolio based on current metrics?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    const executedToolNames = executeSpy.mock.calls.map((call) => call[0]?.toolName);
    expect(executedToolNames).toEqual(expect.arrayContaining([
      "rankPortfolioHoldings",
      "getPortfolioRiskSnapshot",
      "getPortfolioDataQuality",
    ]));
    expect(result.intent).toBe("PORTFOLIO_RECOMMENDATIONS");
  });

  it("deterministic fallback for top recommendations does not run only portfolio overview", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) =>
      mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never,
    );

    await runAgentChat({
      message: "Rank my portfolio and give me the top three positions.",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    const executedToolNames = executeSpy.mock.calls.map((call) => call[0]?.toolName);
    expect(executedToolNames).toEqual(expect.arrayContaining([
      "rankPortfolioHoldings",
      "getPortfolioRiskSnapshot",
      "getPortfolioDataQuality",
    ]));
    expect(executedToolNames.filter((toolName) => toolName === "getPortfolioOverview").length).toBeLessThan(executedToolNames.length);
  });

  it("market candidate discovery intent executes ranking/risk/quality toolset deterministically", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "rankDiscoveryCandidates") {
        return mockToolResult("rankDiscoveryCandidates", {
          category: "GAINERS",
          totalCandidates: 8,
          scoredCandidatesCount: 5,
          skippedCandidatesCount: 3,
          noQualifiedCandidates: false,
          recommendationThreshold: {
            minimumRecommendationScore: 60,
          },
          rankedCandidates: [
            {
              rank: 1,
              ticker: "NVDA",
              companyName: "NVIDIA Corporation",
              compositeScore: 82.4,
              suggestedStance: "STRONG_CANDIDATE",
              actionLabel: "Strong review candidate",
              qualifiesForRecommendation: true,
              why: ["Revenue growth is positive."],
              cautions: ["RSI is elevated and may signal short-term exhaustion."],
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
              diversificationNotes: ["Not currently held; can be evaluated as a potential diversification candidate."],
              missingData: [],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
            {
              rank: 2,
              ticker: "MSFT",
              companyName: "Microsoft Corporation",
              compositeScore: 79.3,
              suggestedStance: "CANDIDATE",
              actionLabel: "Review candidate",
              qualifiesForRecommendation: true,
              why: ["Price is above SMA200."],
              cautions: ["Valuation ratios are mostly unavailable."],
              bullishFactors: ["Price is above SMA200."],
              bearishFactors: ["Valuation ratios are mostly unavailable."],
              diversificationNotes: ["Sector differs from largest current sector (Technology), which may improve diversification."],
              missingData: [],
              staleDataWarnings: [],
              alreadyInWatchlist: true,
            },
          ],
          recommendedCandidates: [
            {
              rank: 1,
              ticker: "NVDA",
              companyName: "NVIDIA Corporation",
              compositeScore: 82.4,
              suggestedStance: "STRONG_CANDIDATE",
              actionLabel: "Strong review candidate",
              qualifiesForRecommendation: true,
              why: ["Revenue growth is positive."],
              cautions: ["RSI is elevated and may signal short-term exhaustion."],
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
              diversificationNotes: ["Not currently held; can be evaluated as a potential diversification candidate."],
              missingData: [],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
            {
              rank: 2,
              ticker: "MSFT",
              companyName: "Microsoft Corporation",
              compositeScore: 79.3,
              suggestedStance: "CANDIDATE",
              actionLabel: "Review candidate",
              qualifiesForRecommendation: true,
              why: ["Price is above SMA200."],
              cautions: ["Valuation ratios are mostly unavailable."],
              bullishFactors: ["Price is above SMA200."],
              bearishFactors: ["Valuation ratios are mostly unavailable."],
              diversificationNotes: ["Sector differs from largest current sector (Technology), which may improve diversification."],
              missingData: [],
              staleDataWarnings: [],
              alreadyInWatchlist: true,
            },
          ],
          monitorCandidates: [],
          notRecommendedCandidates: [],
          bestAvailableButBelowThreshold: [],
          skippedCandidates: [],
          warnings: [],
          suggestedRefreshActions: [],
        }) as never;
      }

      return mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never;
    });

    const result = await runAgentChat({
      message: "Find candidate tickers for a new holding from discovery data",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
      },
    });

    const executedToolNames = executeSpy.mock.calls.map((call) => call[0]?.toolName);
    expect(result.intent).toBe("MARKET_CANDIDATE_DISCOVERY");
    expect(executedToolNames).toEqual(expect.arrayContaining([
      "getPortfolioOverview",
      "getPortfolioRiskSnapshot",
      "getPortfolioDataQuality",
      "rankDiscoveryCandidates",
    ]));
    expect(result.answer).toContain("Qualified new-holding recommendations from persisted GAINERS discovery data");
    expect(result.answer).toContain("1. NVDA (NVIDIA Corporation)");
    expect(result.answer).toContain("Decision support only, not a buy/sell instruction.");

    const addActions = result.suggestedActions.filter((action) => action.toolName === "addTickerToWatchlist");
    expect(addActions.length).toBe(1);
    expect(addActions[0]?.input).toMatchObject({
      watchlistId: "watchlist-1",
      ticker: "NVDA",
      status: "CANDIDATE",
      source: "AGENT",
    });
    expect(addActions[0]?.requiresConfirmation).toBe(true);
  });

  it("market candidate discovery without watchlistId does not suggest add-to-watchlist actions", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "rankDiscoveryCandidates") {
        return mockToolResult("rankDiscoveryCandidates", {
          category: "GAINERS",
          totalCandidates: 2,
          scoredCandidatesCount: 2,
          skippedCandidatesCount: 0,
          noQualifiedCandidates: false,
          recommendationThreshold: {
            minimumRecommendationScore: 60,
          },
          rankedCandidates: [
            {
              rank: 1,
              ticker: "AAPL",
              companyName: "Apple Inc.",
              compositeScore: 78.1,
              suggestedStance: "CANDIDATE",
              actionLabel: "Review candidate",
              qualifiesForRecommendation: true,
              why: ["Revenue growth is positive."],
              cautions: ["RSI is elevated and may signal short-term exhaustion."],
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
              diversificationNotes: ["Portfolio context was not provided; diversification fit could not be fully assessed."],
              missingData: [],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
          ],
          recommendedCandidates: [
            {
              rank: 1,
              ticker: "AAPL",
              companyName: "Apple Inc.",
              compositeScore: 78.1,
              suggestedStance: "CANDIDATE",
              actionLabel: "Review candidate",
              qualifiesForRecommendation: true,
              why: ["Revenue growth is positive."],
              cautions: ["RSI is elevated and may signal short-term exhaustion."],
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
              diversificationNotes: ["Portfolio context was not provided; diversification fit could not be fully assessed."],
              missingData: [],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
          ],
          monitorCandidates: [],
          notRecommendedCandidates: [],
          bestAvailableButBelowThreshold: [],
          skippedCandidates: [],
          warnings: [],
          suggestedRefreshActions: [],
        }) as never;
      }

      return mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never;
    });

    const result = await runAgentChat({
      message: "Suggest candidate stocks from discovery for a new holding",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.intent).toBe("MARKET_CANDIDATE_DISCOVERY");
    expect(result.suggestedActions.some((action) => action.toolName === "addTickerToWatchlist")).toBe(false);
  });

  it("discovery no-qualified response avoids watchlist mutation suggestions and prioritizes refresh", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "rankDiscoveryCandidates") {
        return mockToolResult("rankDiscoveryCandidates", {
          category: "GAINERS",
          totalCandidates: 3,
          scoredCandidatesCount: 3,
          skippedCandidatesCount: 0,
          noQualifiedCandidates: true,
          reasonNoQualifiedCandidates: "Top names are HOLD_OFF and below quality threshold.",
          recommendationThreshold: {
            minimumRecommendationScore: 60,
          },
          rankedCandidates: [
            {
              rank: 1,
              ticker: "XYZ",
              companyName: "XYZ Corp",
              compositeScore: 48.2,
              suggestedStance: "HOLD_OFF",
              actionLabel: "Not recommended from current snapshot",
              qualifiesForRecommendation: false,
              why: ["Short-term move detected."],
              cautions: ["Insufficient quality and analyst context."],
              missingData: ["analyst"],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
          ],
          recommendedCandidates: [],
          monitorCandidates: [],
          notRecommendedCandidates: [
            {
              rank: 1,
              ticker: "XYZ",
              companyName: "XYZ Corp",
              compositeScore: 48.2,
              suggestedStance: "HOLD_OFF",
              actionLabel: "Not recommended from current snapshot",
              qualifiesForRecommendation: false,
              why: ["Short-term move detected."],
              cautions: ["Insufficient quality and analyst context."],
              missingData: ["analyst"],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
          ],
          bestAvailableButBelowThreshold: [
            {
              rank: 1,
              ticker: "XYZ",
              companyName: "XYZ Corp",
              compositeScore: 48.2,
              suggestedStance: "HOLD_OFF",
              actionLabel: "Not recommended from current snapshot",
              qualifiesForRecommendation: false,
              why: ["Short-term move detected."],
              cautions: ["Insufficient quality and analyst context."],
              missingData: ["analyst"],
              staleDataWarnings: [],
              alreadyInWatchlist: false,
            },
          ],
          skippedCandidates: [],
          warnings: [],
          suggestedRefreshActions: ["refreshDiscoveryCategory"],
        }) as never;
      }

      return mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never;
    });

    const result = await runAgentChat({
      message: "Find candidate tickers for a new holding from discovery data",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
      },
    });

    expect(result.answer).toContain("none met the minimum score/quality threshold");
    expect(result.answer).toContain("Best available but below threshold");
    expect(result.suggestedActions.some((action) => action.toolName === "addTickerToWatchlist")).toBe(false);
    expect(result.suggestedActions.some((action) => action.toolName === "refreshDiscoveryCategory")).toBe(true);
  });

  it("confirmed refreshDiscoveryCategory defaults category to GAINERS when input missing", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("refreshDiscoveryCategory", { category: "GAINERS", refreshed: true }) as never,
    );

    await runAgentChat({
      message: "Confirm refresh discovery candidates",
      context: {
        source: "USER",
      },
      confirmedToolExecutions: ["refreshDiscoveryCategory"],
      allowRefresh: true,
      dryRun: false,
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "refreshDiscoveryCategory",
      confirmed: true,
      input: expect.objectContaining({
        category: "GAINERS",
      }),
    }));
  });

  it("confirmed refreshDiscoveryCategory uses explicit confirmedToolInputs map", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = undefined;

    const executeSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("refreshDiscoveryCategory", { category: "LOSERS", refreshed: true }) as never,
    );

    await runAgentChat({
      message: "Confirm refresh losers discovery",
      context: {
        source: "USER",
      },
      confirmedToolExecutions: ["refreshDiscoveryCategory"],
      confirmedToolInputs: {
        refreshDiscoveryCategory: {
          category: "LOSERS",
        },
      },
      allowRefresh: true,
      dryRun: false,
    });

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "refreshDiscoveryCategory",
      confirmed: true,
      input: expect.objectContaining({
        category: "LOSERS",
      }),
    }));
  });

  it("deterministic recommendation answer is structured, readable, and includes recommendation cards", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "rankPortfolioHoldings") {
        return mockToolResult("rankPortfolioHoldings", {
          portfolioId: "portfolio-1",
          totalHoldings: 5,
          scoredHoldingsCount: 5,
          skippedHoldingsCount: 0,
          skippedHoldings: [],
          rankedHoldings: [
            {
              rank: 1,
              ticker: "NVDA",
              companyName: "NVIDIA Corporation",
              compositeScore: 82.3,
              suggestedStance: "STRONG_CANDIDATE",
              componentScores: { dataQualityScore: 88 },
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
              missingData: [],
              staleDataWarnings: [],
            },
            {
              rank: 2,
              ticker: "GOOGL",
              companyName: "Alphabet Inc.",
              compositeScore: 80.8,
              suggestedStance: "WATCH",
              componentScores: { dataQualityScore: 74 },
              bullishFactors: ["Price is above SMA200.", "Analyst consensus is constructive."],
              bearishFactors: ["Valuation ratios are mostly unavailable."],
              missingData: [],
              staleDataWarnings: [],
            },
            {
              rank: 3,
              ticker: "AMZN",
              compositeScore: 79.9,
              suggestedStance: "CANDIDATE",
              componentScores: { dataQualityScore: 34 },
              bullishFactors: ["Analyst consensus is constructive."],
              bearishFactors: ["Recent news sentiment skews negative."],
              missingData: ["technical", "fundamental", "news"],
              staleDataWarnings: ["Fundamental snapshot is stale."],
            },
          ],
          warnings: [],
        }) as never;
      }

      if (request.toolName === "getPortfolioRiskSnapshot") {
        return mockToolResult("getPortfolioRiskSnapshot", {
          topRisks: ["Single-name concentration is high in NVDA."],
        }) as never;
      }

      if (request.toolName === "getPortfolioDataQuality") {
        return mockToolResult("getPortfolioDataQuality", {
          missingFxIssues: [{ ticker: "NVDA", currency: "USD" }],
          missingCurrencyIssues: [],
          missingPriceIssues: [],
          staleDataWarnings: ["USD/CAD FX snapshot appears stale (5 days old)."],
        }) as never;
      }

      return mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never;
    });

    const result = await runAgentChat({
      message: "What are your top three recommendations for my portfolio based on current metrics?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.answer).toContain("Snapshot-based decision support from persisted backend scoring");
    expect(result.answer).toContain("Top 3 recommendations:");
    expect(result.answer).toContain("1. NVDA (NVIDIA Corporation)");
    expect(result.answer).toContain("2. GOOGL (Alphabet Inc.)");
    expect(result.answer).toContain("3. AMZN");
    expect(result.answer).toContain("Action: Review / Candidate");
    expect(result.answer).toContain("Action: Hold / Monitor");
    expect(result.answer).toContain("Action: Data cleanup needed");
    expect(result.answer).toContain("Why it ranks here:");
    expect(result.answer).toContain("Main caution:");
    expect(result.answer).toContain("Suggested next step:");
    expect(result.answer).toContain("Portfolio-level caveats:");
    expect(result.answer).toContain("Decision support only, not a buy/sell instruction.");
    expect(result.answer.toLowerCase()).not.toContain("without specific performance or metric data");
    expect(result.answer.toLowerCase()).not.toContain("cannot identify");
    expect(result.answer).not.toMatch(/1\)\s+[A-Z.]+\s+[\-\u2014]/);

    expect(result.recommendationCards).toHaveLength(3);
    expect(result.recommendationCards?.[0]).toMatchObject({
      rank: 1,
      ticker: "NVDA",
      actionLabel: "Review / Candidate",
      score: 82.3,
      stance: "STRONG_CANDIDATE",
    });
    expect(result.recommendationCards?.[0]?.why.length).toBeGreaterThan(0);
    expect(result.recommendationCards?.[0]?.cautions.length).toBeGreaterThan(0);
  });

  it("translates AVOID stance to Trim / Risk review action label", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "rankPortfolioHoldings") {
        return mockToolResult("rankPortfolioHoldings", {
          portfolioId: "portfolio-1",
          totalHoldings: 3,
          scoredHoldingsCount: 3,
          skippedHoldingsCount: 0,
          skippedHoldings: [],
          rankedHoldings: [
            {
              rank: 1,
              ticker: "AAPL",
              compositeScore: 70.5,
              suggestedStance: "AVOID",
              componentScores: { dataQualityScore: 80 },
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["Debt-to-equity is elevated."],
              missingData: [],
              staleDataWarnings: [],
            },
          ],
          warnings: [],
        }) as never;
      }

      if (request.toolName === "getPortfolioRiskSnapshot") {
        return mockToolResult("getPortfolioRiskSnapshot", {
          topRisks: ["Single-name concentration is high in AAPL."],
          concentrationRisks: [{ type: "HOLDING", key: "AAPL", sharePercent: 52, message: "Single-name concentration is high in AAPL." }],
          sectorExposure: [{ key: "TECH", holdings: 1, marketValueCad: 1000, sharePercent: 52 }],
        }) as never;
      }

      if (request.toolName === "getPortfolioDataQuality") {
        return mockToolResult("getPortfolioDataQuality", {
          missingFxIssues: [],
          missingCurrencyIssues: [],
          missingPriceIssues: [],
          staleDataWarnings: [],
        }) as never;
      }

      return mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never;
    });

    const result = await runAgentChat({
      message: "Top recommendations for my portfolio",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.answer).toContain("Action: Trim / Risk review");
    expect(result.recommendationCards?.[0]?.actionLabel).toBe("Trim / Risk review");
  });

  it("uses the same structured recommendation format when OpenAI synthesis fails", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "PORTFOLIO_RECOMMENDATIONS",
        needsTools: true,
        toolCalls: [
          {
            toolName: "rankPortfolioHoldings",
            input: { portfolioId: "portfolio-1", limit: 3, includeWatchlist: false },
            purpose: "Rank holdings",
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
          stage: "REQUEST_FAILED",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "synthetic synthesis failure",
      ),
    );

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      if (request.toolName === "rankPortfolioHoldings") {
        return mockToolResult("rankPortfolioHoldings", {
          portfolioId: "portfolio-1",
          totalHoldings: 3,
          scoredHoldingsCount: 3,
          skippedHoldingsCount: 0,
          skippedHoldings: [],
          rankedHoldings: [
            {
              rank: 1,
              ticker: "NVDA",
              compositeScore: 81.4,
              suggestedStance: "STRONG_CANDIDATE",
              componentScores: { dataQualityScore: 84 },
              bullishFactors: ["Revenue growth is positive."],
              bearishFactors: ["RSI is elevated and may signal short-term exhaustion."],
              missingData: [],
              staleDataWarnings: [],
            },
            {
              rank: 2,
              ticker: "GOOGL",
              compositeScore: 80.1,
              suggestedStance: "WATCH",
              componentScores: { dataQualityScore: 77 },
              bullishFactors: ["Price is above SMA200."],
              bearishFactors: ["Margins are thin."],
              missingData: [],
              staleDataWarnings: [],
            },
            {
              rank: 3,
              ticker: "AMZN",
              compositeScore: 79.7,
              suggestedStance: "CANDIDATE",
              componentScores: { dataQualityScore: 73 },
              bullishFactors: ["Analyst consensus is constructive."],
              bearishFactors: ["Recent news sentiment skews negative."],
              missingData: [],
              staleDataWarnings: [],
            },
          ],
          warnings: [],
        }) as never;
      }

      if (request.toolName === "getPortfolioRiskSnapshot") {
        return mockToolResult("getPortfolioRiskSnapshot", {
          topRisks: ["Single-name concentration is high in NVDA."],
          concentrationRisks: [{ type: "HOLDING", key: "NVDA", sharePercent: 44, message: "Single-name concentration is high in NVDA." }],
          sectorExposure: [{ key: "TECH", holdings: 2, marketValueCad: 2000, sharePercent: 58 }],
        }) as never;
      }

      if (request.toolName === "getPortfolioDataQuality") {
        return mockToolResult("getPortfolioDataQuality", {
          missingFxIssues: [{ ticker: "NVDA", currency: "USD" }],
          missingCurrencyIssues: [],
          missingPriceIssues: [],
          staleDataWarnings: [],
        }) as never;
      }

      return mockToolResult(request.toolName, { portfolioId: "portfolio-1" }) as never;
    });

    const result = await runAgentChat({
      message: "What are three recommendations you would make for my portfolio with today's data?",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.warnings).toContain("OpenAI synthesis failed; deterministic fallback used.");
    expect(result.answer).toContain("Top 3 recommendations:");
    expect(result.answer).toContain("Portfolio-level caveats:");
    expect(result.answer).toContain("Decision support only, not a buy/sell instruction.");
  });

  it("production mode keeps fallback model warning while hiding raw OpenAI diagnostics", async () => {
    env.NODE_ENV = "production";
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";
    env.OPENAI_AGENT_MODEL_FALLBACK = "fallback-model";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "PORTFOLIO_RECOMMENDATIONS",
        needsTools: true,
        toolCalls: [
          {
            toolName: "rankPortfolioHoldings",
            input: {
              portfolioId: "portfolio-1",
              limit: 3,
              includeWatchlist: false,
            },
            purpose: "Rank holdings",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: "fallback-model",
      usedFallbackModel: true,
      primaryModelFailure: {
        stage: "UNSUPPORTED_MODEL",
        modelName: env.OPENAI_AGENT_MODEL,
      },
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue(mockSynthesis("Fallback synthesis."));
    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("rankPortfolioHoldings", {
        rankedHoldings: [{ ticker: "NVDA", compositeScore: 80.1, suggestedStance: "STRONG_CANDIDATE" }],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Top three recommendations for my portfolio",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.openAiDiagnostics).toBeUndefined();
    expect(result.warnings).toContain("Primary OpenAI model was unavailable; fallback model was used.");
  });

  it("metadata identifies primary/fallback and per-stage model usage", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";
    env.OPENAI_AGENT_MODEL = "primary-model";
    env.OPENAI_AGENT_MODEL_FALLBACK = "fallback-model";

    vi.spyOn(openAiClient, "generateToolPlan").mockResolvedValue({
      plan: {
        intent: "PORTFOLIO_RECOMMENDATIONS",
        needsTools: true,
        toolCalls: [
          {
            toolName: "rankPortfolioHoldings",
            input: { portfolioId: "portfolio-1", limit: 3, includeWatchlist: false },
            purpose: "Rank holdings",
          },
        ],
        missingContext: [],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: "fallback-model",
      usedFallbackModel: true,
      primaryModelFailure: {
        stage: "UNSUPPORTED_MODEL",
        modelName: "primary-model",
      },
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue({
      synthesis: {
        answer: "Synthesized answer",
        confidence: "MEDIUM",
        warnings: [],
        suggestedActions: [],
      },
      modelName: "fallback-model",
      usedFallbackModel: true,
      primaryModelFailure: {
        stage: "UNSUPPORTED_MODEL",
        modelName: "primary-model",
      },
    });

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(
      mockToolResult("rankPortfolioHoldings", {
        rankedHoldings: [{ ticker: "NVDA", compositeScore: 80.1, suggestedStance: "STRONG_CANDIDATE" }],
      }) as never,
    );

    const result = await runAgentChat({
      message: "Top three recommendations for my portfolio",
      context: {
        source: "USER",
        portfolioId: "portfolio-1",
      },
    });

    expect(result.metadata.primaryModelName).toBe("primary-model");
    expect(result.metadata.fallbackModelName).toBe("fallback-model");
    expect(result.metadata.modelUsedForPlanning).toBe("fallback-model");
    expect(result.metadata.modelUsedForSynthesis).toBe("fallback-model");
    expect(result.metadata.primaryFailureReason).toBe("unsupported_model");
  });
});
