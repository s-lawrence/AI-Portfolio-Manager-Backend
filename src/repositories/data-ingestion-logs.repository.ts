import { DataIngestionLog, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { RepositoryListOptions, normalizeListLimit } from "../types/common";

export interface DataIngestionLogListOptions extends RepositoryListOptions {
  jobName?: string;
  ticker?: string;
  status?: string;
  provider?: string;
}

export async function createDataIngestionLog(
  input: Prisma.DataIngestionLogCreateInput,
): Promise<DataIngestionLog> {
  return prisma.dataIngestionLog.create({ data: input });
}

export async function updateDataIngestionLog(
  id: string,
  input: Prisma.DataIngestionLogUpdateInput,
): Promise<DataIngestionLog> {
  return prisma.dataIngestionLog.update({
    where: { id },
    data: input,
  });
}

export async function listDataIngestionLogs(
  options?: DataIngestionLogListOptions,
): Promise<DataIngestionLog[]> {
  const where: Prisma.DataIngestionLogWhereInput = {};

  if (options?.jobName) {
    where.jobName = options.jobName;
  }

  if (options?.ticker) {
    where.ticker = options.ticker;
  }

  if (options?.status) {
    where.status = options.status;
  }

  if (options?.provider) {
    where.provider = options.provider;
  }

  if (options?.from || options?.to) {
    where.startedAt = {
      gte: options.from,
      lte: options.to,
    };
  }

  return prisma.dataIngestionLog.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: normalizeListLimit(options?.limit),
    skip: options?.offset,
  });
}

export async function getLatestLogForJob(
  jobName: string,
): Promise<DataIngestionLog | null> {
  return prisma.dataIngestionLog.findFirst({
    where: { jobName },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * Returns recent logs that represent failed ingestion attempts.
 */
export async function getFailedLogs(limit?: number): Promise<DataIngestionLog[]> {
  return prisma.dataIngestionLog.findMany({
    where: {
      status: {
        in: ["FAILED", "ERROR"],
      },
    },
    orderBy: { startedAt: "desc" },
    take: normalizeListLimit(limit),
  });
}
