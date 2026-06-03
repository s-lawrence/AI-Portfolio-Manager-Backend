import { HoldingStatus, PrismaClient, RiskLevel } from "@prisma/client";

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

async function upsertDemoPortfolio(userId: string) {
  const existing = await prisma.portfolio.findFirst({
    where: {
      userId,
      name: "Demo Portfolio",
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return prisma.portfolio.update({
      where: { id: existing.id },
      data: {
        description: "Starter portfolio used for local development and testing.",
        baseCurrency: "USD",
      },
    });
  }

  return prisma.portfolio.create({
    data: {
      userId,
      name: "Demo Portfolio",
      description: "Starter portfolio used for local development and testing.",
      baseCurrency: "USD",
    },
  });
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: { name: "Demo User" },
    create: {
      email: "demo@example.com",
      name: "Demo User",
    },
  });

  await prisma.userPreference.upsert({
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

  const portfolio = await upsertDemoPortfolio(user.id);

  for (const item of demoHoldings) {
    const stock = await prisma.stock.upsert({
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

    await prisma.holding.upsert({
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

  console.log("Database seeded successfully.");
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
