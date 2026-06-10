import {
  HoldingStatus,
  PrismaClient,
  RiskLevel,
  WatchlistItemPriority,
  WatchlistItemSource,
  WatchlistItemStatus,
} from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDemoAnalyticsSeedingEnabled } from "../src/services/demo-seed-policy.service";

const prisma = new PrismaClient();

type DemoHolding = {
  ticker: string;
  companyName: string;
  exchange: string;
  sector: string;
  country: string;
  currency: string;
  shares: number;
  averageCost: number;
  thesis: string;
};

const demoHoldings: DemoHolding[] = [
  {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    exchange: "NASDAQ",
    sector: "Technology",
    country: "US",
    currency: "USD",
    shares: 25,
    averageCost: 182.5,
    thesis:
      "Durable ecosystem lock-in, recurring services growth, and strong free cash flow support long-term upside.",
  },
  {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    exchange: "NASDAQ",
    sector: "Technology",
    country: "US",
    currency: "USD",
    shares: 18,
    averageCost: 402.1,
    thesis:
      "Cloud leadership with Azure and enterprise AI monetization should continue compounding earnings quality.",
  },
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    exchange: "NASDAQ",
    sector: "Technology",
    country: "US",
    currency: "USD",
    shares: 12,
    averageCost: 965.0,
    thesis:
      "AI infrastructure demand and platform advantages in accelerated computing create a strong growth runway.",
  },
];

const DEMO_WATCHLIST_NAME = "Demo Watchlist";
const DEMO_WATCHLIST_DESCRIPTION = "Focused starter watchlist for local development and agent smoke checks.";
const DEMO_WATCHLIST_TICKERS = ["NVDA", "MSFT", "AAPL"] as const;

export async function upsertDefaultDemoWatchlist(prismaClient: PrismaClient, userId: string) {
  const byName = await prismaClient.watchlist.findFirst({
    where: {
      userId,
      name: DEMO_WATCHLIST_NAME,
    },
    select: {
      id: true,
    },
  });

  const existingDefault = byName
    ? null
    : await prismaClient.watchlist.findFirst({
      where: {
        userId,
        isDefault: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
      },
    });

  const targetWatchlistId = byName?.id ?? existingDefault?.id;

  const watchlist = targetWatchlistId
    ? await prismaClient.watchlist.update({
      where: { id: targetWatchlistId },
      data: {
        name: DEMO_WATCHLIST_NAME,
        description: DEMO_WATCHLIST_DESCRIPTION,
        isDefault: true,
      },
    })
    : await prismaClient.watchlist.create({
      data: {
        userId,
        name: DEMO_WATCHLIST_NAME,
        description: DEMO_WATCHLIST_DESCRIPTION,
        isDefault: true,
      },
    });

  await prismaClient.watchlist.updateMany({
    where: {
      userId,
      isDefault: true,
      NOT: {
        id: watchlist.id,
      },
    },
    data: {
      isDefault: false,
    },
  });

  return watchlist;
}

async function upsertDemoWatchlistItems(prismaClient: PrismaClient, watchlistId: string) {
  const stocks = await Promise.all(
    DEMO_WATCHLIST_TICKERS.map((ticker) =>
      prismaClient.stock.upsert({
        where: { ticker },
        update: {
          assetType: "EQUITY",
        },
        create: {
          ticker,
          companyName: null,
          assetType: "EQUITY",
        },
      }),
    ),
  );

  const allowedStockIds = new Set(stocks.map((stock) => stock.id));

  await Promise.all(
    stocks.map((stock) =>
      prismaClient.watchlistItem.upsert({
        where: {
          watchlistId_stockId: {
            watchlistId,
            stockId: stock.id,
          },
        },
        update: {
          status: WatchlistItemStatus.WATCHING,
          priority: WatchlistItemPriority.MEDIUM,
          source: WatchlistItemSource.USER,
          tags: [],
          rejectionReason: null,
        },
        create: {
          watchlistId,
          stockId: stock.id,
          status: WatchlistItemStatus.WATCHING,
          priority: WatchlistItemPriority.MEDIUM,
          source: WatchlistItemSource.USER,
          tags: [],
        },
      }),
    ),
  );

  await prismaClient.watchlistItem.deleteMany({
    where: {
      watchlistId,
      stockId: {
        notIn: [...allowedStockIds],
      },
    },
  });
}

