# Backend Context (Latest v6)

## Handoff Snapshot

Date:
- 2026-06-03

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and remote state:
- Branch: main
- HEAD: b5eeb14
- Remote: origin/main at b5eeb14
- Working tree: clean

Recent commits:
- b5eeb14 feat: add dev demo market data seeding endpoint
- ea76e25 feat: add dev context and portfolio analysis orchestration
- 2a54b29 feat: initialize backend foundation with services, tests, and API layer

## Scope

Current backend stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Fastify
- Zod
- dotenv
- Vitest

Still intentionally out of scope:
- Frontend code
- Authentication and authorization
- External market/news/AI providers
- OpenAI or other external model calls

## Milestone Status (Completed)

1. Database foundation
- Prisma schema and initial migration are stable.
- Seed script is idempotent and creates demo baseline data.

2. Typed repository layer
- Repository coverage exists for all current models.
- Shared normalization and list utilities are in place.

3. Service layer
- Services are structured with repository composition and deterministic local logic.

4. Automated testing foundation
- Vitest setup with deterministic cleanup and reusable factories is in place.

5. Fastify API layer
- Route groups, schema validation, and centralized error/response envelopes are implemented.

6. Development helper context endpoint
- GET /api/dev/demo-context exists and is non-production only.

7. Portfolio analysis orchestration
- POST /api/portfolios/:portfolioId/run-analysis exists and is fully tested.

8. Development demo data seeding endpoint
- POST /api/dev/seed-demo-market-data exists and is non-production only.
- Optional run-analysis trigger supported.

## New Work Added Today

### A) Demo Market Data Seeding Service

File:
- src/services/demo-data.service.ts

Export:
- seedDemoMarketData(options?: { runAnalysis?: boolean })

Behavior:
- Loads demo user (demo@example.com) and Demo Portfolio.
- Returns not found style errors if demo user/portfolio context is missing.
- Seeds data for all holdings in Demo Portfolio (not hardcoded only to specific tickers).
- Uses deterministic generation logic (seeded math), not uncontrolled randomness.

Seeded data per holding ticker:
1. Price snapshots
- At least 60 daily snapshots.
- Fields seeded: price, open, high, low, close, previousClose, volume, marketCap, changePercent, capturedAt.
- Ticker profiles include realistic ranges for AAPL, MSFT, NVDA and deterministic fallback profiles for others.

2. Technical snapshot
- After prices are present, calculates technical input via existing technical-analysis service.
- Records latest technical snapshot if not already present at that capturedAt.

3. Fundamental snapshots
- Creates one current and one previous (30 days earlier) snapshot when missing.
- Includes: marketCap, peRatio, forwardPeRatio, pegRatio, priceToSales, priceToBook, evToEbitda, eps, revenueGrowth, grossMargin, operatingMargin, netMargin, debtToEquity, currentRatio, freeCashFlow, dividendYield.
- Source is marked as local demo fake data.

4. News articles
- Creates deterministic fake local demo articles per ticker.
- Marked clearly as demo fake data via source and demo.local URLs.
- Includes sentiment, sentimentScore, materialityScore, and relevance explanation.

5. Earnings event
- Creates one upcoming event if none exists.
- If an upcoming event exists, updates it instead of creating duplicates.

6. Optional analysis
- If runAnalysis=true, calls runPortfolioAnalysis(demoPortfolioId).
- Returns analysis object in endpoint response.

Idempotency notes:
- Price/technical/fundamental snapshots are skip-safe by capturedAt checks and unique handling.
- News uses stable URLs and upsert behavior.
- Earnings uses update-or-create for upcoming event.

### B) Dev Route Integration

File:
- src/api/routes/dev.routes.ts

Added endpoint:
- POST /api/dev/seed-demo-market-data

Input handling:
- Accepts runAnalysis from query and/or request body.
- Defaults to false when omitted.

Production behavior:
- Unavailable when NODE_ENV=production because dev routes are only registered in non-production.

### C) Service Exports and Shared Types

Files:
- src/services/index.ts
- src/types/services.ts

Added shared types:
- SeedDemoMarketDataOptions
- SeedDemoMarketDataResult

### D) API Response Serialization Hardening

File:
- src/api/response.ts

Change:
- Added recursive JSON-safe conversion helper used by ok/created/paginated.
- BigInt values are converted before response serialization.

Why this matters:
- Prevents 500 errors when returning data that includes BigInt fields from Prisma (for example marketCap, volume, freeCashFlow, estimatedRevenue).

### E) Tests Added

File:
- tests/integration/api-dev-seed-demo-market-data.integration.test.ts

Coverage:
- Returns success envelope in development.
- Seeds price/news/fundamental/earnings data successfully.
- runAnalysis=true returns analysis and predictions.
- Endpoint unavailable in production.

### F) API Docs Updated

File:
- docs/api.md

Added docs for:
- POST /api/dev/seed-demo-market-data
- POST /api/dev/seed-demo-market-data?runAnalysis=true

## Current API Notes

Success envelope:
- { "success": true, "data": ... }

Error envelope:
- { "success": false, "error": { "code": "...", "message": "...", "details": ... } }

Paginated shape:
- data.items
- data.meta

## Validation Status (Latest Known-Good)

All passed after the new demo seeding feature:
- npm run typecheck
- npm test
  - 15 test files passing
  - 57 tests passing
- npm run build

## Local Runtime and Infrastructure Notes

Docker DB persistence:
- Container: ai-portfolio-db
- Mount target: /var/lib/postgresql/data
- Named volume in use: ai_portfolio_db_data
- Data persistence is configured via named Docker volume.

Dev server note:
- npm run dev currently fails when port 4000 is already in use (EADDRINUSE).
- This is an environment/runtime conflict, not a compile/test failure.

## Files Most Relevant Tomorrow

Core feature files:
- src/services/demo-data.service.ts
- src/api/routes/dev.routes.ts
- src/types/services.ts
- src/services/index.ts
- src/api/response.ts

Tests and docs:
- tests/integration/api-dev-seed-demo-market-data.integration.test.ts
- docs/api.md

## Tomorrow Resume Checklist

1. Start or verify Postgres container
- Confirm ai-portfolio-db is running and mapped to 5432.

2. Start backend
- Run npm run dev.
- If EADDRINUSE on 4000, free port 4000 or use an alternate port in env config.

3. Ensure demo baseline exists
- Run npm run prisma:seed if demo@example.com or Demo Portfolio is missing.

4. Seed demo analytics data
- POST /api/dev/seed-demo-market-data
- Optional: POST /api/dev/seed-demo-market-data?runAnalysis=true

5. Frontend verification targets
- Ticker pages should now have market history, technical/fundamental snapshots, news, and upcoming earnings.
- Portfolio analysis pages should populate after runAnalysis=true.

## Suggested Next Backend Priorities

- Add auth and authorization middleware.
- Add OpenAPI/Swagger generation from Zod schemas.
- Add CI checks for typecheck, tests, and build.
- Optionally add targeted unit tests for demo-data.service generation helpers.
