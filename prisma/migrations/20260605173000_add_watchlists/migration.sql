-- CreateEnum
CREATE TYPE "WatchlistItemStatus" AS ENUM (
  'WATCHING',
  'RESEARCHING',
  'CANDIDATE',
  'REJECTED',
  'CONVERTED_TO_HOLDING',
  'ARCHIVED'
);

-- CreateEnum
CREATE TYPE "WatchlistItemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "WatchlistItemSource" AS ENUM ('USER', 'SCREENER', 'AGENT', 'REPORT');

-- CreateTable
CREATE TABLE "Watchlist" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
  "id" TEXT NOT NULL,
  "watchlistId" TEXT NOT NULL,
  "stockId" TEXT NOT NULL,
  "status" "WatchlistItemStatus" NOT NULL DEFAULT 'WATCHING',
  "priority" "WatchlistItemPriority" NOT NULL DEFAULT 'MEDIUM',
  "thesis" TEXT,
  "riskNotes" TEXT,
  "targetEntryPrice" DOUBLE PRECISION,
  "targetExitPrice" DOUBLE PRECISION,
  "targetAllocation" DOUBLE PRECISION,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source" "WatchlistItemSource" NOT NULL DEFAULT 'USER',
  "addedReason" TEXT,
  "rejectionReason" TEXT,
  "convertedHoldingId" TEXT,
  "lastReviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_name_key" ON "Watchlist"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_stockId_key" ON "WatchlistItem"("watchlistId", "stockId");

-- CreateIndex
CREATE INDEX "WatchlistItem_watchlistId_idx" ON "WatchlistItem"("watchlistId");

-- CreateIndex
CREATE INDEX "WatchlistItem_stockId_idx" ON "WatchlistItem"("stockId");

-- CreateIndex
CREATE INDEX "WatchlistItem_status_idx" ON "WatchlistItem"("status");

-- CreateIndex
CREATE INDEX "WatchlistItem_priority_idx" ON "WatchlistItem"("priority");

-- AddForeignKey
ALTER TABLE "Watchlist"
ADD CONSTRAINT "Watchlist_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem"
ADD CONSTRAINT "WatchlistItem_watchlistId_fkey"
FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem"
ADD CONSTRAINT "WatchlistItem_stockId_fkey"
FOREIGN KEY ("stockId") REFERENCES "Stock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem"
ADD CONSTRAINT "WatchlistItem_convertedHoldingId_fkey"
FOREIGN KEY ("convertedHoldingId") REFERENCES "Holding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
