import { Prisma } from "@prisma/client";

import {
  TEST_EMAIL_MARKER,
  TEST_TEXT_MARKER,
  TEST_TICKER_PREFIXES,
  testPrisma,
} from "./test-db";

function buildTickerOrFilter(): Prisma.StockWhereInput[] {
  return TEST_TICKER_PREFIXES.map((prefix) => ({
    ticker: {
      startsWith: prefix,
    },
  }));
}

async function findTestIds() {
  const testStocks = await testPrisma.stock.findMany({
    where: {
      OR: buildTickerOrFilter(),
    },
    select: { id: true },
  });

  const testUsers = await testPrisma.user.findMany({
    where: {
      email: {
        contains: TEST_EMAIL_MARKER,
      },
    },
    select: { id: true },
  });

  const stockIds = testStocks.map((item) => item.id);
  const userIds = testUsers.map((item) => item.id);

  const testPortfolios = await testPrisma.portfolio.findMany({
    where: {
      OR: [
        {
          userId: {
            in: userIds,
          },
        },
        {
          name: {
            contains: TEST_TEXT_MARKER,
          },
        },
      ],
    },
    select: { id: true },
  });

  const portfolioIds = testPortfolios.map((item) => item.id);

  const testHoldings = await testPrisma.holding.findMany({
    where: {
      OR: [
        {
          portfolioId: {
            in: portfolioIds,
          },
        },
        {
          stockId: {
            in: stockIds,
          },
        },
      ],
    },
    select: { id: true },
  });

  const holdingIds = testHoldings.map((item) => item.id);

  const testReports = await testPrisma.aIReport.findMany({
    where: {
      OR: [
        {
          stockId: {
            in: stockIds,
          },
        },
        {
          holdingId: {
            in: holdingIds,
          },
        },
        {
          keyTakeaway: {
            contains: "Deterministic mock",
            mode: "insensitive",
          },
        },
      ],
    },
    select: { id: true },
  });

  const reportIds = testReports.map((item) => item.id);

  const testPredictions = await testPrisma.prediction.findMany({
    where: {
      OR: [
        {
          stockId: {
            in: stockIds,
          },
        },
        {
          holdingId: {
            in: holdingIds,
          },
        },
        {
          aiReportId: {
            in: reportIds,
          },
        },
      ],
    },
    select: { id: true },
  });

  const predictionIds = testPredictions.map((item) => item.id);

  return {
    stockIds,
    userIds,
    portfolioIds,
    holdingIds,
    reportIds,
    predictionIds,
  };
}

/**
 * Deletes likely test-created data in dependency-safe order without dropping schema/migrations.
 */
export async function cleanupTestData(): Promise<void> {
  const ids = await findTestIds();

  await testPrisma.predictionOutcome.deleteMany({
    where: {
      predictionId: {
        in: ids.predictionIds,
      },
    },
  });

  await testPrisma.prediction.deleteMany({
    where: {
      id: {
        in: ids.predictionIds,
      },
    },
  });

  await testPrisma.aIReport.deleteMany({
    where: {
      id: {
        in: ids.reportIds,
      },
    },
  });

  await testPrisma.newsArticle.deleteMany({
    where: {
      OR: [
        {
          stockId: {
            in: ids.stockIds,
          },
        },
        {
          headline: {
            contains: TEST_TEXT_MARKER,
          },
        },
      ],
    },
  });

  await testPrisma.technicalSnapshot.deleteMany({
    where: {
      stockId: {
        in: ids.stockIds,
      },
    },
  });

  await testPrisma.fundamentalSnapshot.deleteMany({
    where: {
      stockId: {
        in: ids.stockIds,
      },
    },
  });

  await testPrisma.priceSnapshot.deleteMany({
    where: {
      stockId: {
        in: ids.stockIds,
      },
    },
  });

  await testPrisma.earningsEvent.deleteMany({
    where: {
      stockId: {
        in: ids.stockIds,
      },
    },
  });

  await testPrisma.macroSeriesObservation.deleteMany({
    where: {
      OR: [
        {
          provider: {
            in: ["FMP", "FRED", "BANK_OF_CANADA"],
          },
        },
        {
          name: {
            contains: TEST_TEXT_MARKER,
          },
        },
      ],
    },
  });

  await testPrisma.macroEvent.deleteMany({
    where: {
      OR: [
        {
          provider: {
            in: ["FMP", "FRED", "BANK_OF_CANADA"],
          },
        },
        {
          title: {
            contains: TEST_TEXT_MARKER,
          },
        },
      ],
    },
  });

  await testPrisma.fxRateSnapshot.deleteMany({
    where: {
      OR: [
        {
          source: {
            contains: "Bank of Canada",
            mode: "insensitive",
          },
        },
        {
          source: {
            contains: TEST_TEXT_MARKER,
          },
        },
      ],
    },
  });

  await testPrisma.alert.deleteMany({
    where: {
      OR: [
        {
          userId: {
            in: ids.userIds,
          },
        },
        {
          stockId: {
            in: ids.stockIds,
          },
        },
        {
          title: {
            contains: TEST_TEXT_MARKER,
          },
        },
      ],
    },
  });

  await testPrisma.holding.deleteMany({
    where: {
      OR: [
        {
          id: {
            in: ids.holdingIds,
          },
        },
        {
          portfolioId: {
            in: ids.portfolioIds,
          },
        },
        {
          stockId: {
            in: ids.stockIds,
          },
        },
      ],
    },
  });

  await testPrisma.portfolioSummary.deleteMany({
    where: {
      portfolioId: {
        in: ids.portfolioIds,
      },
    },
  });

  await testPrisma.portfolio.deleteMany({
    where: {
      id: {
        in: ids.portfolioIds,
      },
    },
  });

  await testPrisma.userPreference.deleteMany({
    where: {
      userId: {
        in: ids.userIds,
      },
    },
  });

  await testPrisma.user.deleteMany({
    where: {
      id: {
        in: ids.userIds,
      },
    },
  });

  await testPrisma.stock.deleteMany({
    where: {
      id: {
        in: ids.stockIds,
      },
    },
  });

  await testPrisma.dataIngestionLog.deleteMany({
    where: {
      OR: [
        {
          jobName: {
            contains: TEST_TEXT_MARKER,
          },
        },
        ...TEST_TICKER_PREFIXES.map((prefix) => ({
          ticker: {
            startsWith: prefix,
          },
        })),
      ],
    },
  });
}
