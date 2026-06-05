import { HoldingStatus, Portfolio, Prisma } from "@prisma/client";

import { getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import {
  createPortfolio,
  deletePortfolio,
  getPortfolioById,
  listPortfoliosByUserId,
  updatePortfolio,
} from "../repositories/portfolios.repository";
import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import { getLatestMarketSnapshotForStock } from "../repositories/price-snapshots.repository";
import { getUserById } from "../repositories/users.repository";
import {
  convertAmountWithRate,
  convertMoneyToCad,
  type ConvertMoneyToCadResult,
} from "./fx-rates.service";
import {
  PortfolioFxIssue,
  PortfolioOverview,
  PortfolioOverviewHoldingSummary,
  SectorCount,
} from "../types/services";

export type CreatePortfolioForUserInput = Pick<
  Prisma.PortfolioUncheckedCreateInput,
  "name" | "description" | "baseCurrency"
>;

export type UpdatePortfolioDetailsInput = Prisma.PortfolioUpdateInput;

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function normalizeFiniteNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeBigIntForResponse(
  value: bigint | null | undefined,
): number | string | null {
  if (value == null) {
    return null;
  }

  const asNumber = Number(value);
  if (Number.isSafeInteger(asNumber)) {
    return asNumber;
  }

  return value.toString();
}

function normalizeCurrencyCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function calculateUnrealizedGainLossPercent(
  gain: number | null,
  costBasis: number | null,
): number | null {
  if (gain == null || costBasis == null || costBasis === 0) {
    return null;
  }

  return Number(((gain / costBasis) * 100).toFixed(2));
}

function convertNativeAmountToCad(
  amount: number | null,
  conversion: ConvertMoneyToCadResult,
): number | null {
  if (amount == null) {
    return null;
  }

  if (conversion.conversionStatus === "DIRECT_CAD") {
    return roundMoney(amount);
  }

  if (conversion.conversionStatus === "CONVERTED" && conversion.fxRate != null) {
    return roundMoney(convertAmountWithRate(amount, conversion.fxRate));
  }

  return null;
}

async function getCurrencyConversion(
  currency: string | null,
  usdCadCachedProbe: ConvertMoneyToCadResult | null,
): Promise<{ conversion: ConvertMoneyToCadResult; cachedUsdCadProbe: ConvertMoneyToCadResult | null }> {
  if (currency === "USD") {
    if (usdCadCachedProbe) {
      return {
        conversion: usdCadCachedProbe,
        cachedUsdCadProbe: usdCadCachedProbe,
      };
    }

    const conversion = await convertMoneyToCad({
      amount: 1,
      currency,
    });

    return {
      conversion,
      cachedUsdCadProbe: conversion,
    };
  }

  const conversion = await convertMoneyToCad({
    amount: 1,
    currency: currency ?? "",
  });

  return {
    conversion,
    cachedUsdCadProbe: usdCadCachedProbe,
  };
}

export async function createPortfolioForUser(
  userId: string,
  input: CreatePortfolioForUserInput,
): Promise<Portfolio> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  const normalizedName = assertNonBlank(input.name, "Portfolio name");

  const user = await getUserById(normalizedUserId);
  if (!user) {
    throw new Error("User not found.");
  }

  return createPortfolio({
    userId: normalizedUserId,
    name: normalizedName,
    description: input.description,
    baseCurrency: input.baseCurrency ?? "USD",
  });
}

/**
 * Returns portfolio holdings plus computed summary stats from stored data.
 */
