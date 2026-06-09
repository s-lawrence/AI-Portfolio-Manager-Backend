import { describe, expect, it } from "vitest";

import { openAiToolPlanOutputSchema } from "../../src/agent/agent-chat.types";
import { normalizePlannerOutputAliases } from "../../src/agent/openai-agent-client";

function parsePlannerOutput(input: Record<string, unknown>) {
  const normalized = normalizePlannerOutputAliases(input);
  return openAiToolPlanOutputSchema.safeParse(normalized);
}

describe("openai agent planner normalizer", () => {
  it("clarifyingQuestion='' normalizes to null and validates", () => {
    const result = parsePlannerOutput({
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
      clarifyingQuestion: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clarifyingQuestion).toBeNull();
    }
  });

  it("clarifyingQuestion='   ' normalizes to null and validates", () => {
    const result = parsePlannerOutput({
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
      clarifyingQuestion: "   ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clarifyingQuestion).toBeNull();
    }
  });

  it("clarifyingQuestion omitted defaults to null", () => {
    const result = parsePlannerOutput({
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
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clarifyingQuestion).toBeNull();
    }
  });

  it("clarifyingQuestion non-empty remains trimmed", () => {
    const result = parsePlannerOutput({
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
      clarifyingQuestion: "  Which ticker do you mean?  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clarifyingQuestion).toBe("Which ticker do you mean?");
    }
  });

  it("truly invalid planner output still fails validation", () => {
    const result = parsePlannerOutput({
      intent: "RESEARCH_TICKER",
      needsTools: true,
      toolCalls: [
        {
          toolName: 123,
          input: {},
          purpose: "Score",
        },
      ],
      missingContext: [],
      requiresConfirmation: false,
      clarifyingQuestion: null,
    });

    expect(result.success).toBe(false);
  });
});
