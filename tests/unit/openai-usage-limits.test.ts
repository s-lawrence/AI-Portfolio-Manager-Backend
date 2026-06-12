import { afterEach, describe, expect, it } from "vitest";

import {
  checkOpenAiUsageAllowance,
  recordOpenAiUsage,
  resetOpenAiUsageLimitsForTests,
} from "../../src/agent/openai-usage-limits";
import { env } from "../../src/config/env";

describe("openai-usage-limits", () => {
  const originalDailyLimit = env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER;
  const originalMonthlyLimit = env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL;

  afterEach(() => {
    env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER = originalDailyLimit;
    env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL = originalMonthlyLimit;
    resetOpenAiUsageLimitsForTests();
  });

  it("allows requests when no usage limits are configured", () => {
    env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER = undefined;
    env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL = undefined;

    const allowance = checkOpenAiUsageAllowance({ userId: "user-1" });
    expect(allowance.allowed).toBe(true);
    expect(allowance.reason).toBeUndefined();
  });

  it("enforces daily per-user limit", () => {
    env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER = 1;
    env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL = undefined;

    const userId = "daily-limit-user";

    expect(checkOpenAiUsageAllowance({ userId }).allowed).toBe(true);
    recordOpenAiUsage({ userId });

    const allowanceAfterFirstCall = checkOpenAiUsageAllowance({ userId });
    expect(allowanceAfterFirstCall.allowed).toBe(false);
    expect(allowanceAfterFirstCall.reason).toBe("DAILY_USER_LIMIT");
  });

  it("enforces monthly global limit", () => {
    env.OPENAI_DAILY_REQUEST_LIMIT_PER_USER = undefined;
    env.OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL = 2;

    expect(checkOpenAiUsageAllowance({ userId: "user-a" }).allowed).toBe(true);
    recordOpenAiUsage({ userId: "user-a" });

    expect(checkOpenAiUsageAllowance({ userId: "user-b" }).allowed).toBe(true);
    recordOpenAiUsage({ userId: "user-b" });

    const allowanceAfterGlobalLimit = checkOpenAiUsageAllowance({ userId: "user-c" });
    expect(allowanceAfterGlobalLimit.allowed).toBe(false);
    expect(allowanceAfterGlobalLimit.reason).toBe("MONTHLY_GLOBAL_LIMIT");
  });
});
