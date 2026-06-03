import { Alert, AlertSeverity, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";
import { RepositoryListOptions, normalizeListLimit } from "../types/common";

export interface AlertListOptions extends RepositoryListOptions {
  isRead?: boolean;
  severity?: AlertSeverity;
}

export async function createAlert(
  input: Prisma.AlertUncheckedCreateInput,
): Promise<Alert> {
  return prisma.alert.create({ data: input });
}

export async function getAlertById(id: string): Promise<Alert | null> {
  return prisma.alert.findUnique({ where: { id } });
}

export async function listAlertsByUserId(
  userId: string,
  options?: AlertListOptions,
): Promise<Alert[]> {
  const where: Prisma.AlertWhereInput = { userId };

  if (typeof options?.isRead === "boolean") {
    where.isRead = options.isRead;
  }

  if (options?.severity) {
    where.severity = options.severity;
  }

  if (options?.from || options?.to) {
    where.createdAt = {
      gte: options.from,
      lte: options.to,
    };
  }

  return prisma.alert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: normalizeListLimit(options?.limit),
    skip: options?.offset,
  });
}

export async function listUnreadAlertsByUserId(userId: string): Promise<Alert[]> {
  return prisma.alert.findMany({
    where: {
      userId,
      isRead: false,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function markAlertAsRead(id: string): Promise<Alert> {
  return prisma.alert.update({
    where: { id },
    data: { isRead: true },
  });
}

export async function markAllAlertsAsRead(
  userId: string,
): Promise<Prisma.BatchPayload> {
  return prisma.alert.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });
}

export async function deleteAlert(id: string): Promise<Alert> {
  return prisma.alert.delete({ where: { id } });
}
