import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { notFound, runService } from "../errors";
import { ok } from "../response";
import { booleanQuerySchema } from "../schemas/common.schemas";
import {
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

export async function devRoutes(app: FastifyInstance): Promise<void> {
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
}
