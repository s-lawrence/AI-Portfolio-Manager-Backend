import { PrismaClient } from "@prisma/client";

export const TEST_EMAIL_MARKER = "test+auto-";
export const TEST_TEXT_MARKER = "[TEST]";
export const TEST_TICKER_PREFIXES = ["TST", "QA", "MOCK"] as const;

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

if (!testDatabaseUrl) {
  throw new Error(
    "Missing test database URL. Set TEST_DATABASE_URL or DATABASE_URL before running tests.",
  );
}

// Ensure application code that reads DATABASE_URL uses the test target when TEST_DATABASE_URL is present.
process.env.DATABASE_URL = testDatabaseUrl;

declare global {
  // eslint-disable-next-line no-var
  var prismaTestGlobal: PrismaClient | undefined;
}

export const testPrisma =
  globalThis.prismaTestGlobal ??
  new PrismaClient({
    datasources: {
      db: {
        url: testDatabaseUrl,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaTestGlobal = testPrisma;
}

export async function verifyDatabaseConnection(): Promise<void> {
  await testPrisma.$queryRaw`SELECT 1`;
}

export async function resetTestData(): Promise<void> {
  const { cleanupTestData } = await import("./cleanup");
  await cleanupTestData();
}
