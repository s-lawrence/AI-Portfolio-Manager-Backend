import { describe, expect, it } from "vitest";

import { isDemoAnalyticsSeedingEnabled } from "../../src/services/demo-seed-policy.service";

describe("demo-seed-policy.service", () => {
  it("defaults to false when env var is missing", () => {
    expect(isDemoAnalyticsSeedingEnabled(undefined)).toBe(false);
  });

  it("returns false for non-true values", () => {
    expect(isDemoAnalyticsSeedingEnabled("false")).toBe(false);
    expect(isDemoAnalyticsSeedingEnabled("0")).toBe(false);
    expect(isDemoAnalyticsSeedingEnabled("yes")).toBe(false);
  });

  it("returns true only for true", () => {
    expect(isDemoAnalyticsSeedingEnabled("true")).toBe(true);
    expect(isDemoAnalyticsSeedingEnabled(" TRUE ")).toBe(true);
  });
});
