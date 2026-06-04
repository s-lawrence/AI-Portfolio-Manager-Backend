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
import { getLatestPriceSnapshot } from "../repositories/price-snapshots.repository";
import { getUserById } from "../repositories/users.repository";
import {
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
    portfolio.holdings.map((holding) => getLatestPriceSnapshot(holding.stockId)),
  );

  const latestReports = await Promise.all(
    portfolio.holdings.map((holding) => getLatestAIReportByStockId(holding.stockId)),
  );

  const holdings: PortfolioOverviewHoldingSummary[] = portfolio.holdings.map(
    (holding, index) => {
      const latestPriceSnapshot = latestPrices[index];
      const latestAIReport = latestReports[index];

      return {
        ...holding,
        holdingId: holding.id,
        ticker: holding.stock.ticker,
        companyName: holding.stock.companyName ?? null,
        sector: holding.stock.sector ?? null,
        industry: holding.stock.industry ?? null,
        exchange: holding.stock.exchange ?? null,
        currency: holding.stock.currency ?? null,
        latestPrice: normalizeFiniteNumber(latestPriceSnapshot?.price),
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
    },
  );

  let estimatedMarketValue = 0;
  let marketValueAvailable = false;

  for (const holding of holdings) {
    const latestPrice = normalizeFiniteNumber(holding.latestPrice);

    if (
      holding.status === HoldingStatus.OWNED &&
      holding.shares != null &&
      latestPrice != null
    ) {
      marketValueAvailable = true;
      estimatedMarketValue += holding.shares * latestPrice;
    }
  }

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
    holdingCount,
    ownedHoldingCount,
    watchlistHoldingCount,
    estimatedMarketValue: marketValueAvailable
      ? Number(estimatedMarketValue.toFixed(2))
      : null,
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
