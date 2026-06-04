import { Holding, HoldingStatus, Prisma, Stock } from "@prisma/client";

import {
  createHolding,
  deleteHolding,
  getHoldingById,
  getHoldingByPortfolioAndStock,
  getHoldingWithStock,
  updateHolding,
} from "../repositories/holdings.repository";
import { listNewsByStockId } from "../repositories/news-articles.repository";
import { getPortfolioById, getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import { getLatestMarketSnapshotForStock } from "../repositories/price-snapshots.repository";
import { getLatestTechnicalSnapshot } from "../repositories/technical-snapshots.repository";
import { getLatestFundamentalSnapshot } from "../repositories/fundamental-snapshots.repository";
import { getLatestAIReportByStockId } from "../repositories/ai-reports.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { HoldingOverview } from "../types/services";
import { ensureStockExists } from "./stocks.service";

export type AddTickerToPortfolioInput = Omit<
  Prisma.HoldingUncheckedCreateInput,
  "id" | "portfolioId" | "stockId" | "status" | "createdAt" | "updatedAt"
> & {
  status?: HoldingStatus;
};

export type UpdateHoldingDetailsInput = Prisma.HoldingUpdateInput;

type HoldingWithStock = Holding & { stock: Stock };

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
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

  return {
    holding,
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
