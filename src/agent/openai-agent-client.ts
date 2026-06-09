import OpenAI from "openai";

import { env } from "../config/env";
import {
  type OpenAiFailureStage,
  type OpenAiAgentSynthesisInput,
  type OpenAiAgentSynthesisOutput,
  openAiAgentSynthesisOutputSchema,
} from "./agent-chat.types";

const OPENAI_SYNTHESIS_SYSTEM_PROMPT = [
  "You are an investment research assistant for a paper/research portfolio app.",
  "Do not claim certainty.",
  "Do not provide personalized financial advice as guaranteed instruction.",
  "Use only supplied tool results.",
  "Mention stale or missing data when present.",
  "Never invent prices, ratings, targets, holdings, or account state.",
  "Distinguish real holdings from watchlist candidates.",
  "If a suggested action mutates data or refreshes providers, mark requiresConfirmation=true.",
  "Keep the answer concise and actionable.",
  "Return strict JSON with keys: answer, confidence, warnings, suggestedActions.",
].join(" ");

const openAiClient = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    })
  : null;

export interface OpenAiFailureDiagnostic {
  stage: OpenAiFailureStage;
  errorCode?: string;
  status?: number;
  responsePreview?: string;
  modelName?: string;
}

export interface GenerateAgentSynthesisResult {
  synthesis: OpenAiAgentSynthesisOutput;
  modelName: string;
  usedFallbackModel: boolean;
  primaryModelFailure?: OpenAiFailureDiagnostic;
}

export class OpenAiAgentClientError extends Error {
  readonly failure: OpenAiFailureDiagnostic;
  readonly retryable: boolean;

  constructor(
    failure: OpenAiFailureDiagnostic,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "OpenAiAgentClientError";
    this.failure = failure;
    this.retryable = retryable;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function previewText(text: string | null | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const redacted = redactSecrets(text).trim();
  if (redacted.length === 0) {
    return undefined;
  }

  return redacted.slice(0, 200);
}

function readErrorCodeAndStatus(error: unknown): { errorCode?: string; status?: number } {
  if (error == null || typeof error !== "object") {
    return {};
  }

  const candidate = error as {
    status?: number;
    code?: string;
    error?: { code?: string };
    cause?: { code?: string };
  };

  return {
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    errorCode:
      candidate.code ??
      candidate.error?.code ??
      candidate.cause?.code,
  };
}

function isUnsupportedModelError(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    status?: number;
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
  };

  const status = candidate.status;
  const code = (candidate.code ?? candidate.error?.code ?? "").toLowerCase();
  const message = (candidate.message ?? candidate.error?.message ?? "").toLowerCase();

  return (
    (status === 400 || status === 404) &&
    (code.includes("model") || message.includes("model"))
  );
}

function isTransientOpenAiError(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    status?: number;
    code?: string;
    cause?: { code?: string };
  };

  if (candidate.status != null && [408, 409, 429, 500, 502, 503, 504].includes(candidate.status)) {
    return true;
  }

  const code = candidate.code ?? candidate.cause?.code;
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(code ?? "");
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new OpenAiAgentClientError(
    {
      stage: "PARSE_FAILED",
      responsePreview: previewText(text),
    },
    "OpenAI did not return JSON content.",
  );
}

function parseStructuredResponse(content: string, modelName: string): OpenAiAgentSynthesisOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonCandidate(content));
  } catch {
    throw new OpenAiAgentClientError(
      {
        stage: "PARSE_FAILED",
        responsePreview: previewText(content),
        modelName,
      },
      "OpenAI returned invalid JSON.",
    );
  }

  const validated = openAiAgentSynthesisOutputSchema.safeParse(parsed);
  if (!validated.success) {
    if (parsed && typeof parsed === "object") {
      const candidate = parsed as {
        answer?: unknown;
        confidence?: unknown;
        warnings?: unknown;
        suggestedActions?: unknown;
      };

      if (typeof candidate.answer === "string" && candidate.answer.trim().length > 0) {
        const normalized: OpenAiAgentSynthesisOutput = {
          answer: candidate.answer.trim(),
          confidence: normalizeConfidence(candidate.confidence),
          warnings: normalizeWarnings(candidate.warnings),
          suggestedActions: normalizeSuggestedActions(candidate.suggestedActions),
        };

        return normalized;
      }
    }

    throw new OpenAiAgentClientError(
      {
        stage: "VALIDATION_FAILED",
        responsePreview: previewText(content),
        modelName,
      },
      "OpenAI JSON did not match output schema.",
    );
  }

  return validated.data;
}

function normalizeConfidence(value: unknown): OpenAiAgentSynthesisOutput["confidence"] {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH") {
      return normalized;
    }
  }

  return "MEDIUM";
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 20);
}

function normalizeSuggestedActions(
  value: unknown,
): OpenAiAgentSynthesisOutput["suggestedActions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as {
        label?: unknown;
        toolName?: unknown;
        input?: unknown;
        requiresConfirmation?: unknown;
      };

      if (typeof candidate.label !== "string" || candidate.label.trim().length === 0) {
        return null;
      }

      return {
        label: candidate.label.trim(),
        toolName:
          typeof candidate.toolName === "string" && candidate.toolName.trim().length > 0
            ? candidate.toolName.trim()
            : undefined,
        input:
          candidate.input && typeof candidate.input === "object"
            ? (candidate.input as Record<string, unknown>)
            : undefined,
        requiresConfirmation:
          typeof candidate.requiresConfirmation === "boolean"
            ? candidate.requiresConfirmation
            : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .slice(0, 10);
}

