import { PortfolioSummary, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createPortfolioSummary(
  input: Prisma.PortfolioSummaryUncheckedCreateInput,
): Promise<PortfolioSummary> {
  return prisma.portfolioSummary.create({ data: input });
}

export async function getLatestPortfolioSummary(
  portfolioId: string,
): Promise<PortfolioSummary | null> {
  return prisma.portfolioSummary.findFirst({
    where: { portfolioId },
    orderBy: [{ summaryDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function listPortfolioSummaries(
  portfolioId: string,
  limit?: number,
): Promise<PortfolioSummary[]> {
  return prisma.portfolioSummary.findMany({
    where: { portfolioId },
    orderBy: { summaryDate: "desc" },
    take: normalizeListLimit(limit),
  });
}
