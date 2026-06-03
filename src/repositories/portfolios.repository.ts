import { Portfolio, Prisma } from "@prisma/client";

import { prisma } from "../db/prisma";

export type PortfolioWithHoldings = Prisma.PortfolioGetPayload<{
  include: {
    holdings: {
      include: {
        stock: true;
      };
    };
  };
}>;

export async function getPortfolioById(id: string): Promise<Portfolio | null> {
  return prisma.portfolio.findUnique({ where: { id } });
}

export async function listPortfoliosByUserId(userId: string): Promise<Portfolio[]> {
  return prisma.portfolio.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createPortfolio(
  input: Prisma.PortfolioUncheckedCreateInput,
): Promise<Portfolio> {
  return prisma.portfolio.create({ data: input });
}

export async function updatePortfolio(
  id: string,
  input: Prisma.PortfolioUpdateInput,
): Promise<Portfolio> {
  return prisma.portfolio.update({
    where: { id },
    data: input,
  });
}

export async function deletePortfolio(id: string): Promise<Portfolio> {
  return prisma.portfolio.delete({ where: { id } });
}

export async function getPortfolioWithHoldings(
  id: string,
): Promise<PortfolioWithHoldings | null> {
  return prisma.portfolio.findUnique({
    where: { id },
    include: {
      holdings: {
        include: {
          stock: true,
        },
      },
    },
  });
}