function readAssistantContent(response: {
  choices?: Array<{ message?: { content?: unknown } }>;
}): string {
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item) {
          const textValue = (item as { text?: unknown }).text;
          return typeof textValue === "string" ? textValue : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

async function requestAgentSynthesis(
  input: OpenAiAgentSynthesisInput,
  modelName: string,
): Promise<OpenAiAgentSynthesisOutput> {
  if (!env.OPENAI_API_KEY || !openAiClient) {
    throw new OpenAiAgentClientError(
      {
        stage: "REQUEST_FAILED",
        errorCode: "OPENAI_DISABLED",
        modelName,
      },
      "OpenAI API key is not configured.",
    );
  }

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), env.OPENAI_AGENT_TIMEOUT_MS);

  try {
    const response = await openAiClient.chat.completions.create(
      {
        model: modelName,
        temperature: 0.2,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: OPENAI_SYNTHESIS_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              "Return only JSON. Do not wrap in markdown fences.",
              JSON.stringify(input),
            ].join("\n\n"),
          },
        ],
      },
      {
        signal: timeoutController.signal,
      },
    );

    const content = readAssistantContent(response);
    if (!content) {
      throw new OpenAiAgentClientError(
        {
          stage: "EMPTY_RESPONSE",
          modelName,
        },
        "OpenAI returned an empty response.",
      );
    }

    return parseStructuredResponse(content, modelName);
  } catch (error) {
    if (error instanceof OpenAiAgentClientError) {
      throw error;
    }

    if (timeoutController.signal.aborted) {
      const { errorCode, status } = readErrorCodeAndStatus(error);
      throw new OpenAiAgentClientError(
        {
          stage: "TIMEOUT",
          errorCode,
          status,
          modelName,
        },
        "OpenAI request timed out.",
        false,
      );
    }

    if (isUnsupportedModelError(error)) {
      const { errorCode, status } = readErrorCodeAndStatus(error);
      throw new OpenAiAgentClientError(
        {
          stage: "UNSUPPORTED_MODEL",
          errorCode,
          status,
          modelName,
        },
        "OpenAI model is unavailable for this account.",
      );
    }

    if (isTransientOpenAiError(error)) {
      const { errorCode, status } = readErrorCodeAndStatus(error);
      throw new OpenAiAgentClientError(
        {
          stage: "REQUEST_FAILED",
          errorCode,
          status,
          modelName,
        },
        "Transient OpenAI failure.",
        true,
      );
    }

    const { errorCode, status } = readErrorCodeAndStatus(error);
    throw new OpenAiAgentClientError(
      {
        stage: "REQUEST_FAILED",
        errorCode,
        status,
        modelName,
      },
      "OpenAI request failed.",
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function requestWithRetry(
  input: OpenAiAgentSynthesisInput,
  modelName: string,
): Promise<OpenAiAgentSynthesisOutput> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestAgentSynthesis(input, modelName);
    } catch (error) {
      if (
        error instanceof OpenAiAgentClientError &&
        error.retryable &&
        attempt < maxAttempts
      ) {
        await delay(250);
        continue;
      }

      throw error;
    }
  }

  throw new OpenAiAgentClientError(
    {
      stage: "REQUEST_FAILED",
      modelName,
    },
    "OpenAI request failed.",
  );
}

export async function generateAgentSynthesis(
  input: OpenAiAgentSynthesisInput,
): Promise<GenerateAgentSynthesisResult> {
  const primaryModel = env.OPENAI_AGENT_MODEL;
  const fallbackModel = env.OPENAI_AGENT_MODEL_FALLBACK;

  try {
    const synthesis = await requestWithRetry(input, primaryModel);
    return {
      synthesis,
      modelName: primaryModel,
      usedFallbackModel: false,
    };
  } catch (error) {
    if (
      error instanceof OpenAiAgentClientError &&
      error.failure.stage === "UNSUPPORTED_MODEL" &&
      fallbackModel &&
      fallbackModel !== primaryModel
    ) {
      const synthesis = await requestWithRetry(input, fallbackModel);
      return {
        synthesis,
        modelName: fallbackModel,
        usedFallbackModel: true,
        primaryModelFailure: error.failure,
      };
    }

    if (error instanceof OpenAiAgentClientError) {
      throw error;
    }

    throw new OpenAiAgentClientError(
      {
        stage: "UNKNOWN",
        modelName: primaryModel,
      },
      "Unknown OpenAI synthesis failure.",
    );
  }
}

export async function generateTickerReport(): Promise<never> {
  throw new OpenAiAgentClientError(
    {
      stage: "REQUEST_FAILED",
      errorCode: "OPENAI_NOT_IMPLEMENTED",
      modelName: env.OPENAI_REPORT_MODEL,
    },
    "OpenAI ticker report generation is not implemented in this pass.",
  );
}
