/*
  Warnings:

  - A unique constraint covering the columns `[provider,title,eventDate,country]` on the table `MacroEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MacroEvent" ADD COLUMN     "actual" DOUBLE PRECISION,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "estimate" DOUBLE PRECISION,
ADD COLUMN     "eventDate" TIMESTAMP(3),
ADD COLUMN     "eventType" TEXT,
ADD COLUMN     "importance" TEXT,
ADD COLUMN     "previous" DOUBLE PRECISION,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "unit" TEXT;

-- CreateTable
CREATE TABLE "MacroSeriesObservation" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "name" TEXT,
    "country" TEXT,
    "category" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MacroSeriesObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MacroSeriesObservation_provider_idx" ON "MacroSeriesObservation"("provider");

-- CreateIndex
CREATE INDEX "MacroSeriesObservation_seriesId_idx" ON "MacroSeriesObservation"("seriesId");

-- CreateIndex
CREATE INDEX "MacroSeriesObservation_country_idx" ON "MacroSeriesObservation"("country");

-- CreateIndex
CREATE INDEX "MacroSeriesObservation_category_idx" ON "MacroSeriesObservation"("category");

-- CreateIndex
CREATE INDEX "MacroSeriesObservation_observedAt_idx" ON "MacroSeriesObservation"("observedAt");

-- CreateIndex
CREATE INDEX "MacroSeriesObservation_provider_seriesId_observedAt_idx" ON "MacroSeriesObservation"("provider", "seriesId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MacroSeriesObservation_provider_seriesId_observedAt_key" ON "MacroSeriesObservation"("provider", "seriesId", "observedAt");

-- CreateIndex
CREATE INDEX "MacroEvent_provider_idx" ON "MacroEvent"("provider");

-- CreateIndex
CREATE INDEX "MacroEvent_country_idx" ON "MacroEvent"("country");

-- CreateIndex
CREATE INDEX "MacroEvent_category_idx" ON "MacroEvent"("category");

-- CreateIndex
CREATE INDEX "MacroEvent_eventDate_idx" ON "MacroEvent"("eventDate");

-- CreateIndex
CREATE INDEX "MacroEvent_provider_country_category_eventDate_idx" ON "MacroEvent"("provider", "country", "category", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "MacroEvent_provider_title_eventDate_country_key" ON "MacroEvent"("provider", "title", "eventDate", "country");