export async function getPortfolioOverview(
  portfolioId: string,
): Promise<PortfolioOverview | null> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const portfolio = await getPortfolioWithHoldings(normalizedPortfolioId);

  if (!portfolio) {
    return null;
  }

  const holdingCount = portfolio.holdings.length;
  const ownedHoldingCount = portfolio.holdings.filter(
    (holding) => holding.status === HoldingStatus.OWNED,
  ).length;
  const watchlistHoldingCount = portfolio.holdings.filter(
    (holding) => holding.status === HoldingStatus.WATCHLIST,
  ).length;

  const latestPrices = await Promise.all(
    portfolio.holdings.map((holding) => getLatestMarketSnapshotForStock(holding.stockId)),
  );

  const latestReports = await Promise.all(
    portfolio.holdings.map((holding) => getLatestAIReportByStockId(holding.stockId)),
  );

  let usdCadCachedProbe: ConvertMoneyToCadResult | null = null;

  const holdings: PortfolioOverviewHoldingSummary[] = await Promise.all(
    portfolio.holdings.map(async (holding, index) => {
      const latestPriceSnapshot = latestPrices[index];
      const latestAIReport = latestReports[index];

      const latestPriceNative = normalizeFiniteNumber(latestPriceSnapshot?.price);
      const marketValueNative =
        holding.shares != null && latestPriceNative != null
          ? roundMoney(holding.shares * latestPriceNative)
          : null;
      const costBasisNative =
        holding.shares != null && holding.averageCost != null
          ? roundMoney(holding.shares * holding.averageCost)
          : null;
      const unrealizedGainLossNative =
        marketValueNative != null && costBasisNative != null
          ? roundMoney(marketValueNative - costBasisNative)
          : null;
      const unrealizedGainLossPercent = calculateUnrealizedGainLossPercent(
        unrealizedGainLossNative,
        costBasisNative,
      );

      const nativeCurrency = normalizeCurrencyCode(holding.stock.currency);
      const conversionResult = await getCurrencyConversion(nativeCurrency, usdCadCachedProbe);
      usdCadCachedProbe = conversionResult.cachedUsdCadProbe;

      const marketValueCad = convertNativeAmountToCad(
        marketValueNative,
        conversionResult.conversion,
      );
      const costBasisCad = convertNativeAmountToCad(costBasisNative, conversionResult.conversion);
      const unrealizedGainLossCad =
        marketValueCad != null && costBasisCad != null
          ? roundMoney(marketValueCad - costBasisCad)
          : null;

      return {
        ...holding,
        holdingId: holding.id,
        ticker: holding.stock.ticker,
        companyName: holding.stock.companyName ?? null,
        sector: holding.stock.sector ?? null,
        industry: holding.stock.industry ?? null,
        exchange: holding.stock.exchange ?? null,
        currency: nativeCurrency,
        nativeCurrency,
        latestPriceNative,
        marketValueNative,
        costBasisNative,
        unrealizedGainLossNative,
        unrealizedGainLossPercent,
        latestPrice: latestPriceNative,
        marketValue: marketValueNative,
        costBasis: costBasisNative,
        unrealizedGainLoss: unrealizedGainLossNative,
        cadFxRate: conversionResult.conversion.fxRate,
        cadFxRateSource: conversionResult.conversion.fxRateSource,
        cadFxRateCapturedAt: conversionResult.conversion.fxRateCapturedAt,
        marketValueCad,
        costBasisCad,
        unrealizedGainLossCad,
        conversionStatus: conversionResult.conversion.conversionStatus,
        latestPriceCapturedAt: latestPriceSnapshot?.capturedAt ?? null,
        dailyChangePercent: normalizeFiniteNumber(latestPriceSnapshot?.changePercent),
        previousClose: normalizeFiniteNumber(latestPriceSnapshot?.previousClose),
        volume: normalizeBigIntForResponse(latestPriceSnapshot?.volume),
        marketCap: normalizeBigIntForResponse(latestPriceSnapshot?.marketCap),
        latestRecommendation: latestAIReport?.recommendation ?? null,
        latestSentiment: latestAIReport?.sentiment ?? null,
        latestConfidenceScore: normalizeFiniteNumber(latestAIReport?.confidenceScore),
        latestRiskScore: normalizeFiniteNumber(latestAIReport?.riskScore),
        latestReportDate: latestAIReport?.reportDate ?? null,
      };
    }),
  );

  let estimatedMarketValue = 0;
  let marketValueAvailable = false;
  let totalMarketValueCad = 0;
  let totalMarketValueCadAvailable = false;
  let totalCostBasisCad = 0;
  let totalCostBasisCadAvailable = false;
  let totalMarketValueNativeSingleCurrency = 0;
  let totalMarketValueNativeSingleCurrencyAvailable = false;
  const ownedCurrencies = new Set<string>();
  const holdingsMissingFx: PortfolioFxIssue[] = [];
  const holdingsUnsupportedCurrency: PortfolioFxIssue[] = [];
  let fxRateUsed: PortfolioOverview["fxRateUsed"] = null;

  for (const holding of holdings) {
    if (holding.status !== HoldingStatus.OWNED) {
      continue;
    }

    if (holding.nativeCurrency) {
      ownedCurrencies.add(holding.nativeCurrency);
    }

    if (holding.marketValueNative != null) {
      marketValueAvailable = true;
      estimatedMarketValue += holding.marketValueNative;
      totalMarketValueNativeSingleCurrencyAvailable = true;
      totalMarketValueNativeSingleCurrency += holding.marketValueNative;
    }

    if (holding.marketValueCad != null) {
      totalMarketValueCadAvailable = true;
      totalMarketValueCad += holding.marketValueCad;
    }

    if (holding.costBasisCad != null) {
      totalCostBasisCadAvailable = true;
      totalCostBasisCad += holding.costBasisCad;
    }

    if (holding.conversionStatus === "MISSING_FX") {
      holdingsMissingFx.push({
        ticker: holding.ticker,
        currency: holding.nativeCurrency ?? null,
      });
    }

    if (holding.conversionStatus === "UNSUPPORTED_CURRENCY") {
      holdingsUnsupportedCurrency.push({
        ticker: holding.ticker,
        currency: holding.nativeCurrency ?? null,
      });
    }

    if (
      !fxRateUsed &&
      holding.conversionStatus === "CONVERTED" &&
      holding.cadFxRate != null
    ) {
      fxRateUsed = {
        pair: "USD/CAD",
        rate: holding.cadFxRate,
        source: holding.cadFxRateSource ?? null,
        capturedAt: holding.cadFxRateCapturedAt ?? null,
      };
    }
  }

  const hasSingleOwnedCurrency = ownedCurrencies.size === 1;
  const totalMarketValueNative =
    hasSingleOwnedCurrency && totalMarketValueNativeSingleCurrencyAvailable
      ? roundMoney(totalMarketValueNativeSingleCurrency)
      : null;

  const resolvedTotalMarketValueCad = totalMarketValueCadAvailable
    ? roundMoney(totalMarketValueCad)
    : null;
  const resolvedTotalCostBasisCad = totalCostBasisCadAvailable
    ? roundMoney(totalCostBasisCad)
    : null;
  const totalUnrealizedGainLossCad =
    resolvedTotalMarketValueCad != null && resolvedTotalCostBasisCad != null
      ? roundMoney(resolvedTotalMarketValueCad - resolvedTotalCostBasisCad)
      : null;
  const totalUnrealizedGainLossPercentCad = calculateUnrealizedGainLossPercent(
    totalUnrealizedGainLossCad,
    resolvedTotalCostBasisCad,
  );

  const sectorCounts = new Map<string, number>();
  for (const holding of portfolio.holdings) {
    const sector = holding.stock.sector?.trim();
    if (!sector) {
      continue;
    }

    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  }

  const topSectorsByCount: SectorCount[] = Array.from(sectorCounts.entries())
    .map(([sector, count]) => ({ sector, count }))
    .sort((left, right) => {
      if (right.count === left.count) {
        return left.sector.localeCompare(right.sector);
      }

      return right.count - left.count;
    })
    .slice(0, 5);

  return {
    portfolio,
    holdings,
    portfolioBaseCurrency: "CAD",
    holdingCount,
    ownedHoldingCount,
    watchlistHoldingCount,
    estimatedMarketValue: marketValueAvailable
      ? roundMoney(estimatedMarketValue)
      : null,
    totalMarketValueNative,
    totalMarketValueCad: resolvedTotalMarketValueCad,
    totalCostBasisCad: resolvedTotalCostBasisCad,
    totalUnrealizedGainLossCad,
    totalUnrealizedGainLossPercentCad,
    fxRateUsed,
    holdingsMissingFx,
    holdingsUnsupportedCurrency,
    topSectorsByCount,
  };
}

export async function listUserPortfolios(userId: string): Promise<Portfolio[]> {
  const normalizedUserId = assertNonBlank(userId, "userId");
  return listPortfoliosByUserId(normalizedUserId);
}

export async function updatePortfolioDetails(
  portfolioId: string,
  input: UpdatePortfolioDetailsInput,
): Promise<Portfolio> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");

  const existingPortfolio = await getPortfolioById(normalizedPortfolioId);
  if (!existingPortfolio) {
    throw new Error("Portfolio not found.");
  }

  let data = input;
  if (typeof input.name === "string") {
    data = {
      ...input,
      name: assertNonBlank(input.name, "Portfolio name"),
    };
  }

  return updatePortfolio(normalizedPortfolioId, data);
}

export async function deletePortfolioById(portfolioId: string): Promise<Portfolio> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");

  const existingPortfolio = await getPortfolioById(normalizedPortfolioId);
  if (!existingPortfolio) {
    throw new Error("Portfolio not found.");
  }

  return deletePortfolio(normalizedPortfolioId);
}

export { deletePortfolioById as deletePortfolio };
