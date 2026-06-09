import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app";
import * as agentChatService from "../../src/agent/agent-chat.service";

describe("API agent chat route", () => {
  afterEach(() => {
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
});