async function upsertDemoPortfolio(prismaClient: PrismaClient, userId: string) {
  const existing = await prismaClient.portfolio.findFirst({
    where: {
      userId,
      name: "Demo Portfolio",
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return prismaClient.portfolio.update({
      where: { id: existing.id },
      data: {
        description: "Starter portfolio used for local development and testing.",
        baseCurrency: "USD",
      },
    });
  }

  return prismaClient.portfolio.create({
    data: {
      userId,
      name: "Demo Portfolio",
      description: "Starter portfolio used for local development and testing.",
      baseCurrency: "USD",
    },
  });
}

export async function seedDatabase(prismaClient: PrismaClient = prisma): Promise<void> {
  const user = await prismaClient.user.upsert({
    where: { email: "demo@example.com" },
    update: { name: "Demo User" },
    create: {
      email: "demo@example.com",
      name: "Demo User",
    },
  });

  await prismaClient.userPreference.upsert({
    where: { userId: user.id },
    update: {
      riskTolerance: RiskLevel.MEDIUM,
      preferredHoldingPeriod: "1-3 years",
      maxPositionPercent: 20,
      maxSectorPercent: 40,
      prefersDividends: false,
      prefersGrowth: true,
      prefersValue: false,
      notes: "Balanced growth-focused preference profile for demo purposes.",
    },
    create: {
      userId: user.id,
      riskTolerance: RiskLevel.MEDIUM,
      preferredHoldingPeriod: "1-3 years",
      maxPositionPercent: 20,
      maxSectorPercent: 40,
      prefersDividends: false,
      prefersGrowth: true,
      prefersValue: false,
      notes: "Balanced growth-focused preference profile for demo purposes.",
    },
  });

  const portfolio = await upsertDemoPortfolio(prismaClient, user.id);
  const demoWatchlist = await upsertDefaultDemoWatchlist(prismaClient, user.id);

  for (const item of demoHoldings) {
    const stock = await prismaClient.stock.upsert({
      where: { ticker: item.ticker },
      update: {
        companyName: item.companyName,
        exchange: item.exchange,
        sector: item.sector,
        country: item.country,
        currency: item.currency,
        assetType: "EQUITY",
      },
      create: {
        ticker: item.ticker,
        companyName: item.companyName,
        exchange: item.exchange,
        sector: item.sector,
        country: item.country,
        currency: item.currency,
        assetType: "EQUITY",
      },
    });

    await prismaClient.holding.upsert({
      where: {
        portfolioId_stockId: {
          portfolioId: portfolio.id,
          stockId: stock.id,
        },
      },
      update: {
        status: HoldingStatus.OWNED,
        shares: item.shares,
        averageCost: item.averageCost,
        thesis: item.thesis,
      },
      create: {
        portfolioId: portfolio.id,
        stockId: stock.id,
        status: HoldingStatus.OWNED,
        shares: item.shares,
        averageCost: item.averageCost,
        thesis: item.thesis,
      },
    });
  }

  await upsertDemoWatchlistItems(prismaClient, demoWatchlist.id);

  const shouldSeedDemoAnalytics = isDemoAnalyticsSeedingEnabled(
    process.env.SEED_DEMO_ANALYTICS,
  );

  if (shouldSeedDemoAnalytics) {
    const { seedDemoMarketData } = await import("../src/services/demo-data.service");
    await seedDemoMarketData({ runAnalysis: false });
    console.log("Demo analytical data seeded (SEED_DEMO_ANALYTICS=true).");
  } else {
    console.log("Skipped demo analytical data seeding (set SEED_DEMO_ANALYTICS=true to enable).");
  }

  console.log("Database seeded successfully.");
}

const isDirectExecution =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  seedDatabase()
    .catch((error: unknown) => {
      console.error("Database seed failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
