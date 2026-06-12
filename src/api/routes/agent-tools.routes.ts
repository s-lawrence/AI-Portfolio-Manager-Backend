import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  assertPortfolioOwnership,
  assertWatchlistItemOwnership,
  assertWatchlistOwnership,
  enforceAgentContextOwnership,
} from "../../auth";
import { agentToolExecutor, agentToolRegistry } from "../../agent";
import { runAgentChat } from "../../agent/agent-chat.service";
import { env } from "../../config/env";
import { runService } from "../errors";
import { ok } from "../response";
import {
  agentChatBodySchema,
  agentToolExecuteBodySchema,
  agentToolNameParamsSchema,
} from "../schemas/agent-tools.schemas";

function hasConfiguredValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function enforceToolEntityOwnership(
  request: FastifyRequest,
  toolName: string,
  input: unknown,
): Promise<void> {
  const payload = asRecord(input) ?? {};
  const portfolioId = asOptionalString(payload.portfolioId);
  const watchlistId = asOptionalString(payload.watchlistId);
  const itemId = asOptionalString(payload.itemId);

  if (portfolioId) {
    await runService(() => assertPortfolioOwnership(request, portfolioId));
  }

  if (watchlistId) {
    await runService(() => assertWatchlistOwnership(request, watchlistId));
  }

  if (itemId && (toolName === "updateWatchlistItem" || toolName === "removeWatchlistItem")) {
    await runService(() => assertWatchlistItemOwnership(request, itemId));
  }
}

export async function agentToolsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/chat", async (request, reply) => {
    const body = agentChatBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const canonical = {
      ...body,
      userId: body.userId ?? body.context.userId,
      portfolioId: body.portfolioId ?? body.context.portfolioId,
      watchlistId: body.watchlistId ?? body.context.watchlistId,
      ticker: body.ticker ?? body.context.ticker,
      context: {
        ...body.context,
        userId: body.userId ?? body.context.userId,
        portfolioId: body.portfolioId ?? body.context.portfolioId,
        watchlistId: body.watchlistId ?? body.context.watchlistId,
        ticker: body.ticker ?? body.context.ticker,
      },
    };

    const scopedContext = await runService(() =>
      enforceAgentContextOwnership(request, {
        userId: canonical.context.userId,
        portfolioId: canonical.context.portfolioId,
        watchlistId: canonical.context.watchlistId,
        ticker: canonical.context.ticker,
      }),
    );

    canonical.userId = scopedContext.userId;
    canonical.portfolioId = scopedContext.portfolioId;
    canonical.watchlistId = scopedContext.watchlistId;
    canonical.ticker = scopedContext.ticker;
    canonical.context.userId = scopedContext.userId;
    canonical.context.portfolioId = scopedContext.portfolioId;
    canonical.context.watchlistId = scopedContext.watchlistId;
    canonical.context.ticker = scopedContext.ticker;

    const routeDiagnostics = {
      authEnabled: env.AUTH_ENABLED,
      routeReceivedTopLevelUserId: hasConfiguredValue(body.userId),
      routeReceivedTopLevelPortfolioId: hasConfiguredValue(body.portfolioId),
      routeReceivedTopLevelWatchlistId: hasConfiguredValue(body.watchlistId),
      routeReceivedTopLevelTicker: hasConfiguredValue(body.ticker),
      routeReceivedNestedUserId: hasConfiguredValue(body.context.userId),
      routeReceivedNestedPortfolioId: hasConfiguredValue(body.context.portfolioId),
      routeReceivedNestedWatchlistId: hasConfiguredValue(body.context.watchlistId),
      routeReceivedNestedTicker: hasConfiguredValue(body.context.ticker),
      canonicalUserIdConfigured: hasConfiguredValue(canonical.context.userId),
      canonicalPortfolioIdConfigured: hasConfiguredValue(canonical.context.portfolioId),
      canonicalWatchlistIdConfigured: hasConfiguredValue(canonical.context.watchlistId),
      canonicalTickerConfigured: hasConfiguredValue(canonical.context.ticker),
      authenticatedUserConfigured: hasConfiguredValue(canonical.context.userId),
    };

    const result = await runService(() =>
      runAgentChat(canonical),
    );

    if (env.NODE_ENV === "production") {
      result.metadata = {
        ...result.metadata,
        openAiDiagnostics: undefined,
        openAiProviderEnabled: undefined,
        openAiKeyConfigured: undefined,
        plannerSkipReason: undefined,
        openAiRequestLimitsConfigured: undefined,
        openAiRequestLimitReason: undefined,
        receivedContextKeys: undefined,
        receivedPortfolioIdConfigured: undefined,
        receivedWatchlistIdConfigured: undefined,
        receivedTickerConfigured: undefined,
        routeReceivedTopLevelUserId: undefined,
        routeReceivedTopLevelPortfolioId: undefined,
        routeReceivedTopLevelWatchlistId: undefined,
        routeReceivedTopLevelTicker: undefined,
        routeReceivedNestedUserId: undefined,
        routeReceivedNestedPortfolioId: undefined,
        routeReceivedNestedWatchlistId: undefined,
        routeReceivedNestedTicker: undefined,
        authEnabled: undefined,
        authenticatedUserConfigured: undefined,
        canonicalUserIdConfigured: undefined,
        canonicalPortfolioIdConfigured: undefined,
        canonicalWatchlistIdConfigured: undefined,
        canonicalTickerConfigured: undefined,
        blockedToolCount: undefined,
        blockedTools: undefined,
        toolExecutionErrors: undefined,
      };
    } else {
      result.metadata = {
        ...result.metadata,
        ...routeDiagnostics,
      };
    }

    reply.send(ok(result));
  });

  app.get("/tools", async (_request, reply) => {
    const tools = await runService(async () => agentToolRegistry.listToolDescriptors());
    reply.send(ok({ tools }));
  });

  app.post("/tools/:toolName/execute", async (request, reply) => {
    const params = agentToolNameParamsSchema.parse(request.params);
    const body = agentToolExecuteBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const scopedContext = await runService(() =>
      enforceAgentContextOwnership(request, {
        userId: body.context.userId,
        portfolioId: body.context.portfolioId,
      }),
    );

    await enforceToolEntityOwnership(request, params.toolName, body.input);

    const result = await runService(() =>
      agentToolExecutor.executeByName({
        toolName: params.toolName,
        input: body.input,
        context: {
          ...body.context,
          ...scopedContext,
        },
        confirmed: body.confirmed,
      }),
    );

    reply.send(ok(result));
  });
}
