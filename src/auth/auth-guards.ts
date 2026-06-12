import type { FastifyRequest } from "fastify";

import { badRequest, forbidden, unauthorized } from "../api/errors";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { normalizeTickerOrThrow } from "../types/common";
import {
  type AuthSessionContext,
  getAuthSessionContextFromRequest,
} from "./auth.service";

type RequestWithAuthCache = FastifyRequest & {
  __authContextResolved?: boolean;
  __authContext?: AuthSessionContext | null;
};

async function resolveAuthContext(request: FastifyRequest): Promise<AuthSessionContext | null> {
  const requestWithCache = request as RequestWithAuthCache;

  if (requestWithCache.__authContextResolved === true) {
    return requestWithCache.__authContext ?? null;
  }

  const context = await getAuthSessionContextFromRequest(request);
  requestWithCache.__authContextResolved = true;
  requestWithCache.__authContext = context;

  return context;
}

export async function optionalAuth(request: FastifyRequest): Promise<AuthSessionContext | null> {
  if (!env.AUTH_ENABLED) {
    return null;
  }

  return resolveAuthContext(request);
}

export async function requireAuth(request: FastifyRequest): Promise<AuthSessionContext> {
  if (!env.AUTH_ENABLED) {
    throw unauthorized("Authentication is disabled for this environment.");
  }

  const context = await resolveAuthContext(request);

  if (!context) {
    throw unauthorized("Authentication required.");
  }

  return context;
}

export async function resolveUserIdForRequest(
  request: FastifyRequest,
  requestedUserId?: string,
): Promise<string> {
  if (!env.AUTH_ENABLED) {
    if (!requestedUserId || requestedUserId.trim().length === 0) {
      throw badRequest("userId is required.");
    }

    return requestedUserId;
  }

  const auth = await requireAuth(request);

  if (
    requestedUserId &&
    requestedUserId.trim().length > 0 &&
    requestedUserId !== auth.userId
  ) {
    throw forbidden("Requested userId does not match authenticated session.");
  }

  return auth.userId;
}

export async function assertPortfolioOwnership(
  request: FastifyRequest,
  portfolioId: string,
): Promise<void> {
  if (!env.AUTH_ENABLED) {
    return;
  }

  const auth = await requireAuth(request);
  const owned = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId: auth.userId,
    },
    select: { id: true },
  });

  if (!owned) {
    throw forbidden("Portfolio does not belong to the authenticated user.");
  }
}

export async function assertWatchlistOwnership(
  request: FastifyRequest,
  watchlistId: string,
): Promise<void> {
  if (!env.AUTH_ENABLED) {
    return;
  }

  const auth = await requireAuth(request);
  const owned = await prisma.watchlist.findFirst({
    where: {
      id: watchlistId,
      userId: auth.userId,
    },
    select: { id: true },
  });

  if (!owned) {
    throw forbidden("Watchlist does not belong to the authenticated user.");
  }
}

export async function assertHoldingOwnership(
  request: FastifyRequest,
  holdingId: string,
): Promise<void> {
  if (!env.AUTH_ENABLED) {
    return;
  }

  const auth = await requireAuth(request);
  const owned = await prisma.holding.findFirst({
    where: {
      id: holdingId,
      portfolio: {
        userId: auth.userId,
      },
    },
    select: { id: true },
  });

  if (!owned) {
    throw forbidden("Holding does not belong to the authenticated user.");
  }
}

export async function assertWatchlistItemOwnership(
  request: FastifyRequest,
  itemId: string,
): Promise<void> {
  if (!env.AUTH_ENABLED) {
    return;
  }

  const auth = await requireAuth(request);
  const owned = await prisma.watchlistItem.findFirst({
    where: {
      id: itemId,
      watchlist: {
        userId: auth.userId,
      },
    },
    select: { id: true },
  });

  if (!owned) {
    throw forbidden("Watchlist item does not belong to the authenticated user.");
  }
}

export async function assertReportTickerAccess(
  request: FastifyRequest,
  ticker: string,
  holdingId?: string,
): Promise<void> {
  if (!env.AUTH_ENABLED) {
    return;
  }

  const auth = await requireAuth(request);

  if (holdingId && holdingId.trim().length > 0) {
    const byHolding = await prisma.holding.findFirst({
      where: {
        id: holdingId,
        portfolio: {
          userId: auth.userId,
        },
      },
      select: {
        stock: {
          select: {
            ticker: true,
          },
        },
      },
    });

    if (!byHolding) {
      throw forbidden("Holding does not belong to the authenticated user.");
    }

    const normalizedTicker = normalizeTickerOrThrow(ticker);
    if (byHolding.stock.ticker !== normalizedTicker) {
      throw forbidden("Holding does not match requested ticker.");
    }

    return;
  }

  const normalizedTicker = normalizeTickerOrThrow(ticker);
  const hasTickerAccess = await prisma.holding.findFirst({
    where: {
      stock: {
        ticker: normalizedTicker,
      },
      portfolio: {
        userId: auth.userId,
      },
    },
    select: { id: true },
  });

  if (!hasTickerAccess) {
    throw forbidden(
      "Ticker report access requires an owned holding for the authenticated user.",
    );
  }
}

export async function enforceAgentContextOwnership(
  request: FastifyRequest,
  context: {
    userId?: string;
    portfolioId?: string;
    watchlistId?: string;
    ticker?: string;
  },
): Promise<{
  userId?: string;
  portfolioId?: string;
  watchlistId?: string;
  ticker?: string;
}> {
  if (!env.AUTH_ENABLED) {
    return context;
  }

  const auth = await requireAuth(request);

  if (
    context.userId &&
    context.userId.trim().length > 0 &&
    context.userId !== auth.userId
  ) {
    throw forbidden("Agent context userId does not match authenticated session.");
  }

  if (context.portfolioId) {
    await assertPortfolioOwnership(request, context.portfolioId);
  }

  if (context.watchlistId) {
    await assertWatchlistOwnership(request, context.watchlistId);
  }

  return {
    ...context,
    userId: auth.userId,
  };
}
