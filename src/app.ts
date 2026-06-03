import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { registerRoutes } from "./api/routes";
import { registerApiErrorHandler } from "./api/errors";
import { env } from "./config/env";

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  });

  if (options.logger) {
    app.addHook("onRequest", async (request) => {
      request.log.info({ method: request.method, url: request.url }, "incoming request");
    });
  }

  app.register(registerRoutes);
  registerApiErrorHandler(app);

  return app;
}
