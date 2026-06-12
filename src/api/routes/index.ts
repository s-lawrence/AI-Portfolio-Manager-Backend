import type { FastifyInstance } from "fastify";

import { env } from "../../config/env";

import { agentToolsRoutes } from "./agent-tools.routes";
import { analystIngestionRoutes } from "./analyst-ingestion.routes";
import { alertsRoutes } from "./alerts.routes";
import { authRoutes } from "./auth.routes";
import { devRoutes } from "./dev.routes";
import { discoveryRoutes } from "./discovery.routes";
import { economicsIngestionRoutes } from "./economics-ingestion.routes";
import { earningsRoutes } from "./earnings.routes";
import { geopoliticalRoutes } from "./geopolitical.routes";
import { healthRoutes } from "./health.routes";
import { holdingsRoutes } from "./holdings.routes";
import { ingestionRoutes } from "./ingestion.routes";
import { macroIngestionRoutes } from "./macro-ingestion.routes";
import { marketDataRoutes } from "./market-data.routes";
import { newsRoutes } from "./news.routes";
import { portfolioSummariesRoutes } from "./portfolio-summaries.routes";
import { portfoliosRoutes } from "./portfolios.routes";
import { predictionsRoutes } from "./predictions.routes";
import { reportsRoutes } from "./reports.routes";
import { stocksRoutes } from "./stocks.routes";
import { watchlistsRoutes } from "./watchlists.routes";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(portfoliosRoutes, { prefix: "/api/portfolios" });
  await app.register(holdingsRoutes, { prefix: "/api/holdings" });
  await app.register(stocksRoutes, { prefix: "/api/stocks" });
  await app.register(ingestionRoutes, { prefix: "/api/ingestion" });
  await app.register(economicsIngestionRoutes, { prefix: "/api/ingestion" });
  await app.register(macroIngestionRoutes, { prefix: "/api/ingestion" });
  await app.register(marketDataRoutes, { prefix: "/api/market-data" });
  await app.register(newsRoutes, { prefix: "/api/news" });
  await app.register(earningsRoutes, { prefix: "/api/earnings" });
  await app.register(reportsRoutes, { prefix: "/api/reports" });
  await app.register(portfolioSummariesRoutes, {
    prefix: "/api/portfolio-summaries",
  });
  await app.register(predictionsRoutes, { prefix: "/api/predictions" });
  await app.register(alertsRoutes, { prefix: "/api/alerts" });
  await app.register(agentToolsRoutes, { prefix: "/api/agent" });
  await app.register(watchlistsRoutes, { prefix: "/api/watchlists" });
  await app.register(discoveryRoutes, { prefix: "/api/discovery" });
  await app.register(analystIngestionRoutes, { prefix: "/api" });
  await app.register(geopoliticalRoutes, { prefix: "/api" });

  const isProduction = env.NODE_ENV === "production" || process.env.NODE_ENV === "production";

  if (!isProduction) {
    await app.register(devRoutes, { prefix: "/api/dev" });
  }
}
