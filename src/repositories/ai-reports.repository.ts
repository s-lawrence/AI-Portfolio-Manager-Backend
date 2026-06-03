import { AIReport, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { normalizeListLimit } from "../types/common";

export async function createAIReport(
  input: Prisma.AIReportUncheckedCreateInput,
): Promise<AIReport> {
  return prisma.aIReport.create({ data: input });
}

export async function getAIReportById(id: string): Promise<AIReport | null> {
  return prisma.aIReport.findUnique({ where: { id } });
}

export async function getLatestAIReportByStockId(
  stockId: string,
): Promise<AIReport | null> {
  return prisma.aIReport.findFirst({
    where: { stockId },
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function listAIReportsByStockId(
  stockId: string,
  limit?: number,
): Promise<AIReport[]> {
  return prisma.aIReport.findMany({
    where: { stockId },
    orderBy: { reportDate: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function listAIReportsByHoldingId(
  holdingId: string,
  limit?: number,
): Promise<AIReport[]> {
  return prisma.aIReport.findMany({
    where: { holdingId },
    orderBy: { reportDate: "desc" },
    take: normalizeListLimit(limit),
  });
}

export async function listRecentAIReports(limit?: number): Promise<AIReport[]> {
  return prisma.aIReport.findMany({
    orderBy: { reportDate: "desc" },
    take: normalizeListLimit(limit),
  });
}
