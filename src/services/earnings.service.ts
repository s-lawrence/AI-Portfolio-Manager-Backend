import { EarningsEvent, Prisma } from "@prisma/client";

import {
  createEarningsEvent,
  getEarningsEventById,
  getNextEarningsEvent,
  updateEarningsEvent as updateEarningsEventRepository,
} from "../repositories/earnings-events.repository";
import { getPortfolioWithHoldings } from "../repositories/portfolios.repository";
import { normalizeTickerOrThrow } from "../types/common";
import { ensureStockExists, getStockProfile } from "./stocks.service";

export type RecordEarningsEventInput = Omit<
  Prisma.EarningsEventUncheckedCreateInput,
  "id" | "stockId" | "createdAt" | "updatedAt"
>;

export type UpdateEarningsEventInput = Prisma.EarningsEventUpdateInput;

export interface UpcomingPortfolioEarning {
  stockId: string;
  ticker: string;
  event: EarningsEvent;
}

function assertNonBlank(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

export async function recordEarningsEvent(
  ticker: string,
  input: RecordEarningsEventInput,
): Promise<EarningsEvent> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await ensureStockExists(normalizedTicker);

  return createEarningsEvent({
    ...input,
    stockId: stock.id,
  });
}

export async function updateEarningsEvent(
  eventId: string,
  input: UpdateEarningsEventInput,
): Promise<EarningsEvent> {
  const normalizedEventId = assertNonBlank(eventId, "eventId");
  const existing = await getEarningsEventById(normalizedEventId);

  if (!existing) {
    throw new Error("Earnings event not found.");
  }

  return updateEarningsEventRepository(normalizedEventId, input);
}

export async function getNextEarningsForTicker(
  ticker: string,
): Promise<EarningsEvent | null> {
  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const stock = await getStockProfile(normalizedTicker);

  if (!stock) {
    return null;
  }

  return getNextEarningsEvent(stock.id);
}

export async function listUpcomingPortfolioEarnings(
  portfolioId: string,
): Promise<UpcomingPortfolioEarning[]> {
  const normalizedPortfolioId = assertNonBlank(portfolioId, "portfolioId");
  const portfolio = await getPortfolioWithHoldings(normalizedPortfolioId);

  if (!portfolio) {
    throw new Error("Portfolio not found.");
  }

  const uniqueStocks = new Map<string, string>();
  for (const holding of portfolio.holdings) {
    uniqueStocks.set(holding.stockId, holding.stock.ticker);
  }

  const upcomingEvents = await Promise.all(
    Array.from(uniqueStocks.entries()).map(async ([stockId, tickerCode]) => {
      const event = await getNextEarningsEvent(stockId);
      if (!event) {
        return null;
      }

      return {
        stockId,
        ticker: tickerCode,
        event,
      } satisfies UpcomingPortfolioEarning;
    }),
  );

  return upcomingEvents
    .filter((entry): entry is UpcomingPortfolioEarning => entry != null)
    .sort((left, right) => {
      const leftTime = left.event.earningsDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.event.earningsDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });
}
