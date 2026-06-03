import type { FastifyInstance } from "fastify";

import { created, deleted, ok, paginated } from "../response";
import { runService } from "../errors";
import {
  alertIdParamsSchema,
  alertUserParamsSchema,
  createAlertBodySchema,
  listUserAlertsQuerySchema,
} from "../schemas/alerts.schemas";
import {
  createUserAlert,
  deleteUserAlert,
  listUnreadUserAlerts,
  listUserAlerts,
  markAlertRead,
  markAllUserAlertsRead,
} from "../../services/alerts.service";

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const body = createAlertBodySchema.parse(request.body);

    const alert = await runService(() => createUserAlert(body));
    return reply.code(201).send(created(alert));
  });

  app.get("/user/:userId", async (request, reply) => {
    const params = alertUserParamsSchema.parse(request.params);
    const query = listUserAlertsQuerySchema.parse(request.query);

    if (query.unreadOnly) {
      const unreadAlerts = await runService(() => listUnreadUserAlerts(params.userId));

      return reply.send(
        paginated(unreadAlerts, {
          total: unreadAlerts.length,
          limit: query.limit,
        }),
      );
    }

    const alerts = await runService(() =>
      listUserAlerts(params.userId, {
        limit: query.limit,
      }),
    );

    return reply.send(
      paginated(alerts, {
        total: alerts.length,
        limit: query.limit,
      }),
    );
  });

  app.patch("/:alertId/read", async (request, reply) => {
    const params = alertIdParamsSchema.parse(request.params);

    const alert = await runService(() => markAlertRead(params.alertId));
    return reply.send(ok(alert));
  });

  app.patch("/user/:userId/read-all", async (request, reply) => {
    const params = alertUserParamsSchema.parse(request.params);

    const result = await runService(() => markAllUserAlertsRead(params.userId));
    return reply.send(ok(result));
  });

  app.delete("/:alertId", async (request, reply) => {
    const params = alertIdParamsSchema.parse(request.params);

    await runService(() => deleteUserAlert(params.alertId));
    return reply.send(deleted());
  });
}
