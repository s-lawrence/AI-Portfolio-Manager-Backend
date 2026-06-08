-- CreateTable
CREATE TABLE "GeopoliticalEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT,
    "sourceCountry" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "domain" TEXT,
    "language" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "query" TEXT,
    "theme" TEXT,
    "category" TEXT,
    "tone" DOUBLE PRECISION,
    "sentiment" TEXT,
    "relevanceScore" DOUBLE PRECISION,
    "countries" JSONB,
    "organizations" JSONB,
    "persons" JSONB,
    "locations" JSONB,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeopoliticalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeopoliticalEvent_url_key" ON "GeopoliticalEvent"("url");

-- CreateIndex
CREATE INDEX "GeopoliticalEvent_provider_idx" ON "GeopoliticalEvent"("provider");

-- CreateIndex
CREATE INDEX "GeopoliticalEvent_publishedAt_idx" ON "GeopoliticalEvent"("publishedAt");

-- CreateIndex
CREATE INDEX "GeopoliticalEvent_category_idx" ON "GeopoliticalEvent"("category");

-- CreateIndex
CREATE INDEX "GeopoliticalEvent_theme_idx" ON "GeopoliticalEvent"("theme");

-- CreateIndex
CREATE INDEX "GeopoliticalEvent_sentiment_idx" ON "GeopoliticalEvent"("sentiment");

-- CreateIndex
CREATE UNIQUE INDEX "GeopoliticalEvent_provider_title_publishedAt_key" ON "GeopoliticalEvent"("provider", "title", "publishedAt");
