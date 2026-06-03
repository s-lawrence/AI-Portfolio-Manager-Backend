import { PortfolioSummary, RiskLevel, Sentiment } from "@prisma/client";

import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import {
  createPortfolioSummary,
  getLatestPortfolioSummary as getLatestPortfolioSummaryRepository,
  listPortfolioSummaries as listPortfolioSummariesRepository,
} from "../repositories/portfolio-summaries.repository";
import { getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import { normalizeListLimit } from "../types/common";
import { listUpcomingPortfolioEarnings } from "./earnings.service";

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function riskLevelFromScore(riskScore: number): RiskLevel {
  if (riskScore <= 30) {
    return RiskLevel.LOW;
  }

  if (riskScore <= 60) {
    return RiskLevel.MEDIUM;
  }

  if (riskScore <= 80) {
    return RiskLevel.HIGH;
  }

  return RiskLevel.CRITICAL;
}

function topFactors(values: string[][], limit: number): string[] {
  const counts = new Map<string, number>();

  for (const collection of values) {
    for (const item of collection) {
      const normalized = item.trim();
      if (!normalized) {
        continue;
      }

      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] === left[1]) {
        return left[0].localeCompare(right[0]);
      }

      return right[1] - left[1];
    })
    .slice(0, limit)
    .map(([label]) => label);
}

/**
 * Builds and persists a portfolio summary using latest local reports.
 */
export async function generateMockPortfolioSummary(
  portfolioId: string,
): Promise<PortfolioSummary> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const portfolio = await getPortfolioWithHoldings(normalizedPortfolioId);

  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  const reportsByHolding = await Promise.all(
    portfolio.holdings.map(async (holding) => ({
      holding,
      report: await getLatestAIReportByStockId(holding.stockId),
    })),
  );

  let bullishHoldingsCount = 0;
  let bearishHoldingsCount = 0;
  let neutralHoldingsCount = 0;

  for (const entry of reportsByHolding) {
    if (!entry.report) {
      neutralHoldingsCount += 1;
      continue;
    }

    if (entry.report.sentiment === Sentiment.BULLISH) {
      bullishHoldingsCount += 1;
    } else if (entry.report.sentiment === Sentiment.BEARISH) {
      bearishHoldingsCount += 1;
    } else {
      neutralHoldingsCount += 1;
    }
  }

  const reports = reportsByHolding
    .map((entry) => entry.report)
    .filter((report): report is NonNullable<typeof report> => report != null);

  let overallSentiment: Sentiment = Sentiment.NEUTRAL;
  if (bullishHoldingsCount > bearishHoldingsCount && bullishHoldingsCount > 0) {
    overallSentiment = Sentiment.BULLISH;
  } else if (bearishHoldingsCount > bullishHoldingsCount && bearishHoldingsCount > 0) {
    overallSentiment = Sentiment.BEARISH;
  } else if (bullishHoldingsCount > 0 && bearishHoldingsCount > 0) {
    overallSentiment = Sentiment.MIXED;
  }

  const overallRiskScore =
    reports.length > 0
      ? reports.reduce((sum, report) => sum + report.riskScore, 0) / reports.length
      : 50;

  const overallRiskLevel = riskLevelFromScore(overallRiskScore);

  const reportWithHighestRisk = reportsByHolding
    .filter((entry) => entry.report != null)
    .sort((left, right) => (right.report?.riskScore ?? 0) - (left.report?.riskScore ?? 0))[0];

  const reportWithHighestConfidence = reportsByHolding
    .filter((entry) => entry.report != null)
    .sort(
      (left, right) =>
        (right.report?.confidenceScore ?? 0) - (left.report?.confidenceScore ?? 0),
    )[0];

  const sectorCounts = new Map<string, number>();
  for (const holding of portfolio.holdings) {
    const sector = holding.stock.sector?.trim();
    if (!sector) {
      continue;
    }

    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  }

  const concentrationRisks = Array.from(sectorCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([sector, count]) => `Sector concentration: ${sector} (${count} holdings).`);

  const suggestedWatchItems = reportsByHolding
    .filter((entry) => !entry.report)
    .map(
      (entry) =>
        `Generate a ticker report for ${entry.holding.stock.ticker} to improve portfolio coverage.`,
    );

  const upcomingEarnings = await listUpcomingPortfolioEarnings(normalizedPortfolioId);

  return createPortfolioSummary({
    portfolioId: normalizedPortfolioId,
    summaryDate: new Date(),
    overallSentiment,
    overallRiskScore,
    overallRiskLevel,
    bullishHoldingsCount,
    bearishHoldingsCount,
    neutralHoldingsCount,
    topPositiveDevelopments: topFactors(
      reports.map((report) => report.bullishFactors),
      5,
    ),
    topNegativeDevelopments: topFactors(
      reports.map((report) => report.bearishFactors),
      5,
    ),
    highestRiskTicker: reportWithHighestRisk?.holding.stock.ticker ?? null,
    highestConvictionTicker:
      reportWithHighestConfidence?.holding.stock.ticker ?? null,
    upcomingEarnings: upcomingEarnings.map((entry) => ({
      ticker: entry.ticker,
      earningsDate: entry.event.earningsDate?.toISOString() ?? null,
      fiscalQuarter: entry.event.fiscalQuarter ?? null,
      fiscalYear: entry.event.fiscalYear ?? null,
    })),
    concentrationRisks,
    suggestedWatchItems,
  });
}

export async function getLatestPortfolioSummary(
  portfolioId: string,
): Promise<PortfolioSummary | null> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  return getLatestPortfolioSummaryRepository(normalizedPortfolioId);
}

export async function listPortfolioSummaries(
  portfolioId: string,
  limit?: number,
): Promise<PortfolioSummary[]> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  return listPortfolioSummariesRepository(
    normalizedPortfolioId,
    normalizeListLimit(limit),
  );
}
