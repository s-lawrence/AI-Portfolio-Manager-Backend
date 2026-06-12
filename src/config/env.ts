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

const optionalNonEmptyString = z.preprocess(
  blankToUndefined,
  z.string().trim().min(1).optional(),
);

function optionalUrlWithDefault(defaultUrl: string) {
  return z.preprocess(blankToUndefined, z.string().url().default(defaultUrl));
}

const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());

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
  APP_BASE_URL: optionalUrl,
  BACKEND_BASE_URL: optionalUrl,
  FRONTEND_BASE_URL: z.string().url().default("http://localhost:3000"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  CORS_ALLOWED_ORIGINS: optionalNonEmptyString,
  AUTH_ENABLED: booleanFlag.default(false),
  AUTH_SESSION_SECRET: optionalSecretString,
  AUTH_COOKIE_SECURE: booleanFlag.optional(),
  AUTH_COOKIE_SAME_SITE: z
    .preprocess(blankToUndefined, z.enum(["strict", "lax", "none"]).optional()),
  GOOGLE_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_CLIENT_SECRET: optionalSecretString,
  GOOGLE_REDIRECT_URI: z.preprocess(blankToUndefined, z.string().url().optional()),
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
  OPENAI_API_KEY: optionalSecretString,
  OPENAI_AGENT_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  OPENAI_AGENT_MODEL_FALLBACK: optionalNonEmptyString,
  OPENAI_REPORT_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  OPENAI_DEEP_RESEARCH_MODEL: z.string().trim().min(1).default("gpt-5.5"),
  OPENAI_AGENT_ENABLE_ESCALATION: booleanFlag.default(false),
  OPENAI_AGENT_MAX_TOOL_CALLS: z.coerce.number().int().positive().max(20).default(5),
  OPENAI_AGENT_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().max(16384).optional(),
  OPENAI_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OPENAI_AGENT_PROVIDER_ENABLED: booleanFlag.default(false),
  OPENAI_DAILY_REQUEST_LIMIT_PER_USER: z.coerce.number().int().positive().optional(),
  OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL: z.coerce.number().int().positive().optional(),
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

if (!env.APP_BASE_URL && !env.BACKEND_BASE_URL) {
  env.APP_BASE_URL = "http://localhost:4000";
  env.BACKEND_BASE_URL = "http://localhost:4000";
} else if (!env.APP_BASE_URL && env.BACKEND_BASE_URL) {
  env.APP_BASE_URL = env.BACKEND_BASE_URL;
} else if (env.APP_BASE_URL && !env.BACKEND_BASE_URL) {
  env.BACKEND_BASE_URL = env.APP_BASE_URL;
}

export type Env = typeof env;
