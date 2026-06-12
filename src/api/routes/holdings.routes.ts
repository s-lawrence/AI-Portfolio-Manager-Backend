import type { FastifyInstance } from "fastify";

import {
  assertHoldingOwnership,
  assertPortfolioOwnership,
} from "../../auth";
import { notFound, runService } from "../errors";
import { created, deleted, ok, paginated } from "../response";
import {
  createHoldingBodySchema,
  correctHoldingStockBodySchema,
  holdingIdParamsSchema,
  holdingPortfolioIdParamsSchema,
  updateHoldingBodySchema,
} from "../schemas/holdings.schemas";
import {
  addTickerToPortfolio,
  correctHoldingStock,
  getHoldingOverview,
  isAmbiguousTickerSymbol,
  listPortfolioHoldings,
  removeHolding,
  updateHoldingDetails,
} from "../../services";

function buildTickerAmbiguityWarnings(ticker: string): string[] {
  if (!isAmbiguousTickerSymbol(ticker)) {
    return [];
  }

  return [`Ticker ${ticker} is ambiguous; verify security mapping.`];
}

export async function holdingsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", async (request, reply) => {
    const body = createHoldingBodySchema.parse(request.body);
    await runService(() => assertPortfolioOwnership(request, body.portfolioId));

    const holding = await runService(() =>
      addTickerToPortfolio(body.portfolioId, body.ticker, {
        status: body.status,
        shares: body.shares,
        averageCost: body.averageCost,
        targetAllocation: body.targetAllocation,
        thesis: body.thesis,
        exitCriteria: body.exitCriteria,
        userNotes: body.userNotes,
      }),
    );

    const warnings = buildTickerAmbiguityWarnings(body.ticker);

    reply.status(201).send(created({
      ...holding,
      warnings,
    }));
  });

  app.get("/:holdingId", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);
    await runService(() => assertHoldingOwnership(request, params.holdingId));
    const overview = await runService(() => getHoldingOverview(params.holdingId));

    if (!overview) {
      throw notFound("Holding not found.");
    }

    reply.send(ok(overview));
  });

  app.get("/portfolio/:portfolioId", async (request, reply) => {
    const params = holdingPortfolioIdParamsSchema.parse(request.params);
    await runService(() => assertPortfolioOwnership(request, params.portfolioId));
    const holdings = await runService(() => listPortfolioHoldings(params.portfolioId));

    reply.send(
      paginated(holdings, {
        total: holdings.length,
      }),
    );
  });

  app.patch("/:holdingId", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);
    const body = updateHoldingBodySchema.parse(request.body);
    await runService(() => assertHoldingOwnership(request, params.holdingId));

    const holding = await runService(() => updateHoldingDetails(params.holdingId, body));
    reply.send(ok(holding));
  });

  app.patch("/:holdingId/stock", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);
    const body = correctHoldingStockBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    await runService(() => assertHoldingOwnership(request, params.holdingId));

    const result = await runService(() =>
      correctHoldingStock(params.holdingId, {
        stockId: body.stockId,
        ticker: body.ticker,
        companyName: body.companyName,
        exchange: body.exchange,
        currency: body.currency,
        country: body.country,
        provider: body.provider,
        refreshAfterCorrection: body.refreshAfterCorrection,
      }),
    );

    reply.send(ok(result));
  });

  app.delete("/:holdingId", async (request, reply) => {
    const params = holdingIdParamsSchema.parse(request.params);
    await runService(() => assertHoldingOwnership(request, params.holdingId));

    await runService(() => removeHolding(params.holdingId));
    reply.send(deleted());
  });
}
