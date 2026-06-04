export function isDemoAnalyticsSeedingEnabled(value: string | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}
