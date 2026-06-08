import { env } from "../config/env";
import { ProviderConfigurationError } from "./errors";

export * from "./errors";
export * from "./types";
export * from "./fmp";
export * from "./fred";
export * from "./bank-of-canada";
export * from "./gdelt";

export interface ProviderRuntimeConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string;
}

export interface ProvidersRuntimeConfig {
  fmp: ProviderRuntimeConfig;
  fred: ProviderRuntimeConfig;
  bankOfCanada: ProviderRuntimeConfig;
  gdelt: ProviderRuntimeConfig;
}

export const providersConfig: ProvidersRuntimeConfig = {
  fmp: {
    provider: "Financial Modeling Prep",
    baseUrl: env.FMP_BASE_URL,
    apiKey: env.FMP_API_KEY,
  },
  fred: {
    provider: "FRED",
    baseUrl: env.FRED_BASE_URL,
    apiKey: env.FRED_API_KEY,
  },
  bankOfCanada: {
    provider: "Bank of Canada Valet",
    baseUrl: env.BANK_OF_CANADA_BASE_URL,
  },
  gdelt: {
    provider: "GDELT 2.0",
    baseUrl: env.GDELT_BASE_URL,
  },
};

export function requireProviderApiKey(
  providerConfig: ProviderRuntimeConfig,
  endpoint?: string,
): string {
  const apiKey = providerConfig.apiKey?.trim();

  if (!apiKey) {
    throw new ProviderConfigurationError(
      providerConfig.provider,
      `${providerConfig.provider} API key is not configured.`,
      { endpoint },
    );
  }

  return apiKey;
}