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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  FMP_API_KEY: optionalSecretString,
  FMP_BASE_URL: optionalUrlWithDefault("https://financialmodelingprep.com/stable"),
  FRED_API_KEY: optionalSecretString,
  FRED_BASE_URL: optionalUrlWithDefault("https://api.stlouisfed.org/fred"),
  BANK_OF_CANADA_BASE_URL: optionalUrlWithDefault("https://www.bankofcanada.ca/valet"),
  GDELT_BASE_URL: optionalUrlWithDefault("https://api.gdeltproject.org/api/v2"),
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
