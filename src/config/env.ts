import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalSecretString = z.preprocess(
  blankToUndefined,
  z.string().min(1).optional(),
);

function optionalUrlWithDefault(defaultUrl: string) {
  return z.preprocess(blankToUndefined, z.string().url().default(defaultUrl));
}

const booleanFlag = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  FMP_API_KEY: optionalSecretString,
  FMP_BASE_URL: optionalUrlWithDefault("https://financialmodelingprep.com/stable"),
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  FRED_API_KEY: optionalSecretString,
  FRED_BASE_URL: optionalUrlWithDefault("https://api.stlouisfed.org/fred"),
  BANK_OF_CANADA_BASE_URL: optionalUrlWithDefault("https://www.bankofcanada.ca/valet"),
  BANK_OF_CANADA_USD_CAD_SERIES_ID: z.string().trim().min(1).default("FXUSDCAD"),
  GDELT_BASE_URL: optionalUrlWithDefault("https://api.gdeltproject.org/api/v2"),
  GDELT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  GDELT_QUERY_DELAY_MS: z.coerce.number().int().min(0).default(250),
  GDELT_MAX_RETRY_429: z.coerce.number().int().min(0).max(5).default(1),
  PRINT_ROUTES_ON_STARTUP: booleanFlag.default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsed.data;

export type Env = typeof env;
