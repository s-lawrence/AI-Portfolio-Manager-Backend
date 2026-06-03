import {
  Prediction,
  PredictionDirection,
  PredictionHorizon,
  PredictionOutcome,
  Recommendation,
} from "@prisma/client";

import { getAIReportById } from "../repositories/ai-reports.repository";
import {
  createPrediction,
  getPredictionById,
  listOpenPredictions as listOpenPredictionsRepository,
  listPredictionsByStockId,
  listPredictionsDueForOutcome as listPredictionsDueForOutcomeRepository,
} from "../repositories/predictions.repository";
import {
  createPredictionOutcome,
  getPredictionOutcomeByPredictionId,
} from "../repositories/prediction-outcomes.repository";
import { listPriceSnapshotsByStockId } from "../repositories/price-snapshots.repository";
import {
  PredictionCreationFromReportResult,
  PredictionOutcomeCalculationInput,
  PredictionScoringSummary,
} from "../types/services";
import { getStockProfile } from "./stocks.service";

const FLAT_THRESHOLD_PERCENT = 1;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function horizonToDays(horizon: PredictionHorizon): number {
  if (horizon === PredictionHorizon.ONE_DAY) {
    return 1;
  }

  if (horizon === PredictionHorizon.ONE_WEEK) {
    return 7;
  }

  return 30;
}

function directionFromRecommendation(
  recommendation: Recommendation,
  dailyChangePercent?: number | null,
): PredictionDirection {
  if (recommendation === Recommendation.BUY) {
    return PredictionDirection.UP;
  }

  if (recommendation === Recommendation.SELL) {
    return PredictionDirection.DOWN;
  }

  if ((dailyChangePercent ?? 0) > 1) {
    return PredictionDirection.UP;
  }

  if ((dailyChangePercent ?? 0) < -1) {
    return PredictionDirection.DOWN;
  }

  return PredictionDirection.FLAT;
}

function targetBandMultiplier(horizon: PredictionHorizon): number {
  if (horizon === PredictionHorizon.ONE_DAY) {
    return 0.03;
  }

  if (horizon === PredictionHorizon.ONE_WEEK) {
    return 0.07;
  }

  return 0.15;
}

function normalizeConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export type PredictionOutcomeComputationResult =
  | {
      status: "scored";
      prediction: Prediction;
      outcome: PredictionOutcome;
    }
  | {
      status: "already_scored";
      prediction: Prediction;
      outcome: PredictionOutcome;
    }
  | {
      status: "not_due";
      prediction: Prediction;
      dueDate: Date;
    }
  | {
      status: "skipped_no_price";
      prediction: Prediction;
      dueDate: Date;
      reason: string;
    };

export interface PredictionScoringRunResult extends PredictionScoringSummary {
  results: PredictionOutcomeComputationResult[];
}

export async function createPredictionFromReport(
  reportId: string,
  horizon: PredictionHorizon,
): Promise<PredictionCreationFromReportResult> {
  const normalizedReportId = assertNonBlank(reportId, "reportId");
  const report = await getAIReportById(normalizedReportId);

  if (!report) {
    throw new Error("AI report not found.");
  }

  const existingPredictions = await listPredictionsByStockId(report.stockId, 500);
  const existing = existingPredictions.find(
    (prediction) =>
      prediction.aiReportId === report.id && prediction.horizon === horizon,
  );

  if (existing) {
    return {
      prediction: existing,
      created: false,
    };
  }

  const latestSnapshot = await listPriceSnapshotsByStockId(report.stockId, 1);
  const startingPrice = report.currentPrice ?? latestSnapshot[0]?.price ?? null;

  if (startingPrice == null) {
    throw new Error("Cannot create prediction without a known starting price.");
  }

  const targetBand = targetBandMultiplier(horizon);
  const prediction = await createPrediction({
    stockId: report.stockId,
    holdingId: report.holdingId,
    aiReportId: report.id,
    predictionDate: report.reportDate,
    horizon,
    recommendation: report.recommendation,
    direction: directionFromRecommendation(
      report.recommendation,
      report.dailyChangePercent,
    ),
    confidenceScore: report.confidenceScore,
    startingPrice,
    targetLow: startingPrice * (1 - targetBand),
    targetHigh: startingPrice * (1 + targetBand),
    bullishRationale:
      report.bullishFactors.length > 0
        ? report.bullishFactors.join("; ")
        : null,
    bearishRationale:
      report.bearishFactors.length > 0
        ? report.bearishFactors.join("; ")
        : null,
    dataUsed: {
      source: "ai-report",
      reportId: report.id,
    },
  });

  return {
    prediction,
    created: true,
  };
}

