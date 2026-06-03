import type { FastifyInstance } from "fastify";

import { internalError } from "../errors";
import { ok } from "../response";
import { prisma } from "../../db/prisma";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    reply.send(
      ok({
        status: "ok",
        service: "portfolio-ai-backend",
        timestamp: new Date().toISOString(),
      }),
    );
  });

  app.get("/db", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      reply.send(
        ok({
          status: "ok",
          database: "reachable",
          timestamp: new Date().toISOString(),
        }),
      );
    } catch {
      throw internalError("Database is unreachable.");
    }
  });
}
