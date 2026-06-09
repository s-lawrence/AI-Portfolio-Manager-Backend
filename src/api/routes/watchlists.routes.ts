import type { FastifyInstance } from "fastify";

import { notFound, runService } from "../errors";
import { created, deleted, ok, paginated } from "../response";
import {
  addWatchlistItemBodySchema,
  createWatchlistBodySchema,
  refreshWatchlistResearchDataBodySchema,
  updateWatchlistBodySchema,
  updateWatchlistItemBodySchema,
  userIdParamsSchema,
  watchlistIdParamsSchema,
  watchlistItemIdParamsSchema,
} from "../schemas/watchlists.schemas";
import {
  addTickerToWatchlist,
  createWatchlist,
  deleteWatchlist,
  getWatchlistDetail,
  getWatchlistResearchBundle,
  listWatchlistsForUser,
  refreshWatchlistResearchData,
  removeWatchlistItem,
  updateWatchlist,
  updateWatchlistItemDetails,
} from "../../services";

export async function watchlistsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/user/:userId", async (request, reply) => {
    const params = userIdParamsSchema.parse(request.params);
    const watchlists = await runService(() => listWatchlistsForUser(params.userId));

    reply.send(
      paginated(watchlists, {
        total: watchlists.length,
      }),
    );
  });

  app.patch("/items/:itemId", async (request, reply) => {
    const params = watchlistItemIdParamsSchema.parse(request.params);
    const body = updateWatchlistItemBodySchema.parse(request.body);

    const item = await runService(() => updateWatchlistItemDetails(params.itemId, body));
    reply.send(ok(item));
  });

  app.delete("/items/:itemId", async (request, reply) => {
    const params = watchlistItemIdParamsSchema.parse(request.params);

    await runService(() => removeWatchlistItem(params.itemId));
    reply.send(deleted());
  });

  app.post("/:watchlistId/items", async (request, reply) => {
    const params = watchlistIdParamsSchema.parse(request.params);
    const body = addWatchlistItemBodySchema.parse(request.body);

    const item = await runService(() =>
      addTickerToWatchlist(params.watchlistId, body.ticker, {
        status: body.status,
        priority: body.priority,
        thesis: body.thesis,
        riskNotes: body.riskNotes,
        targetEntryPrice: body.targetEntryPrice,
        targetExitPrice: body.targetExitPrice,
        targetAllocation: body.targetAllocation,
        tags: body.tags,
        source: body.source,
        addedReason: body.addedReason,
        rejectionReason: body.rejectionReason,
        convertedHoldingId: body.convertedHoldingId,
        lastReviewedAt:
          body.lastReviewedAt == null
            ? undefined
            : body.lastReviewedAt instanceof Date
              ? body.lastReviewedAt
              : new Date(body.lastReviewedAt),
      }),
    );

    reply.status(201).send(created(item));
  });

  app.get("/:watchlistId/research-bundle", async (request, reply) => {
    const params = watchlistIdParamsSchema.parse(request.params);
    const bundle = await runService(() => getWatchlistResearchBundle(params.watchlistId));

    if (!bundle) {
      throw notFound("Watchlist not found.");
    }

    reply.send(ok(bundle));
  });

  app.post("/:watchlistId/refresh-research-data", async (request, reply) => {
    const params = watchlistIdParamsSchema.parse(request.params);
    const body = refreshWatchlistResearchDataBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      refreshWatchlistResearchData(params.watchlistId, {
        historicalLimit: body.historicalLimit,
        newsLimitPerTicker: body.newsLimitPerTicker,
        includeMarketData: body.includeMarketData,
        includeFundamentals: body.includeFundamentals,
        includeEarnings: body.includeEarnings,
        includeNews: body.includeNews,
        includeAnalystData: body.includeAnalystData,
        runReports: body.runReports,
      }),
    );

    reply.send(ok(result));
  });

  app.get("/:watchlistId", async (request, reply) => {
    const params = watchlistIdParamsSchema.parse(request.params);
    const watchlist = await runService(() => getWatchlistDetail(params.watchlistId));

    if (!watchlist) {
      throw notFound("Watchlist not found.");
    }

    reply.send(ok(watchlist));
  });

  app.patch("/:watchlistId", async (request, reply) => {
    const params = watchlistIdParamsSchema.parse(request.params);
    const body = updateWatchlistBodySchema.parse(request.body);

    const watchlist = await runService(() => updateWatchlist(params.watchlistId, body));
    reply.send(ok(watchlist));
  });

  app.delete("/:watchlistId", async (request, reply) => {
    const params = watchlistIdParamsSchema.parse(request.params);

    await runService(() => deleteWatchlist(params.watchlistId));
    reply.send(deleted());
  });

  app.post("/", async (request, reply) => {
    const body = createWatchlistBodySchema.parse(request.body);

    const watchlist = await runService(() =>
      createWatchlist(body.userId, {
        name: body.name,
        description: body.description,
        isDefault: body.isDefault,
      }),
    );

    reply.status(201).send(created(watchlist));
  });
}
