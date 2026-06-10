import { describe, expect, it } from "vitest";

import { seedDatabase } from "../../prisma/seed";
import { testPrisma } from "../../src/test/test-db";

describe("prisma seed idempotency", () => {
  it("does not duplicate default demo watchlists across repeated seed runs", async () => {
    process.env.SEED_DEMO_ANALYTICS = "false";

    await seedDatabase(testPrisma);
    await seedDatabase(testPrisma);

    const demoUser = await testPrisma.user.findUnique({
      where: { email: "demo@example.com" },
      select: { id: true },
    });

    expect(demoUser).not.toBeNull();

    const watchlists = await testPrisma.watchlist.findMany({
      where: {
        userId: demoUser!.id,
      },
      include: {
        items: {
          include: {
            stock: true,
          },
        },
      },
    });

    const defaultWatchlists = watchlists.filter((watchlist) => watchlist.isDefault === true);
    expect(defaultWatchlists).toHaveLength(1);

    const demoWatchlist = watchlists.find((watchlist) => watchlist.name === "Demo Watchlist");
    expect(demoWatchlist).toBeDefined();
    expect(demoWatchlist?.isDefault).toBe(true);

    const tickers = (demoWatchlist?.items ?? [])
      .map((item) => item.stock.ticker)
      .sort();

    expect(tickers).toEqual(["AAPL", "MSFT", "NVDA"]);
  });
});