export async function listOpenPredictions(): Promise<Prediction[]> {
  return listOpenPredictionsRepository();
}

export async function listPredictionsDueForOutcome(
  asOfDate: Date,
): Promise<Prediction[]> {
  return listPredictionsDueForOutcomeRepository(asOfDate);
}

/**
 * Calculates and stores the prediction outcome when enough data exists.
 */
export async function calculatePredictionOutcome(
  predictionId: string,
  asOfDate?: Date,
): Promise<PredictionOutcomeComputationResult> {
  const normalizedPredictionId = assertNonBlank(predictionId, "predictionId");
  const prediction = await getPredictionById(normalizedPredictionId);

  if (!prediction) {
    throw new Error("Prediction not found.");
  }

  const existingOutcome = await getPredictionOutcomeByPredictionId(normalizedPredictionId);
  if (existingOutcome) {
    return {
      status: "already_scored",
      prediction,
      outcome: existingOutcome,
    };
  }

  const effectiveAsOfDate = asOfDate ?? new Date();
  const dueDate = addDays(prediction.predictionDate, horizonToDays(prediction.horizon));

  if (effectiveAsOfDate < dueDate) {
    return {
      status: "not_due",
      prediction,
      dueDate,
    };
  }

  const historicalPrices = await listPriceSnapshotsByStockId(prediction.stockId, 500);
  const outcomePrice = historicalPrices.find(
    (snapshot) => snapshot.capturedAt.getTime() <= effectiveAsOfDate.getTime(),
  );

  if (!outcomePrice) {
    return {
      status: "skipped_no_price",
      prediction,
      dueDate,
      reason: "No suitable price snapshot found at or before the requested outcome date.",
    };
  }

  const endingPrice = outcomePrice.price;
  const absoluteReturn = endingPrice - prediction.startingPrice;
  const percentageReturn =
    prediction.startingPrice === 0
      ? 0
      : (absoluteReturn / prediction.startingPrice) * 100;

  const flatThresholdPercent = FLAT_THRESHOLD_PERCENT;
  const wasDirectionallyCorrect =
    prediction.direction === PredictionDirection.UP
      ? endingPrice > prediction.startingPrice
      : prediction.direction === PredictionDirection.DOWN
        ? endingPrice < prediction.startingPrice
        : Math.abs(percentageReturn) <= flatThresholdPercent;

  const errorScore =
    prediction.direction === PredictionDirection.UP
      ? Math.max(0, -percentageReturn)
      : prediction.direction === PredictionDirection.DOWN
        ? Math.max(0, percentageReturn)
        : Math.max(0, Math.abs(percentageReturn) - flatThresholdPercent);

  const calibrationScore =
    1 -
    Math.abs(
      (wasDirectionallyCorrect ? 1 : 0) -
        normalizeConfidence(prediction.confidenceScore),
    );

  const outcome = await createPredictionOutcome({
    predictionId: prediction.id,
    outcomeDate: effectiveAsOfDate,
    endingPrice,
    absoluteReturn,
    percentageReturn,
    wasDirectionallyCorrect,
    errorScore,
    calibrationScore,
  });

  return {
    status: "scored",
    prediction,
    outcome,
  };
}

export async function scoreDuePredictions(
  asOfDate?: Date,
): Promise<PredictionScoringRunResult> {
  const effectiveAsOfDate = asOfDate ?? new Date();
  const duePredictions = await listPredictionsDueForOutcomeRepository(effectiveAsOfDate);

  const results: PredictionOutcomeComputationResult[] = [];
  for (const prediction of duePredictions) {
    const result = await calculatePredictionOutcome(prediction.id, effectiveAsOfDate);
    results.push(result);
  }

  const scoredCount = results.filter((result) => result.status === "scored").length;
  const alreadyScoredCount = results.filter(
    (result) => result.status === "already_scored",
  ).length;
  const skippedNoPriceCount = results.filter(
    (result) => result.status === "skipped_no_price",
  ).length;

  return {
    asOfDate: effectiveAsOfDate,
    totalDue: duePredictions.length,
    scoredCount,
    alreadyScoredCount,
    skippedNoPriceCount,
    results,
  };
}

export async function listPredictionsForTicker(
  ticker: string,
  limit?: number,
): Promise<Prediction[]> {
  const stock = await getStockProfile(ticker);
  if (!stock) {
    return [];
  }

  return listPredictionsByStockId(stock.id, limit);
}
