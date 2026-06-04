# Backend Context (Latest v9)

## Handoff Snapshot

Date:
- 2026-06-03

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- HEAD baseline in this session: 933b6bd
- Working tree: dirty (multiple milestone updates present and not yet committed)

## Scope

Current backend stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Fastify
- Zod
- Vitest

Still intentionally out of scope:
- Frontend implementation
- AuthN/AuthZ
- External LLM calls for report generation

## Milestone Summary (Completed)

1. Foundation milestones
- Prisma schema + migrations stable.
- Repository/service/API architecture stable.
- Demo context + demo market-data seeding endpoints available.

2. Real FMP ingestion coverage
- Market-data ingestion complete.
- Fundamentals ingestion complete.
- Earnings ingestion complete.
- News ingestion complete.

3. One-button full refresh orchestration
- Added combined endpoint:
  - POST /api/ingestion/fmp/portfolio/:portfolioId/full-refresh
- Orchestration order:
  - market-data -> fundamentals -> earnings -> news -> optional analysis
- Partial ticker failures are preserved per category and do not block subsequent categories.

4. Report/prediction idempotency and payload completeness
- Same-day report upsert behavior preserved.
- Same-day open prediction reuse/update behavior preserved.
- Prediction payloads include ticker metadata and computed dueDate.

5. Response quality polish (latest pass)
- Report API responses now include flattened stock metadata.
- Fundamentals percent-like values are normalized to decimal fractions.
- Upcoming earnings responses and research bundle avoid blank placeholder rows.

## Full Refresh Endpoint (Current Behavior)

Endpoint:
- POST /api/ingestion/fmp/portfolio/:portfolioId/full-refresh

Request body:
- historicalLimit?: number
- newsLimitPerTicker?: number
- runAnalysis?: boolean

Response shape:
- portfolioId
- startedAt
- finishedAt
- marketData
- fundamentals
- earnings
- news
- analysis? (only when runAnalysis=true)
- warnings: string[]

Per-category shape (marketData, fundamentals, earnings, news):
- tickersProcessed
- tickersFailed
- results
- failedTickers

Implementation files:
- src/services/real-data-ingestion.service.ts
- src/types/services.ts
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

## Report DTO Metadata Enhancements

Report endpoints:
- GET /api/reports/:ticker/latest
- GET /api/reports/:ticker

Returned report items now include flattened stock metadata:
- ticker
- companyName
- exchange
- currency
- sector
- industry

Implementation files:
- src/services/ai-reports.service.ts
- src/types/services.ts

## Fundamentals Normalization Convention

Internal storage convention:
- Plain numeric ratios remain plain values:
  - peRatio, forwardPeRatio, priceToSales, priceToBook, debtToEquity, currentRatio, evToEbitda
- Percent-like values are stored as decimal fractions:
  - revenueGrowth
  - grossMargin
  - operatingMargin
  - netMargin
  - dividendYield

Normalization helper:
- normalizePercentLike(value): number | null

Behavior:
- If provider returns 5.4 for 5.4%, stored as 0.054.
- If provider returns 0.054 for 5.4%, stored as 0.054.
- No double division.

Implementation file:
- src/providers/fmp/fmp-fundamentals.provider.ts

## Earnings Data Quality Improvements

Research bundle endpoint:
- GET /api/stocks/:ticker/research-bundle
- nextEarningsEvent is returned only when useful event data exists.

Portfolio upcoming earnings endpoint:
- GET /api/earnings/portfolio/:portfolioId/upcoming
- Excludes blank/placeholder rows.
- Returns [] when no useful upcoming events exist.

Implementation files:
- src/services/stocks.service.ts
- src/services/earnings.service.ts

## Tests Added/Updated In This Pass

New tests:
- tests/integration/api-reports.integration.test.ts
  - ticker filtering and report metadata assertions
- tests/unit/earnings.service.test.ts
  - upcoming earnings placeholder exclusion and empty behavior

Updated tests:
- tests/integration/api-ingestion.integration.test.ts
  - full-refresh response section assertions
  - repeated full-refresh idempotent report-count behavior
- tests/unit/fmp-fundamentals-provider.test.ts
  - percent normalization helper and mapping behavior
- tests/integration/api-dev-seed-demo-market-data.integration.test.ts
  - stronger research-bundle next-earnings assertions

## Documentation Updated

Updated files:
- docs/api.md
- docs/providers.md

Docs now include:
- full-refresh response structure
- report response stock metadata fields
- fundamentals percent-like normalization convention
- upcoming earnings empty/placeholder behavior

## Validation Status (Latest Known-Good)

Verified successfully after this latest polish milestone:
- npm run typecheck
- npm test
  - 27 test files passed
  - 127 tests passed
- npm run build

## Runtime Notes

- npm run dev can fail with EADDRINUSE when port 4000 is occupied.
- This is an environment port conflict, not a compile/test failure.

## Most Relevant Files Next Session

Core orchestration and DTOs:
- src/services/real-data-ingestion.service.ts
- src/types/services.ts
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

Report metadata shaping:
- src/services/ai-reports.service.ts

Fundamentals normalization:
- src/providers/fmp/fmp-fundamentals.provider.ts

Earnings quality filtering:
- src/services/earnings.service.ts
- src/services/stocks.service.ts

Tests:
- tests/integration/api-ingestion.integration.test.ts
- tests/integration/api-reports.integration.test.ts
- tests/unit/fmp-fundamentals-provider.test.ts
- tests/unit/earnings.service.test.ts

Docs:
- docs/api.md
- docs/providers.md

## Resume Checklist

1. Ensure local Postgres is up.
2. Run npm run typecheck.
3. Run npm test.
4. Run npm run build.
5. Validate endpoints manually:
- POST /api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/full-refresh
- GET /api/reports/AAPL/latest
- GET /api/reports/AAPL
- GET /api/stocks/AAPL/research-bundle
- GET /api/earnings/portfolio/<PORTFOLIO_CUID>/upcoming
