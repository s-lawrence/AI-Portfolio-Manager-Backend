import { FmpClient } from "./fmp-client";
import { FmpAnalystProvider } from "./fmp-analyst.provider";
import { FmpEconomicsProvider } from "./fmp-economics.provider";
import { FmpEarningsProvider } from "./fmp-earnings.provider";
import { FmpFundamentalsProvider } from "./fmp-fundamentals.provider";
import { FmpMarketDataProvider } from "./fmp-market-data.provider";
import { FmpNewsProvider } from "./fmp-news.provider";
import { FmpProfileProvider } from "./fmp-profile.provider";

export * from "./fmp-client";
export * from "./fmp-analyst.provider";
export * from "./fmp-economics.provider";
export * from "./fmp-earnings.provider";
export * from "./fmp-fundamentals.provider";
export * from "./fmp-market-data.provider";
export * from "./fmp-news.provider";
export * from "./fmp-profile.provider";
export * from "./fmp.types";

export const fmpClient = new FmpClient();
export const fmpAnalystProvider = new FmpAnalystProvider(fmpClient);
export const fmpEconomicsProvider = new FmpEconomicsProvider(fmpClient);
export const fmpEarningsProvider = new FmpEarningsProvider(fmpClient);
export const fmpFundamentalsProvider = new FmpFundamentalsProvider(fmpClient);
export const fmpMarketDataProvider = new FmpMarketDataProvider(fmpClient);
export const fmpNewsProvider = new FmpNewsProvider(fmpClient);
export const fmpProfileProvider = new FmpProfileProvider(fmpClient);