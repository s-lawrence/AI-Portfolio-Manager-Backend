import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import { agentToolExecutor } from "../../src/agent";
import * as agentChatService from "../../src/agent/agent-chat.service";
import * as openAiClient from "../../src/agent/openai-agent-client";
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

describe("API agent chat route", () => {
  const originalProviderEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const originalApiKey = env.OPENAI_API_KEY;
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = originalProviderEnabled;
    env.OPENAI_API_KEY = originalApiKey;
    env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("returns standard success envelope for /api/agent/chat", async () => {
    const runChatSpy = vi.spyOn(agentChatService, "runAgentChat").mockResolvedValue({
      answer: "Deterministic summary",
      intent: "RESEARCH_TICKER",
      toolCalls: [],
      suggestedActions: [],
      warnings: [],
      missingContext: [],
      confidence: "MEDIUM",
      metadata: {
        mode: "DETERMINISTIC_ROUTER",
        fallbackUsed: false,
        plannerUsed: false,
        plannerFallbackUsed: false,
        plannedToolCount: 0,
        executedToolCount: 0,
        droppedToolCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 4,
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Research AAPL",
        context: {
          source: "USER",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.answer).toBe("Deterministic summary");
    expect(body.data.metadata.mode).toBe("DETERMINISTIC_ROUTER");
    expect(runChatSpy).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns validation envelope for invalid chat payload", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "",
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");

    await app.close();
  });

  it("normalizes array-form confirmedToolInputs before invoking runAgentChat", async () => {
    const runChatSpy = vi.spyOn(agentChatService, "runAgentChat").mockResolvedValue({
      answer: "normalized",
      intent: "CONFIRM_TOOL_EXECUTION",
      toolCalls: [],
      suggestedActions: [],
      warnings: [],
      missingContext: [],
      confidence: "MEDIUM",
      metadata: {
        mode: "DETERMINISTIC_ROUTER",
        fallbackUsed: false,
        plannerUsed: false,
        plannerFallbackUsed: false,
        plannedToolCount: 0,
        executedToolCount: 0,
        droppedToolCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 3,
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Confirm refresh",
        context: {
          source: "USER",
        },
        confirmedToolExecutions: ["refreshDiscoveryCategory"],
        confirmedToolInputs: [
          {
            toolName: "refreshDiscoveryCategory",
            input: {
              category: "LOSERS",
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(runChatSpy).toHaveBeenCalledWith(expect.objectContaining({
      confirmedToolInputs: expect.objectContaining({
        refreshDiscoveryCategory: expect.objectContaining({
          category: "LOSERS",
        }),
      }),
    }));

    await app.close();
  });

  it("canonicalizes top-level user/portfolio/watchlist into context and emits route diagnostics", async () => {
    const runChatSpy = vi.spyOn(agentChatService, "runAgentChat").mockResolvedValue({
      answer: "Context mapped",
      intent: "DAILY_RISK_CHECK",
      toolCalls: [],
      suggestedActions: [],
      warnings: [],
      missingContext: [],
      confidence: "MEDIUM",
      metadata: {
        mode: "DETERMINISTIC_ROUTER",
        fallbackUsed: false,
        plannerUsed: false,
        plannerFallbackUsed: false,
        plannedToolCount: 0,
        executedToolCount: 0,
        droppedToolCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 3,
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Anything I should be worried about?",
        userId: "user-1",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(runChatSpy).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        userId: "user-1",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
      }),
    }));

    const body = response.json();
    expect(body.data.metadata.routeReceivedTopLevelUserId).toBe(true);
    expect(body.data.metadata.routeReceivedTopLevelPortfolioId).toBe(true);
    expect(body.data.metadata.routeReceivedTopLevelWatchlistId).toBe(true);
    expect(body.data.metadata.routeReceivedNestedPortfolioId).toBe(false);
    expect(body.data.metadata.canonicalPortfolioIdConfigured).toBe(true);
    expect(body.data.metadata.canonicalWatchlistIdConfigured).toBe(true);

    await app.close();
  });

  it("canonicalizes nested context user/portfolio/watchlist and emits canonical diagnostics", async () => {
    const runChatSpy = vi.spyOn(agentChatService, "runAgentChat").mockResolvedValue({
      answer: "Nested context mapped",
      intent: "DAILY_RISK_CHECK",
      toolCalls: [],
      suggestedActions: [],
      warnings: [],
      missingContext: [],
      confidence: "MEDIUM",
      metadata: {
        mode: "DETERMINISTIC_ROUTER",
        fallbackUsed: false,
        plannerUsed: false,
        plannerFallbackUsed: false,
        plannedToolCount: 0,
        executedToolCount: 0,
        droppedToolCount: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 3,
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Anything I should be worried about?",
        context: {
          source: "USER",
          userId: "user-1",
          portfolioId: "portfolio-1",
          watchlistId: "watchlist-1",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(runChatSpy).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        userId: "user-1",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
      }),
    }));

    const body = response.json();
    expect(body.data.metadata.routeReceivedTopLevelPortfolioId).toBe(false);
    expect(body.data.metadata.routeReceivedNestedPortfolioId).toBe(true);
    expect(body.data.metadata.canonicalPortfolioIdConfigured).toBe(true);

    await app.close();
  });

  it("reconciles planner missing portfolioId when canonical portfolioId exists and still executes portfolio tools", async () => {
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
            purpose: "Review risk",
          },
          {
            toolName: "getGeopoliticalSummary",
            input: {},
            purpose: "Review geopolitics",
          },
        ],
        missingContext: ["portfolioId"],
        requiresConfirmation: false,
        clarifyingQuestion: null,
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue({
      synthesis: {
        answer: "Risk review complete.",
        confidence: "MEDIUM",
        warnings: [],
        suggestedActions: [],
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    vi.spyOn(agentToolExecutor, "executeByName").mockImplementation(async (request) => {
      return mockToolResult(request.toolName, { ok: true }) as never;
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Anything I should be worried about today?",
        userId: "user-1",
        portfolioId: "portfolio-1",
        watchlistId: "watchlist-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.missingContext).not.toContain("portfolioId");
    expect(body.data.toolCalls.map((call: { toolName: string }) => call.toolName)).toEqual(
      expect.arrayContaining([
        "getPortfolioOverview",
        "getPortfolioRiskSnapshot",
        "getGeopoliticalSummary",
      ]),
    );
    expect(body.data.metadata.canonicalPortfolioIdConfigured).toBe(true);

    await app.close();
  });

  it("without portfolioId returns missingContext portfolioId and no raw 404", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Anything I should be worried about today?",
        context: {
          source: "USER",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.missingContext).toContain("portfolioId");
    expect(body.data.metadata.canonicalPortfolioIdConfigured).toBe(false);

    await app.close();
  });

  it("hides OpenAI diagnostics/debug metadata in production responses", async () => {
    env.NODE_ENV = "production";

    vi.spyOn(agentChatService, "runAgentChat").mockResolvedValue({
      answer: "Deterministic summary",
      intent: "RESEARCH_TICKER",
      toolCalls: [],
      suggestedActions: [],
      warnings: [],
      missingContext: [],
      confidence: "MEDIUM",
      metadata: {
        mode: "DETERMINISTIC_ROUTER",
        fallbackUsed: true,
        plannerUsed: false,
        plannerFallbackUsed: false,
        plannedToolCount: 0,
        executedToolCount: 0,
        droppedToolCount: 0,
        effectiveMaxToolCalls: 5,
        openAiProviderEnabled: true,
        openAiKeyConfigured: true,
        plannerSkipReason: "API_KEY_MISSING",
        openAiRequestLimitsConfigured: true,
        openAiRequestLimitReason: "DAILY_USER_LIMIT",
        openAiDiagnostics: {
          openAiAttempted: true,
          openAiFailureStage: "REQUEST_FAILED",
          openAiErrorCode: "mock-error",
        },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 5,
      },
    });

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: {
        message: "Research AAPL",
        context: {
          source: "USER",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.metadata.openAiDiagnostics).toBeUndefined();
    expect(body.data.metadata.openAiProviderEnabled).toBeUndefined();
    expect(body.data.metadata.openAiKeyConfigured).toBeUndefined();
    expect(body.data.metadata.plannerSkipReason).toBeUndefined();

    await app.close();
  });
});
