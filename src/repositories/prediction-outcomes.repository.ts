import { PredictionOutcome, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createPredictionOutcome(
  input: Prisma.PredictionOutcomeUncheckedCreateInput,
): Promise<PredictionOutcome> {
  return prisma.predictionOutcome.create({ data: input });
}

export async function getPredictionOutcomeByPredictionId(
  predictionId: string,
): Promise<PredictionOutcome | null> {
  return prisma.predictionOutcome.findUnique({
    where: { predictionId },
  });
}

export async function listPredictionOutcomesByStockId(
  stockId: string,
  limit?: number,
): Promise<PredictionOutcome[]> {
  return prisma.predictionOutcome.findMany({
    where: {
      prediction: {
        stockId,
      },
    },
    orderBy: { outcomeDate: "desc" },
    take: normalizeListLimit(limit),
  });
}
