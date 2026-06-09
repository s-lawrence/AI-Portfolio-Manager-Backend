import { afterEach, describe, expect, it, vi } from "vitest";

import { runAgentChat } from "../../src/agent/agent-chat.service";
import { agentToolExecutor } from "../../src/agent";
import * as openAiClient from "../../src/agent/openai-agent-client";
import { OpenAiAgentClientError } from "../../src/agent/openai-agent-client";
import { env } from "../../src/config/env";

function mockToolResult() {
  return {
    toolName: "scoreTickerResearch",
    success: true,
    data: {
      ticker: "AAPL",
      compositeScore: 67.2,
      suggestedStance: "CANDIDATE",
      missingData: [],
      staleDataWarnings: [],
    },
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

describe("agent-chat.service", () => {
  const originalProviderEnabled = env.OPENAI_AGENT_PROVIDER_ENABLED;
  const originalApiKey = env.OPENAI_API_KEY;
  const originalModel = env.OPENAI_AGENT_MODEL;

  afterEach(() => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = originalProviderEnabled;
    env.OPENAI_API_KEY = originalApiKey;
    env.OPENAI_AGENT_MODEL = originalModel;
    vi.restoreAllMocks();
  });

  it("uses deterministic fallback when OpenAI is disabled", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = false;
    env.OPENAI_API_KEY = "test-key";

    const toolSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    const openAiSpy = vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue({
      synthesis: {
        answer: "OpenAI answer",
        confidence: "HIGH",
        warnings: [],
        suggestedActions: [],
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(toolSpy).toHaveBeenCalled();
    expect(openAiSpy).not.toHaveBeenCalled();
    expect(result.metadata.mode).toBe("DETERMINISTIC_ROUTER");
    expect(result.metadata.fallbackUsed).toBe(false);
  });

  it("calls OpenAI synthesis after deterministic tool execution when enabled", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    const toolSpy = vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    const openAiSpy = vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue({
      synthesis: {
        answer: "Synthesis answer",
        confidence: "MEDIUM",
        warnings: ["Use caution."],
        suggestedActions: [],
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(toolSpy).toHaveBeenCalledTimes(1);
    expect(openAiSpy).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe("Synthesis answer");
    expect(result.metadata.mode).toBe("OPENAI_SYNTHESIS");
    expect(result.metadata.modelName).toBe(env.OPENAI_AGENT_MODEL);
    expect(result.metadata.fallbackUsed).toBe(false);
  });

  it("parse failed sets openAiFailureStage=PARSE_FAILED", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    vi.spyOn(openAiClient, "generateAgentSynthesis").mockRejectedValue(
      new OpenAiAgentClientError(
        {
          stage: "PARSE_FAILED",
          responsePreview: "{bad-json",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "parse failed",
      ),
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.mode).toBe("DETERMINISTIC_ROUTER");
    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.warnings).toContain("OpenAI synthesis failed; deterministic fallback used.");
    expect(result.metadata.openAiDiagnostics?.openAiFailureStage).toBe("PARSE_FAILED");
  });

  it("validation failed sets openAiFailureStage=VALIDATION_FAILED", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    vi.spyOn(openAiClient, "generateAgentSynthesis").mockRejectedValue(
      new OpenAiAgentClientError(
        {
          stage: "VALIDATION_FAILED",
          responsePreview: "{\"answer\": 7}",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "validation failed",
      ),
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.metadata.openAiDiagnostics?.openAiFailureStage).toBe("VALIDATION_FAILED");
  });

  it("request error sets REQUEST_FAILED with safe status/code", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    vi.spyOn(openAiClient, "generateAgentSynthesis").mockRejectedValue(
      new OpenAiAgentClientError(
        {
          stage: "REQUEST_FAILED",
          status: 429,
          errorCode: "rate_limit_exceeded",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "request failed",
      ),
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.metadata.openAiDiagnostics?.openAiFailureStage).toBe("REQUEST_FAILED");
    expect(result.metadata.openAiDiagnostics?.openAiStatus).toBe(429);
    expect(result.metadata.openAiDiagnostics?.openAiErrorCode).toBe("rate_limit_exceeded");
  });

  it("drops unapproved suggested tool actions from OpenAI synthesis", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue({
      synthesis: {
        answer: "Synthesis answer",
        confidence: "MEDIUM",
        warnings: [],
        suggestedActions: [
          {
            label: "Drop everything",
            toolName: "dropDatabase",
            input: {},
            requiresConfirmation: false,
          },
        ],
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.suggestedActions).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("Dropped unapproved suggested tool"))).toBe(true);
  });

  it("marks confirmation-required actions correctly in synthesis output", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    vi.spyOn(openAiClient, "generateAgentSynthesis").mockResolvedValue({
      synthesis: {
        answer: "Synthesis answer",
        confidence: "MEDIUM",
        warnings: [],
        suggestedActions: [
          {
            label: "Refresh analyst data",
            toolName: "refreshTickerAnalystData",
            input: {
              ticker: "AAPL",
            },
          },
        ],
      },
      modelName: env.OPENAI_AGENT_MODEL,
      usedFallbackModel: false,
    });

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.modelName).toBe(env.OPENAI_AGENT_MODEL);
    expect(result.metadata.fallbackUsed).toBe(false);
    expect(result.suggestedActions[0]?.requiresConfirmation).toBe(true);
  });

  it("redacts secrets from diagnostics preview", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = "test-key";

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);
    vi.spyOn(openAiClient, "generateAgentSynthesis").mockRejectedValue(
      new OpenAiAgentClientError(
        {
          stage: "PARSE_FAILED",
          responsePreview: "token sk-super-secret-value leaked",
          modelName: env.OPENAI_AGENT_MODEL,
        },
        "parse failed",
      ),
    );

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    const preview = result.metadata.openAiDiagnostics?.openAiResponsePreview ?? "";
    expect(preview).not.toContain("sk-super-secret-value");
    expect(preview).toContain("[REDACTED]");
  });

  it("provider enabled with missing key falls back with REQUEST_FAILED diagnostics", async () => {
    env.OPENAI_AGENT_PROVIDER_ENABLED = true;
    env.OPENAI_API_KEY = undefined;

    vi.spyOn(agentToolExecutor, "executeByName").mockResolvedValue(mockToolResult() as never);

    const result = await runAgentChat({
      message: "Research AAPL",
      context: {
        source: "USER",
      },
    });

    expect(result.metadata.mode).toBe("DETERMINISTIC_ROUTER");
    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.metadata.openAiDiagnostics?.openAiFailureStage).toBe("REQUEST_FAILED");
  });
});
