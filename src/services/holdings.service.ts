import { Holding, HoldingStatus, Prisma, Stock } from "@prisma/client";

import {
  createHolding,
  deleteHolding,
  getHoldingById,
  getHoldingByPortfolioAndStock,
  getHoldingWithStock,
  updateHolding,
} from "../repositories/holdings.repository";
import { getStockById } from "../repositories/stocks.repository";
import { listNewsByStockId } from "../repositories/news-articles.repository";
import { getPortfolioById, getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import { getLatestMarketSnapshotForStock } from "../repositories/price-snapshots.repository";
import { getLatestTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { getLatestFundamentalSnapshot } from "../repositories/fundamental-snapshots.repository";
import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { HoldingOverview } from "../types/services";
import { convertAmountWithRate, convertMoneyToCad } from "./fx-rates.service";
import { ensureStockExists } from "./stocks.service";
import { ingestTickerFundamentals, ingestTickerMarketData } from "./real-data-ingestion.service";

export type AddTickerToPortfolioInput = Omit<
  Prisma.HoldingUncheckedCreateInput,
  "id" | "portfolioId" | "stockId" | "status" | "createdAt" | "updatedAt"
> & {
  status?: HoldingStatus;
};

export type UpdateHoldingDetailsInput = Prisma.HoldingUpdateInput;

export interface CorrectHoldingStockInput {
  stockId?: string;
  ticker?: string;
  companyName?: string;
  exchange?: string;
  currency?: string;
  country?: string;
  provider?: string;
  refreshAfterCorrection?: boolean;
}

export interface CorrectHoldingStockResult {
  holdingOverview: HoldingOverview;
  warnings: string[];
  refreshTriggered: boolean;
}

type HoldingWithStock = Holding & { stock: Stock };

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

export async function addTickerToPortfolio(
  portfolioId: string,
  ticker: string,
  input: AddTickerToPortfolioInput,
): Promise<HoldingWithStock> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const normalizedTicker = normalizeTickerOrThrow(ticker);

  const portfolio = await getPortfolioById(normalizedPortfolioId);
  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  const stock = await ensureStockExists(normalizedTicker);
  const existingHolding = await getHoldingByPortfolioAndStock(
    normalizedPortfolioId,
    stock.id,
  );

  if (existingHolding) {
    throw new Error("Holding already exists for this portfolio and ticker.");
  }

  const createdHolding = await createHolding({
    ...input,
    portfolioId: normalizedPortfolioId,
    stockId: stock.id,
    status: input.status ?? HoldingStatus.WATCHLIST,
  });

  const holdingWithStock = await getHoldingWithStock(createdHolding.id);
  if (!holdingWithStock) {
    throw new Error("Failed to load created holding.");
  }

  return holdingWithStock;
}

export async function removeHolding(holdingId: string): Promise<Holding> {
  const normalizedHoldingId = assertNonBlank(holdingId, "holdingId");
  const existingHolding = await getHoldingById(normalizedHoldingId);

  if (!existingHolding) {
    throw new Error("Holding not found.");
  }

  return deleteHolding(normalizedHoldingId);
}

export async function updateHoldingDetails(
  holdingId: string,
  input: UpdateHoldingDetailsInput,
): Promise<Holding> {
  const normalizedHoldingId = assertNonBlank(holdingId, "holdingId");
  const existingHolding = await getHoldingById(normalizedHoldingId);

  if (!existingHolding) {
    throw new Error("Holding not found.");
  }

  return updateHolding(normalizedHoldingId, input);
}

function normalizeOptionalMetadataValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalCurrency(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalMetadataValue(value);
  return normalized ? normalized.toUpperCase() : undefined;
}

async function resolveCorrectionTargetStock(
  input: CorrectHoldingStockInput,
): Promise<Stock> {
  if (input.stockId) {
    const stock = await getStockById(input.stockId);
    if (!stock) {
      throw new Error("Stock not found.");
    }

    return stock;
  }

  if (!input.ticker) {
    throw new Error("Either stockId or ticker is required.");
  }

  const normalizedTicker = normalizeTickerOrThrow(input.ticker);

  return ensureStockExists(normalizedTicker, {
    companyName: normalizeOptionalMetadataValue(input.companyName),
    exchange: normalizeOptionalMetadataValue(input.exchange),
    currency: normalizeOptionalCurrency(input.currency),
    country: normalizeOptionalCurrency(input.country),
  });
}

export async function correctHoldingStock(
  holdingId: string,
  input: CorrectHoldingStockInput,
): Promise<CorrectHoldingStockResult> {
  const normalizedHoldingId = assertNonBlank(holdingId, "holdingId");
  const existingHolding = await getHoldingById(normalizedHoldingId);

  if (!existingHolding) {
    throw new Error("Holding not found.");
  }

  const targetStock = await resolveCorrectionTargetStock(input);

  if (existingHolding.stockId !== targetStock.id) {
    const duplicateHolding = await getHoldingByPortfolioAndStock(
      existingHolding.portfolioId,
      targetStock.id,
    );

    if (duplicateHolding && duplicateHolding.id !== existingHolding.id) {
      throw new Error("Holding already exists for this portfolio and ticker.");
    }

    await updateHolding(normalizedHoldingId, {
      stock: {
        connect: {
          id: targetStock.id,
        },
      },
    });
  }

  const warnings: string[] = [
    `Security mapping was updated to ${targetStock.ticker}.`,
    "Market data should be refreshed for corrected ticker.",
  ];

  if (input.refreshAfterCorrection) {
    try {
      const [marketDataResult, fundamentalsResult] = await Promise.all([
        ingestTickerMarketData(targetStock.ticker, {
          historicalLimit: 30,
        }),
        ingestTickerFundamentals(targetStock.ticker),
      ]);

      warnings.push(...marketDataResult.warnings);
      warnings.push(...fundamentalsResult.warnings);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Ticker refresh failed.";
      warnings.push(`Post-correction refresh warning for ${targetStock.ticker}: ${reason}`);
    }
  }

  const holdingOverview = await getHoldingOverview(normalizedHoldingId);
  if (!holdingOverview) {
    throw new Error("Holding not found.");
  }

  return {
    holdingOverview,
    warnings,
    refreshTriggered: Boolean(input.refreshAfterCorrection),
  };
}

/**
 * Returns a consolidated view of a holding and its latest related analytics.
 */
export async function getHoldingOverview(
  holdingId: string,
): Promise<HoldingOverview | null> {
  const normalizedHoldingId = assertNonBlank(holdingId, "holdingId");
  const holding = await getHoldingWithStock(normalizedHoldingId);

  if (!holding) {
    return null;
  }

  const [
    latestPriceSnapshot,
    latestTechnicalSnapshot,
    latestFundamentalSnapshot,
    latestAIReport,
    recentNews,
  ] = await Promise.all([
    getLatestMarketSnapshotForStock(holding.stockId),
    getLatestTechnicalSnapshot(holding.stockId),
    getLatestFundamentalSnapshot(holding.stockId),
    getLatestAIReportByStockId(holding.stockId),
    listNewsByStockId(holding.stockId, 20),
  ]);

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
  const conversion = await convertMoneyToCad({
    amount: 1,
    currency: nativeCurrency ?? "",
  });

  const marketValueCad =
    marketValueNative != null
      ? conversion.conversionStatus === "DIRECT_CAD"
        ? roundMoney(marketValueNative)
        : conversion.conversionStatus === "CONVERTED" && conversion.fxRate != null
          ? roundMoney(convertAmountWithRate(marketValueNative, conversion.fxRate))
          : null
      : null;
  const costBasisCad =
    costBasisNative != null
      ? conversion.conversionStatus === "DIRECT_CAD"
        ? roundMoney(costBasisNative)
        : conversion.conversionStatus === "CONVERTED" && conversion.fxRate != null
          ? roundMoney(convertAmountWithRate(costBasisNative, conversion.fxRate))
          : null
      : null;
  const unrealizedGainLossCad =
    marketValueCad != null && costBasisCad != null
      ? roundMoney(marketValueCad - costBasisCad)
      : null;

  return {
    holding,
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
    cadFxRate: conversion.fxRate,
    cadFxRateSource: conversion.fxRateSource,
    cadFxRateCapturedAt: conversion.fxRateCapturedAt,
    marketValueCad,
    costBasisCad,
    unrealizedGainLossCad,
    conversionStatus: conversion.conversionStatus,
    latestPriceSnapshot,
    latestTechnicalSnapshot,
    latestFundamentalSnapshot,
    latestAIReport,
    recentNews,
  };
}

export async function listPortfolioHoldings(
  portfolioId: string,
): Promise<HoldingWithStock[]> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const portfolio = await getPortfolioWithHoldings(normalizedPortfolioId);

  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  return portfolio.holdings;
}
