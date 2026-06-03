import { Alert, AlertSeverity, Recommendation } from "@prisma/client";

import {
  createAlert,
  deleteAlert,
  getAlertById,
  listAlertsByUserId,
  listUnreadAlertsByUserId,
  markAlertAsRead,
  markAllAlertsAsRead,
} from "../repositories/alerts.repository";
import { getStockById } from "../repositories/stocks.repository";
import { getUserById } from "../repositories/users.repository";
import {
  AlertCreationInput,
  AlertQueryOptions,
} from "../types/services";

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

export async function createUserAlert(input: AlertCreationInput): Promise<Alert> {
  const userId = assertNonBlank(input.userId, "userId");
  const title = assertNonBlank(input.title, "title");
  const message = assertNonBlank(input.message, "message");

  const user = await getUserById(userId);
  if (!user) {
    throw new Error("User not found.");
  }

  if (input.stockId) {
    const stock = await getStockById(input.stockId);
    if (!stock) {
      throw new Error("Stock not found.");
    }
  }

  return createAlert({
    userId,
    stockId: input.stockId,
    title,
    message,
    severity: input.severity ?? AlertSeverity.INFO,
    category: input.category ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
  });
}

export async function createRecommendationChangeAlert(
  userId: string,
  stockId: string,
  previousRecommendation: Recommendation,
  newRecommendation: Recommendation,
): Promise<Alert> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  const normalizedStockId = assertNonBlank(stockId, "stockId");

  const stock = await getStockById(normalizedStockId);
  if (!stock) {
    throw new Error("Stock not found.");
  }

  const isOppositeFlip =
    (previousRecommendation === Recommendation.BUY &&
      newRecommendation === Recommendation.SELL) ||
    (previousRecommendation === Recommendation.SELL &&
      newRecommendation === Recommendation.BUY);

  const severity = isOppositeFlip
    ? AlertSeverity.IMPORTANT
    : AlertSeverity.WATCH;

  const title = `Recommendation changed for ${stock.ticker}`;
  const message = `${stock.ticker} changed from ${previousRecommendation} to ${newRecommendation}.`;

  return createUserAlert({
    userId: normalizedUserId,
    stockId: normalizedStockId,
    title,
    message,
    severity,
    category: "RECOMMENDATION_CHANGE",
    sourceType: "AI_REPORT",
  });
}

export async function listUserAlerts(
  userId: string,
  options?: AlertQueryOptions,
): Promise<Alert[]> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  return listAlertsByUserId(normalizedUserId, options);
}

export async function listUnreadUserAlerts(userId: string): Promise<Alert[]> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  return listUnreadAlertsByUserId(normalizedUserId);
}

export async function markAlertRead(alertId: string): Promise<Alert> {
  const normalizedAlertId = assertNonBlank(alertId, "alertId");
  return markAlertAsRead(normalizedAlertId);
}

export async function markAllUserAlertsRead(
  userId: string,
): Promise<{ updatedCount: number }> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  const result = await markAllAlertsAsRead(normalizedUserId);

  return {
    updatedCount: result.count,
  };
}

export async function deleteUserAlert(alertId: string): Promise<Alert> {
  const normalizedAlertId = assertNonBlank(alertId, "alertId");
  const existing = await getAlertById(normalizedAlertId);

  if (!existing) {
    throw new Error("Alert not found.");
  }

  return deleteAlert(normalizedAlertId);
}
