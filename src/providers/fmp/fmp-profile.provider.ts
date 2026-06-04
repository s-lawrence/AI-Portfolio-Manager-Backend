import {
  CompanyProfileProvider,
  ProviderCompanyProfile,
  normalizeProviderTickerOrThrow,
} from "../types";
import { FmpJsonClient, FmpClient } from "./fmp-client";
import { FmpProfileResponseItem } from "./fmp.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function isProfileLikeRecord(value: unknown): value is FmpProfileResponseItem {
  return isRecord(value) && (
    "symbol" in value ||
    "companyName" in value ||
    "exchange" in value ||
    "exchangeShortName" in value
  );
}

function extractProfileItem(response: unknown): FmpProfileResponseItem | null {
  if (Array.isArray(response)) {
    const first = response[0];
    return isProfileLikeRecord(first) ? first : null;
  }

  if (isProfileLikeRecord(response)) {
    return response;
  }

  if (isRecord(response) && Array.isArray(response.data)) {
    const first = response.data[0];
    return isProfileLikeRecord(first) ? first : null;
  }

  return null;
}

export class FmpProfileProvider implements CompanyProfileProvider {
  constructor(private readonly client: FmpJsonClient = new FmpClient()) {}

  async getCompanyProfile(ticker: string): Promise<ProviderCompanyProfile | null> {
    const normalizedTicker = normalizeProviderTickerOrThrow(ticker);
    const endpoint = "/profile";

    const response = await this.client.getJson<unknown>(endpoint, {
      symbol: normalizedTicker,
    });
    const item = extractProfileItem(response);

    if (!item) {
      return null;
    }

    const mappedTicker =
      toStringOrUndefined(item.symbol) ??
      normalizedTicker;

    return {
      ticker: normalizeProviderTickerOrThrow(mappedTicker),
      companyName: toStringOrUndefined(item.companyName),
      description: toStringOrUndefined(item.description),
      exchange:
        toStringOrUndefined(item.exchangeShortName) ?? toStringOrUndefined(item.exchange),
      sector: toStringOrUndefined(item.sector),
      industry: toStringOrUndefined(item.industry),
      country: toStringOrUndefined(item.country),
      currency: toStringOrUndefined(item.currency),
      assetType: toStringOrUndefined(item.type) ?? toStringOrUndefined(item.assetType),
      website: toStringOrUndefined(item.website),
      logoUrl: toStringOrUndefined(item.image),
      marketCap: toFiniteNumber(item.mktCap) ?? toFiniteNumber(item.marketCap),
    };
  }
}