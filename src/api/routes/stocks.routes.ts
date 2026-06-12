import type { FastifyInstance } from "fastify";

import { notFound, runService } from "../errors";
import { ok, paginated } from "../response";
import {
  listStocksQuerySchema,
  stockSearchQuerySchema,
  stockTickerParamsSchema,
  updateStockMetadataBodySchema,
} from "../schemas/stocks.schemas";
import {
  getStockProfile,
  getStockResearchBundle,
  listStocks,
  searchStockCandidates,
  searchStocks,
  updateStockMetadata,
} from "../../services";

export async function stocksRoutes(app: FastifyInstance): Promise<void> {
  app.get("/search", async (request, reply) => {
    const query = stockSearchQuerySchema.parse(request.query);

    const candidates = await runService(() =>
      searchStockCandidates(query.query, {
        exchange: query.exchange,
        country: query.country,
        limit: query.limit,
      }),
    );

    reply.send(
      ok({
        query: query.query,
        candidates,
      }),
    );
  });

  app.get("/", async (request, reply) => {
    const query = listStocksQuerySchema.parse(request.query);

    const stocks = await runService(() =>
      query.q ? searchStocks(query.q) : listStocks(),
    );

    reply.send(
      paginated(stocks, {
        total: stocks.length,
      }),
    );
  });

  app.get("/:ticker", async (request, reply) => {
    const params = stockTickerParamsSchema.parse(request.params);
    const stock = await runService(() => getStockProfile(params.ticker));

    if (!stock) {
      throw notFound("Stock not found.");
    }

    reply.send(ok(stock));
  });

  app.get("/:ticker/research-bundle", async (request, reply) => {
    const params = stockTickerParamsSchema.parse(request.params);
    const bundle = await runService(() => getStockResearchBundle(params.ticker));

    if (!bundle) {
      throw notFound("Stock not found.");
    }

    reply.send(ok(bundle));
  });

  app.patch("/:ticker", async (request, reply) => {
    const params = stockTickerParamsSchema.parse(request.params);
    const body = updateStockMetadataBodySchema.parse(request.body);

    const stock = await runService(() => updateStockMetadata(params.ticker, body));
    reply.send(ok(stock));
  });
}
