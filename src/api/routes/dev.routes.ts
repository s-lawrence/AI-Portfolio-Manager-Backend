import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { notFound, runService } from "../errors";
import { ok } from "../response";
import { booleanQuerySchema } from "../schemas/common.schemas";
import {
  getFmpAnalystAudit,
  getMarketDataAudit,
  purgeDemoAnalyticalData,
  runGdeltQueryAudit,
  seedDemoMarketData,
} from "../../services";
import {
  getPortfolioWithHoldings,
  listPortfoliosByUserId,
} from "../../repositories/portfolios.repository";
import { getUserByEmail } from "../../repositories/users.repository";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PORTFOLIO_NAME = "Demo Portfolio";

const demoContextResponseSchema = z.object({
  user: z.object({
    id: z.string().cuid(),
    email: z.literal(DEMO_EMAIL),
    name: z.string(),
  }),
  portfolio: z.object({
    id: z.string().cuid(),
    name: z.string(),
  }),
  holdings: z.array(
    z.object({
      id: z.string().cuid(),
      ticker: z.string(),
      companyName: z.string(),
      status: z.string(),
    }),
  ),
});

const seedDemoMarketDataQuerySchema = z.object({
  runAnalysis: booleanQuerySchema.optional(),
});

const marketDataAuditParamsSchema = z.object({
  ticker: z.string().trim().min(1),
});

const analystAuditParamsSchema = z.object({
  ticker: z.string().trim().min(1),
});

const gdeltQueryAuditQuerySchema = z.object({
  query: z.string().trim().min(1),
  maxRecords: z.coerce.number().int().positive().max(100).optional(),
});

const purgeDemoAnalyticalDataBodySchema = z.object({
  ticker: z.string().trim().min(1).optional(),
  portfolioId: z.string().cuid().optional(),
  allowLegacyDemoPurge: booleanQuerySchema.optional(),
});

const purgePortfolioParamsSchema = z.object({
  portfolioId: z.string().cuid(),
});

const purgeTickerParamsSchema = z.object({
  ticker: z.string().trim().min(1),
});

export async function devRoutes(app: FastifyInstance): Promise<void> {
  app.get("/routes", async (_request, reply) => {
    return reply.send(
      ok({
        nodeEnv: process.env.NODE_ENV ?? "development",
        cwd: process.cwd(),
        routes: app.printRoutes(),
      }),
    );
  });

  app.get("/demo-context", async (_request, reply) => {
    const user = await runService(() => getUserByEmail(DEMO_EMAIL));
    if (!user) {
      throw notFound(
        "Demo user not found. Run `npm run prisma:seed` to create local demo context.",
      );
    }

    const portfolios = await runService(() => listPortfoliosByUserId(user.id));
    const demoPortfolio = portfolios.find(
      (portfolio) => portfolio.name === DEMO_PORTFOLIO_NAME,
    );

    if (!demoPortfolio) {
      throw notFound(
        "Demo Portfolio not found for demo@example.com. Run `npm run prisma:seed`.",
      );
    }

    const portfolioWithHoldings = await runService(() =>
      getPortfolioWithHoldings(demoPortfolio.id),
    );

    if (!portfolioWithHoldings) {
      throw notFound("Demo portfolio could not be loaded.");
    }

    const data = demoContextResponseSchema.parse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? "Demo User",
      },
      portfolio: {
        id: demoPortfolio.id,
        name: demoPortfolio.name,
      },
      holdings: portfolioWithHoldings.holdings.map((holding) => ({
        id: holding.id,
        ticker: holding.stock.ticker,
        companyName: holding.stock.companyName ?? "Unknown Company",
        status: holding.status,
      })),
    });

    return reply.send(ok(data));
  });

  app.post("/seed-demo-market-data", async (request, reply) => {
    const query = seedDemoMarketDataQuerySchema.parse(request.query ?? {});
    const body = seedDemoMarketDataQuerySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      seedDemoMarketData({
        runAnalysis: query.runAnalysis ?? body.runAnalysis ?? false,
      }),
    );

    return reply.send(ok(result));
  });

  app.get("/market-data-audit/:ticker", async (request, reply) => {
    const params = marketDataAuditParamsSchema.parse(request.params ?? {});

    const data = await runService(() => getMarketDataAudit(params.ticker));
    if (!data) {
      throw notFound(`No stock found for ticker ${params.ticker.toUpperCase()}.`);
    }

    return reply.send(ok(data));
  });

  app.get("/fmp/analyst-audit/:ticker", async (request, reply) => {
    const params = analystAuditParamsSchema.parse(request.params ?? {});

    const data = await runService(() => getFmpAnalystAudit(params.ticker));
    return reply.send(ok(data));
  });

  app.get("/gdelt/query-audit", async (request, reply) => {
    const query = gdeltQueryAuditQuerySchema.parse(request.query ?? {});

    const data = await runService(() =>
      runGdeltQueryAudit(query.query, {
        maxRecords: query.maxRecords,
      }),
    );

    return reply.send(ok(data));
  });

  app.post("/purge-demo-analytical-data", async (request, reply) => {
    const body = purgeDemoAnalyticalDataBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      purgeDemoAnalyticalData({
        ticker: body.ticker,
        portfolioId: body.portfolioId,
        allowLegacyDemoPurge: body.allowLegacyDemoPurge ?? false,
      }),
    );

    return reply.send(ok(result));
  });

  app.post("/purge-demo-analytical-data/portfolio/:portfolioId", async (request, reply) => {
    const params = purgePortfolioParamsSchema.parse(request.params ?? {});
    const body = purgeDemoAnalyticalDataBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      purgeDemoAnalyticalData({
        portfolioId: params.portfolioId,
        allowLegacyDemoPurge: body.allowLegacyDemoPurge ?? false,
      }),
    );

    return reply.send(ok(result));
  });

  app.post("/purge-demo-analytical-data/ticker/:ticker", async (request, reply) => {
    const params = purgeTickerParamsSchema.parse(request.params ?? {});
    const body = purgeDemoAnalyticalDataBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      purgeDemoAnalyticalData({
        ticker: params.ticker,
        allowLegacyDemoPurge: body.allowLegacyDemoPurge ?? false,
      }),
    );

    return reply.send(ok(result));
  });
}
