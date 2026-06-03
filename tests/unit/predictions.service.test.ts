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
  listPredictionsDueForOutcome,
} from "../../src/services/predictions.service";
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
});
