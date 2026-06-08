import { buildApp } from "./app";
import { env } from "./config/env";

const app = buildApp({
  logger: env.NODE_ENV !== "test",
});

async function shutdown(signal: string): Promise<void> {
  try {
    app.log.info({ signal }, "shutting down server");
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "failed to shut down cleanly");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

async function start(): Promise<void> {
  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });

    if (env.NODE_ENV !== "production") {
      app.log.info(
        {
          cwd: process.cwd(),
          nodeEnv: env.NODE_ENV,
        },
        "server runtime context",
      );

      if (env.PRINT_ROUTES_ON_STARTUP) {
        app.log.info({ routes: app.printRoutes() }, "registered routes");
      }
    }
  } catch (error) {
    app.log.error(error, "failed to start server");
    process.exit(1);
  }
}

void start();
