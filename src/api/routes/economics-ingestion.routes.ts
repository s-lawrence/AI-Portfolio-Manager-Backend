import type { FastifyInstance } from "fastify";

import {
  ingestFmpEconomicCalendar,
  ingestFmpEconomicIndicators,
  ingestFmpEconomicsDefaultSet,
  ingestFmpMarketRiskPremium,
  ingestFmpTreasuryRates,
} from "../../services";
import { runService } from "../errors";
import { ok } from "../response";
import {
  ingestFmpEconomicCalendarBodySchema,
  ingestFmpEconomicIndicatorsBodySchema,
  ingestFmpEconomicsDefaultSetBodySchema,
  ingestFmpMarketRiskPremiumBodySchema,
  ingestFmpTreasuryRatesBodySchema,
} from "../schemas/economics-ingestion.schemas";

export async function economicsIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/fmp/economics/treasury-rates", async (request, reply) => {
    const body = ingestFmpTreasuryRatesBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestFmpTreasuryRates({
        from: body.from,
        to: body.to,
        limit: body.limit,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/economics/indicators", async (request, reply) => {
    const body = ingestFmpEconomicIndicatorsBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const namesOrSeries =
      body.namesOrSeries && body.namesOrSeries.length > 0
        ? body.namesOrSeries
        : body.nameOrSeries
          ? [body.nameOrSeries]
          : undefined;

    const result = await runService(() =>
      ingestFmpEconomicIndicators({
        namesOrSeries,
        from: body.from,
        to: body.to,
        limit: body.limit,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/economics/calendar", async (request, reply) => {
    const body = ingestFmpEconomicCalendarBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestFmpEconomicCalendar({
        from: body.from,
        to: body.to,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/economics/market-risk-premium", async (request, reply) => {
    const body = ingestFmpMarketRiskPremiumBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestFmpMarketRiskPremium({
        from: body.from,
        to: body.to,
      }),
    );

    reply.send(ok(result));
  });

  app.post("/fmp/economics/default-set", async (request, reply) => {
    const body = ingestFmpEconomicsDefaultSetBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const result = await runService(() =>
      ingestFmpEconomicsDefaultSet({
        includeTreasuryRates: body.includeTreasuryRates,
        includeIndicators: body.includeIndicators,
        includeCalendar: body.includeCalendar,
        includeMarketRiskPremium: body.includeMarketRiskPremium,
        treasuryRatesFrom: body.treasuryRatesFrom,
        treasuryRatesTo: body.treasuryRatesTo,
        treasuryRatesLimit: body.treasuryRatesLimit,
        indicatorsFrom: body.indicatorsFrom,
        indicatorsTo: body.indicatorsTo,
        indicatorsLimit: body.indicatorsLimit,
        indicatorNamesOrSeries: body.indicatorNamesOrSeries,
        calendarFrom: body.calendarFrom,
        calendarTo: body.calendarTo,
        marketRiskPremiumFrom: body.marketRiskPremiumFrom,
        marketRiskPremiumTo: body.marketRiskPremiumTo,
      }),
    );

    reply.send(ok(result));
  });
}
