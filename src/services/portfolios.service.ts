import { HoldingStatus, Portfolio, Prisma } from "@prisma/client";

import { getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import {
  createPortfolio,
  deletePortfolio,
  getPortfolioById,
  listPortfoliosByUserId,
  updatePortfolio,
} from "../repositories/portfolios.repository";
import { getLatestPriceSnapshot } from "../repositories/price-snapshots.repository";
import { getUserById } from "../repositories/users.repository";
import { PortfolioOverview, SectorCount } from "../types/services";

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

  let estimatedMarketValue = 0;
  let marketValueAvailable = false;

  for (let index = 0; index < portfolio.holdings.length; index += 1) {
    const holding = portfolio.holdings[index];
    const latestPrice = latestPrices[index];

    if (holding.shares != null && latestPrice?.price != null) {
      marketValueAvailable = true;
      estimatedMarketValue += holding.shares * latestPrice.price;
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
    holdings: portfolio.holdings,
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
