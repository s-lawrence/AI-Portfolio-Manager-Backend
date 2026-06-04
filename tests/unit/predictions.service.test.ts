import {
  PredictionDirection,
  PredictionHorizon,
  Recommendation,
  RiskLevel,
  Sentiment,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  calculatePredictionOutcome,
  createPredictionFromReport,
  listOpenPredictions,
  listPredictionsDueForOutcome,
} from "../../src/services/predictions.service";
import { createPredictionOutcome } from "../../src/repositories/prediction-outcomes.repository";
import { listPredictionsByStockId } from "../../src/repositories/predictions.repository";
import {
  createTestAIReport,
  createTestPrediction,
  createTestPriceSnapshot,
  createTestStock,
} from "../../src/test/factories";

describe("predictions.service", () => {
  it("creates a prediction from report and avoids duplicates for same horizon", async () => {
    const stock = await createTestStock("TSTPRD1");
    const report = await createTestAIReport(stock.id, {
      reportDate: new Date("2026-06-01T00:00:00.000Z"),
      recommendation: Recommendation.BUY,
      sentiment: Sentiment.BULLISH,
      riskScore: 30,
      riskLevel: RiskLevel.LOW,
      confidenceScore: 0.75,
      currentPrice: 100,
      dailyChangePercent: 2.5,
    });

    const first = await createPredictionFromReport(
      report.id,
      PredictionHorizon.ONE_DAY,
    );

    const second = await createPredictionFromReport(
      report.id,
      PredictionHorizon.ONE_DAY,
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.prediction.id).toBe(first.prediction.id);
  });

  it("lists only predictions due by horizon threshold", async () => {
    const stock = await createTestStock("TSTPRD2");

    const duePrediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    const notDuePrediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-10T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_WEEK,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    const due = await listPredictionsDueForOutcome(
      new Date("2026-06-03T00:00:00.000Z"),
    );

    const dueIds = due.map((item) => item.id);
    expect(dueIds).toContain(duePrediction.id);
    expect(dueIds).not.toContain(notDuePrediction.id);
  });

  it("scores an UP prediction as correct when ending price is higher", async () => {
    const stock = await createTestStock("TSTPRD3");
    const prediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 110,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const result = await calculatePredictionOutcome(
      prediction.id,
      new Date("2026-06-03T00:00:00.000Z"),
    );

    expect(result.status).toBe("scored");
    if (result.status === "scored") {
      expect(result.outcome.wasDirectionallyCorrect).toBe(true);
      expect(result.outcome.percentageReturn).toBeGreaterThan(0);
    }
  });

  it("scores a DOWN prediction as correct when ending price is lower", async () => {
    const stock = await createTestStock("TSTPRD4");
    const prediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      direction: PredictionDirection.DOWN,
      startingPrice: 100,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 90,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const result = await calculatePredictionOutcome(
      prediction.id,
      new Date("2026-06-03T00:00:00.000Z"),
    );

    expect(result.status).toBe("scored");
    if (result.status === "scored") {
      expect(result.outcome.wasDirectionallyCorrect).toBe(true);
      expect(result.outcome.percentageReturn).toBeLessThan(0);
    }
  });

  it("scores a FLAT prediction as correct inside threshold", async () => {
    const stock = await createTestStock("TSTPRD5");
    const prediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      direction: PredictionDirection.FLAT,
      startingPrice: 100,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 100.5,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const result = await calculatePredictionOutcome(
      prediction.id,
      new Date("2026-06-03T00:00:00.000Z"),
    );

    expect(result.status).toBe("scored");
    if (result.status === "scored") {
      expect(result.outcome.wasDirectionallyCorrect).toBe(true);
    }
  });

  it("does not create duplicate outcomes when already scored", async () => {
    const stock = await createTestStock("TSTPRD6");
    const prediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    await createTestPriceSnapshot(stock.id, {
      price: 102,
      capturedAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    const first = await calculatePredictionOutcome(
      prediction.id,
      new Date("2026-06-03T00:00:00.000Z"),
    );

    const second = await calculatePredictionOutcome(
      prediction.id,
      new Date("2026-06-03T00:00:00.000Z"),
    );

    expect(first.status).toBe("scored");
    expect(second.status).toBe("already_scored");

    if (first.status === "scored" && second.status === "already_scored") {
      expect(second.outcome.id).toBe(first.outcome.id);
    }
  });

  it("skips scoring when no suitable outcome price exists", async () => {
    const stock = await createTestStock("TSTPRD7");
    const prediction = await createTestPrediction(stock.id, {
      predictionDate: new Date("2026-06-01T00:00:00.000Z"),
      horizon: PredictionHorizon.ONE_DAY,
      direction: PredictionDirection.UP,
      startingPrice: 100,
    });

    const result = await calculatePredictionOutcome(
      prediction.id,
      new Date("2026-06-03T00:00:00.000Z"),
    );

    expect(result.status).toBe("skipped_no_price");
  });

  it("reuses same-day open prediction across different reports for same stock/holding/horizon", async () => {
    const stock = await createTestStock("TSTPRD8");
    const reportDay = new Date("2026-06-05T09:00:00.000Z");

    const firstReport = await createTestAIReport(stock.id, {
      reportDate: reportDay,
      recommendation: Recommendation.BUY,
      confidenceScore: 0.7,
      currentPrice: 100,
    });

    const secondReport = await createTestAIReport(stock.id, {
      reportDate: new Date("2026-06-05T18:30:00.000Z"),
      recommendation: Recommendation.SELL,
      confidenceScore: 0.55,
      currentPrice: 102,
    });

    const first = await createPredictionFromReport(
      firstReport.id,
      PredictionHorizon.ONE_WEEK,
    );

    const second = await createPredictionFromReport(
      secondReport.id,
      PredictionHorizon.ONE_WEEK,
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.prediction.id).toBe(first.prediction.id);
    expect(second.prediction.aiReportId).toBe(secondReport.id);
    expect(second.prediction.recommendation).toBe(Recommendation.SELL);

    const predictions = await listPredictionsByStockId(stock.id, 20);
    expect(predictions.filter((item) => item.horizon === PredictionHorizon.ONE_WEEK)).toHaveLength(1);
  });

  it("does not overwrite completed predictions when creating same-day predictions", async () => {
    const stock = await createTestStock("TSTPRD9");
    const reportDay = new Date("2026-06-06T10:00:00.000Z");

    const firstReport = await createTestAIReport(stock.id, {
      reportDate: reportDay,
      recommendation: Recommendation.BUY,
      currentPrice: 100,
    });

    const first = await createPredictionFromReport(
      firstReport.id,
      PredictionHorizon.ONE_DAY,
    );

    await createPredictionOutcome({
      predictionId: first.prediction.id,
      outcomeDate: new Date("2026-06-07T12:00:00.000Z"),
      endingPrice: 110,
      absoluteReturn: 10,
      percentageReturn: 10,
      wasDirectionallyCorrect: true,
      errorScore: 0,
      calibrationScore: 1,
    });

    const secondReport = await createTestAIReport(stock.id, {
      reportDate: new Date("2026-06-06T20:00:00.000Z"),
      recommendation: Recommendation.SELL,
      currentPrice: 95,
    });

    const second = await createPredictionFromReport(
      secondReport.id,
      PredictionHorizon.ONE_DAY,
    );

    expect(second.created).toBe(true);
    expect(second.prediction.id).not.toBe(first.prediction.id);

    const predictions = await listPredictionsByStockId(stock.id, 20);
    expect(predictions.filter((item) => item.horizon === PredictionHorizon.ONE_DAY)).toHaveLength(2);
  });

  it("returns ticker/company metadata and dueDate on open prediction list items", async () => {
    const stock = await createTestStock("TSTPRD0");
    const report = await createTestAIReport(stock.id, {
      reportDate: new Date("2026-06-08T00:00:00.000Z"),
      recommendation: Recommendation.HOLD,
      currentPrice: 100,
    });

    await createPredictionFromReport(report.id, PredictionHorizon.ONE_DAY);

    const openPredictions = await listOpenPredictions();
    const item = openPredictions.find((prediction) => prediction.stockId === stock.id);

    expect(item).toBeTruthy();
    expect(item?.ticker).toBe("TSTPRD0");
    expect(typeof item?.companyName).toBe("string");
    expect(item?.dueDate).toBeInstanceOf(Date);
  });
});
