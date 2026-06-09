import type { FastifyInstance } from "fastify";

import { agentToolExecutor, agentToolRegistry } from "../../agent";
import { runService } from "../errors";
import { ok } from "../response";
import {
  agentToolExecuteBodySchema,
  agentToolNameParamsSchema,
} from "../schemas/agent-tools.schemas";

export async function agentToolsRoutes(app: FastifyInstance): Promise<void> {
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
