import type { FastifyInstance } from "fastify";

import { agentToolExecutor, agentToolRegistry } from "../../agent";
import { runAgentChat } from "../../agent/agent-chat.service";
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

    const routeDiagnostics = {
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
    };

    const result = await runService(() =>
      runAgentChat(canonical),
    );

    if (process.env.NODE_ENV !== "production") {
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

    const result = await runService(() =>
      agentToolExecutor.executeByName({
        toolName: params.toolName,
        input: body.input,
        context: body.context,
        confirmed: body.confirmed,
      }),
    );

    reply.send(ok(result));
  });
}
