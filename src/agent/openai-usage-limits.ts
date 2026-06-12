import { env } from "../config/env";

export type OpenAiUsageLimitReason = "DAILY_USER_LIMIT" | "MONTHLY_GLOBAL_LIMIT";

export interface OpenAiUsageAllowance {
  allowed: boolean;
  reason?: OpenAiUsageLimitReason;
  limit?: number;
  used?: number;
}

const userDailyUsageCounts = new Map<string, number>();
const globalMonthlyUsageCounts = new Map<string, number>();

function toDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function toMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeUserId(userId: string | undefined): string {
  const trimmed = userId?.trim();
  if (!trimmed) {
    return "anonymous";
  }

  return trimmed.toLowerCase();
}

export function hasOpenAiUsageLimitsConfigured(): boolean {
  return Boolean(
    env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER || env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL,
  );
}

export function checkOpenAiUsageAllowance(input: {
  userId?: string;
  now?: Date;
}): OpenAiUsageAllowance {
  const now = input.now ?? new Date();
  const normalizedUserId = normalizeUserId(input.userId);

  const dailyLimit = env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER;
  if (dailyLimit) {
    const dayKey = `${toDayKey(now)}:${normalizedUserId}`;
    const used = userDailyUsageCounts.get(dayKey) ?? 0;
    if (used >= dailyLimit) {
      return {
        allowed: false,
        reason: "DAILY_USER_LIMIT",
        limit: dailyLimit,
        used,
      };
    }
  }

  const monthlyLimit = env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL;
  if (monthlyLimit) {
    const monthKey = toMonthKey(now);
    const used = globalMonthlyUsageCounts.get(monthKey) ?? 0;
    if (used >= monthlyLimit) {
      return {
        allowed: false,
        reason: "MONTHLY_GLOBAL_LIMIT",
        limit: monthlyLimit,
        used,
      };
    }
  }

  return {
    allowed: true,
  };
}

export function recordOpenAiUsage(input: {
  userId?: string;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  const normalizedUserId = normalizeUserId(input.userId);

  if (env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER) {
    const dayKey = `${toDayKey(now)}:${normalizedUserId}`;
    const used = userDailyUsageCounts.get(dayKey) ?? 0;
    userDailyUsageCounts.set(dayKey, used + 1);
  }

  if (env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL) {
    const monthKey = toMonthKey(now);
    const used = globalMonthlyUsageCounts.get(monthKey) ?? 0;
    globalMonthlyUsageCounts.set(monthKey, used + 1);
  }
}

export function resetOpenAiUsageLimitsForTests(): void {
  if (env.NODE_ENV !== "test") {
    return;
  }

  userDailyUsageCounts.clear();
  globalMonthlyUsageCounts.clear();
}
