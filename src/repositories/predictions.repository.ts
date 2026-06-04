import { Prediction, PredictionHorizon, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

function subtractDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() - days);
  return value;
}

export async function createPrediction(
  input: Prisma.PredictionUncheckedCreateInput,
): Promise<Prediction> {
  return prisma.prediction.create({ data: input });
}

export async function updatePrediction(
  id: string,
  input: Prisma.PredictionUncheckedUpdateInput,
): Promise<Prediction> {
  return prisma.prediction.update({
    where: { id },
    data: input,
  });
}

export async function getPredictionById(id: string): Promise<Prediction | null> {
  return prisma.prediction.findUnique({ where: { id } });
}

export async function listPredictionsByStockId(
  stockId: string,
  limit?: number,
): Promise<Prediction[]> {
  return prisma.prediction.findMany({
    where: { stockId },
    orderBy: { predictionDate: "desc" },
    take: normalizeListLimit(limit),
  });
}

export type PredictionWithStock = Prediction & {
  stock: {
    ticker: string;
    companyName: string | null;
    exchange: string | null;
    currency: string | null;
  };
};

export async function listPredictionsByStockIdWithStock(
  stockId: string,
  limit?: number,
): Promise<PredictionWithStock[]> {
  return prisma.prediction.findMany({
    where: { stockId },
    include: {
      stock: {
        select: {
          ticker: true,
          companyName: true,
          exchange: true,
          currency: true,
        },
      },
    },
    orderBy: { predictionDate: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function listPredictionsByHoldingId(
  holdingId: string,
  limit?: number,
): Promise<Prediction[]> {
  return prisma.prediction.findMany({
    where: { holdingId },
    orderBy: { predictionDate: "desc" },
    take: normalizeListLimit(limit),
  });
}

/**
 * Lists predictions that do not yet have an outcome row.
 */
export async function listOpenPredictions(): Promise<Prediction[]> {
  return prisma.prediction.findMany({
    where: {
      outcome: {
        is: null,
      },
    },
    orderBy: { predictionDate: "asc" },
  });
}

export async function listOpenPredictionsWithStock(): Promise<PredictionWithStock[]> {
  return prisma.prediction.findMany({
    where: {
      outcome: {
        is: null,
      },
    },
    include: {
      stock: {
        select: {
          ticker: true,
          companyName: true,
          exchange: true,
          currency: true,
        },
      },
    },
    orderBy: { predictionDate: "asc" },
  });
}

/**
 * Lists open predictions whose horizon window has elapsed by the provided asOfDate.
 */
export async function listPredictionsDueForOutcome(
  asOfDate: Date,
): Promise<Prediction[]> {
  const oneDayThreshold = subtractDays(asOfDate, 1);
  const oneWeekThreshold = subtractDays(asOfDate, 7);
  const oneMonthThreshold = subtractDays(asOfDate, 30);

  return prisma.prediction.findMany({
    where: {
      outcome: {
        is: null,
      },
      OR: [
        {
          horizon: PredictionHorizon.ONE_DAY,
          predictionDate: {
            lte: oneDayThreshold,
          },
        },
        {
          horizon: PredictionHorizon.ONE_WEEK,
          predictionDate: {
            lte: oneWeekThreshold,
          },
        },
        {
          horizon: PredictionHorizon.ONE_MONTH,
          predictionDate: {
            lte: oneMonthThreshold,
          },
        },
      ],
    },
    orderBy: { predictionDate: "asc" },
  });
}

export async function listPredictionsDueForOutcomeWithStock(
  asOfDate: Date,
): Promise<PredictionWithStock[]> {
  const oneDayThreshold = subtractDays(asOfDate, 1);
  const oneWeekThreshold = subtractDays(asOfDate, 7);
  const oneMonthThreshold = subtractDays(asOfDate, 30);

  return prisma.prediction.findMany({
    where: {
      outcome: {
        is: null,
      },
      OR: [
        {
          horizon: PredictionHorizon.ONE_DAY,
          predictionDate: {
            lte: oneDayThreshold,
          },
        },
        {
          horizon: PredictionHorizon.ONE_WEEK,
          predictionDate: {
            lte: oneWeekThreshold,
          },
        },
        {
          horizon: PredictionHorizon.ONE_MONTH,
          predictionDate: {
            lte: oneMonthThreshold,
          },
        },
      ],
    },
    include: {
      stock: {
        select: {
          ticker: true,
          companyName: true,
          exchange: true,
          currency: true,
        },
      },
    },
    orderBy: { predictionDate: "asc" },
  });
}

export async function findOpenPredictionByStockHoldingHorizonAndDay(
  stockId: string,
  holdingId: string | null,
  horizon: PredictionHorizon,
  dayStartUtc: Date,
  dayEndUtc: Date,
): Promise<Prediction | null> {
  return prisma.prediction.findFirst({
    where: {
      stockId,
      holdingId,
      horizon,
      predictionDate: {
        gte: dayStartUtc,
        lte: dayEndUtc,
      },
      outcome: {
        is: null,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { predictionDate: "desc" }],
  });
}
