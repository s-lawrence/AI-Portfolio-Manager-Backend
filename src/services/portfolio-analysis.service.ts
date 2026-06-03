import {
  PortfolioAnalysisReportSummary,
  PortfolioAnalysisResult,
  PortfolioAnalysisTickerFailure,
} from "../types/services";
import { generateMockTickerReport } from "./ai-reports.service";
import { generateMockPortfolioSummary } from "./portfolio-summaries.service";
import { getPortfolioOverview } from "./portfolios.service";

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function toErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export async function runPortfolioAnalysis(
  portfolioId: string,
): Promise<PortfolioAnalysisResult> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");

  const startedAtDate = new Date();
  const overview = await getPortfolioOverview(normalizedPortfolioId);

  if (!overview) {
    throw new Error("Portfolio not found.");
  }

  const reports: PortfolioAnalysisReportSummary[] = [];
  const failedTickers: PortfolioAnalysisTickerFailure[] = [];

  let reportsCreated = 0;
  let predictionsCreated = 0;

  for (const holding of overview.holdings) {
    const ticker = holding.stock.ticker;

    try {
      const result = await generateMockTickerReport(ticker, holding.id);
      reportsCreated += 1;
      predictionsCreated += result.predictions.length;

      reports.push({
        id: result.report.id,
        ticker,
        recommendation: result.report.recommendation,
        sentiment: result.report.sentiment,
        confidenceScore: result.report.confidenceScore,
        riskScore: result.report.riskScore,
      });
    } catch (error) {
      failedTickers.push({
        ticker,
        reason: toErrorReason(error),
      });
    }
  }

  let portfolioSummary: PortfolioAnalysisResult["portfolioSummary"] = null;

  if (overview.holdings.length === 0 || reportsCreated > 0) {
    const summary = await generateMockPortfolioSummary(normalizedPortfolioId);
    portfolioSummary = {
      id: summary.id,
      overallSentiment: summary.overallSentiment,
      overallRiskScore: summary.overallRiskScore,
      overallRiskLevel: summary.overallRiskLevel,
    };
  }

  const finishedAtDate = new Date();

  return {
    portfolioId: normalizedPortfolioId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    holdingsAnalyzed: overview.holdings.length,
    reportsCreated,
    predictionsCreated,
    failedTickers,
    reports,
    portfolioSummary,
  };
}
