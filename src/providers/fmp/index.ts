import { FmpClient } from "./fmp-client";
import { FmpFundamentalsProvider } from "./fmp-fundamentals.provider";
import { FmpMarketDataProvider } from "./fmp-market-data.provider";
import { FmpProfileProvider } from "./fmp-profile.provider";

export * from "./fmp-client";
export * from "./fmp-fundamentals.provider";
export * from "./fmp-market-data.provider";
export * from "./fmp-profile.provider";
export * from "./fmp.types";

export const fmpClient = new FmpClient();
export const fmpFundamentalsProvider = new FmpFundamentalsProvider(fmpClient);
export const fmpMarketDataProvider = new FmpMarketDataProvider(fmpClient);
export const fmpProfileProvider = new FmpProfileProvider(fmpClient);