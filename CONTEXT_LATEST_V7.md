# Backend Context (Latest v7)

## Handoff Snapshot

Date:
- 2026-06-03

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and remote state:
- Branch: main
- HEAD: b5eeb14
- Remote: origin/main at b5eeb14
- Working tree: dirty (uncommitted milestone changes present)

Current uncommitted change set (high level):
- Modified: .env.example, docs/api.md, src/config/env.ts, src/api/errors.ts, src/api/routes/index.ts, src/services/index.ts, src/types/services.ts
- Added: docs/providers.md
- Added: src/providers/fmp/* and provider foundation files
- Added: src/services/real-data-ingestion.service.ts
- Added: src/api/schemas/ingestion.schemas.ts, src/api/routes/ingestion.routes.ts
- Added tests: tests/unit/fmp-provider-mapping.test.ts, tests/unit/real-data-ingestion.service.test.ts, tests/integration/api-ingestion.integration.test.ts

Recent commits (unchanged from remote):
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
- OpenAI or other external model calls
- FRED, Bank of Canada Valet, and GDELT runtime integration (not implemented in this milestone)
- FMP fundamentals/news/earnings ingestion in this milestone

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

9. Provider foundation
- Provider-neutral interfaces/types exist.
- Provider error classes exist with safe secret redaction.
- Provider env support exists with optional keys and default base URLs.

10. FMP real ingestion milestone (this update)
- FMP provider integration for company profile, quote, and historical daily prices is implemented.
- Real ingestion service and API endpoints for ticker and portfolio market-data ingestion are implemented.
- Technical snapshot generation after ingestion is included.

## New Work Added Today (v7)

### A) FMP Provider Module

Created folder:
- src/providers/fmp/

Added files:
- src/providers/fmp/fmp-client.ts
- src/providers/fmp/fmp.types.ts
- src/providers/fmp/fmp-market-data.provider.ts
- src/providers/fmp/fmp-profile.provider.ts
- src/providers/fmp/index.ts

Behavior highlights:
- Uses native fetch.
- Reads FMP_API_KEY and FMP_BASE_URL from env config.
- Throws ProviderConfigurationError only when provider methods are invoked and key is missing.
- Builds URLs safely and appends apikey query param.
- Handles non-2xx with ProviderRequestError.
- Handles malformed JSON with ProviderResponseError.
- Does not log or expose API keys.

### B) Provider Contract Updates

File:
- src/providers/types.ts

Changes:
- ProviderCompanyProfile includes optional assetType.
- CompanyProfileProvider.getCompanyProfile now returns Promise<ProviderCompanyProfile | null>.

### C) FMP Market Data Provider Mapping

File:
- src/providers/fmp/fmp-market-data.provider.ts

Implemented:
- getQuote(ticker)
- getHistoricalDailyPrices(ticker, options?)

Behavior:
- Normalizes ticker to uppercase and preserves suffixes like .TO/.V.
- Maps FMP quote payload to ProviderQuote.
- Throws ProviderNotFoundError when quote array is empty.
- Validates required quote numeric price before returning.
- Maps historical daily rows to ProviderHistoricalPrice.
- Skips invalid historical rows instead of failing whole request.
- Sorts historical output ascending by date.
- If limit is provided, keeps most recent N and still returns ascending.

### D) FMP Profile Provider Mapping

File:
- src/providers/fmp/fmp-profile.provider.ts

Implemented:
- getCompanyProfile(ticker)

Behavior:
- Maps ticker, companyName, exchange, sector, industry, country, currency, assetType, marketCap.
- Returns null when no profile is found.

### E) Real Data Ingestion Service

File:
- src/services/real-data-ingestion.service.ts

Exports:
- ingestTickerMarketData(ticker, options?)
- ingestPortfolioMarketData(portfolioId, options?)

Ticker ingestion behavior:
1. Normalize ticker.
2. Fetch company profile from FMP.
3. Ensure stock exists and update metadata from profile if present.
4. Fetch latest quote from FMP.
5. Record latest PriceSnapshot (capturedAt=now).
6. Fetch historical daily prices from FMP.
7. Record historical PriceSnapshots with capturedAt from historical date.
8. Handle duplicate historical capturedAt (Prisma P2002) by skipping.
9. Calculate and record latest TechnicalSnapshot from stored price history.
10. Return result with:
- ticker
- profileUpdated
- quoteSnapshotCreated
- historicalSnapshotsCreated
- historicalSnapshotsSkipped
- technicalSnapshotCreated
- warnings[]

Portfolio ingestion behavior:
1. Load portfolio overview.
2. Iterate holding tickers.
3. Ingest each ticker independently.
4. Continue on per-ticker failures and collect reason.
5. Optionally call runPortfolioAnalysis when runAnalysis=true.
6. Return:
- portfolioId
- startedAt
- finishedAt
- tickersProcessed
- tickersFailed
- results[]
- failedTickers[]
- analysis (optional)

### F) Ingestion API Schemas and Routes

Added files:
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

Registered in:
- src/api/routes/index.ts

New endpoints:
- POST /api/ingestion/fmp/ticker/:ticker/market-data
  Body: { "historicalLimit": 250 }
- POST /api/ingestion/fmp/portfolio/:portfolioId/market-data
  Body: { "historicalLimit": 250, "runAnalysis": true }

Route behavior:
- Thin handlers (validation + service call + response envelope).
- Uses existing ok() response envelope and central error handler.

### G) API Error Mapping for Provider Errors

Updated file:
- src/api/errors.ts

Added mapping:
- ProviderConfigurationError -> BAD_REQUEST (400)
- ProviderNotFoundError -> NOT_FOUND (404)
- ProviderRateLimitError -> PROVIDER_RATE_LIMIT (429)
- ProviderRequestError -> PROVIDER_REQUEST_ERROR (502)
- ProviderResponseError -> PROVIDER_RESPONSE_ERROR (502)

### H) Service Types and Exports

Updated files:
- src/types/services.ts
- src/services/index.ts

Added types:
- IngestTickerMarketDataOptions
- IngestTickerMarketDataResult
- IngestPortfolioMarketDataOptions
- IngestPortfolioMarketDataResult
- IngestPortfolioTickerFailure

### I) Tests Added (No Real FMP Calls)

Added tests:
- tests/unit/fmp-provider-mapping.test.ts
- tests/unit/real-data-ingestion.service.test.ts
- tests/integration/api-ingestion.integration.test.ts

Coverage includes:
- Quote mapping to ProviderQuote.
- Profile mapping to ProviderCompanyProfile.
- Historical ascending sort and limit behavior.
- Ticker ingestion stock metadata update.
- Quote + historical snapshot creation.
- Technical snapshot creation after historical data exists.
- Portfolio ingestion continues when one ticker fails.
- API success envelope for ingestion endpoints.
- Clear missing FMP_API_KEY behavior when ingestion endpoint is called.

### J) Documentation Updates

Updated:
- docs/api.md

Added:
- docs/providers.md

docs/providers.md includes:
- FMP_API_KEY setup guidance.
- Supported FMP endpoints for this milestone.
- Canadian ticker examples:
  - RY.TO
  - TD.TO
  - ENB.TO
  - SHOP.TO
  - XEQT.TO
  - VFV.TO
- U.S. ticker examples:
  - AAPL
  - MSFT
  - NVDA
- Note that technical indicators are calculated internally from stored price history.

## Current API Notes

Success envelope:
- { "success": true, "data": ... }

Error envelope:
- { "success": false, "error": { "code": "...", "message": "...", "details": ... } }

Paginated shape:
- data.items
- data.meta

Route groups now include:
- /api/ingestion

## Validation Status (Latest Known-Good)

Validated after FMP ingestion milestone:
- npm run typecheck
- npm test
  - 20 test files passing
  - 72 tests passing
- npm run build

## Local Runtime and Infrastructure Notes

Docker/Postgres test dependency:
- Tests require Postgres reachable at localhost:5432.
- Docker container used locally: ai-portfolio-db.
- Start container before running npm test if database is down.

FMP runtime config:
- Server startup works without FMP_API_KEY.
- Ingestion calls return clear configuration error when key is missing.

Dev server note:
- npm run dev may fail if port 4000 is already in use (EADDRINUSE).

## Files Most Relevant Tomorrow

Core ingestion and provider files:
- src/providers/fmp/fmp-client.ts
- src/providers/fmp/fmp-market-data.provider.ts
- src/providers/fmp/fmp-profile.provider.ts
- src/services/real-data-ingestion.service.ts
- src/api/routes/ingestion.routes.ts
- src/api/schemas/ingestion.schemas.ts
- src/api/errors.ts

Supporting files:
- src/providers/types.ts
- src/types/services.ts
- src/services/index.ts
- src/api/routes/index.ts

Tests and docs:
- tests/unit/fmp-provider-mapping.test.ts
- tests/unit/real-data-ingestion.service.test.ts
- tests/integration/api-ingestion.integration.test.ts
- docs/api.md
- docs/providers.md

## Tomorrow Resume Checklist

1. Verify database is running
- Start/verify ai-portfolio-db so localhost:5432 is reachable.

2. Set local provider env
- Ensure FMP_API_KEY is set in local .env.

3. Start backend
- npm run dev

4. Validate ingestion endpoints manually
- POST /api/ingestion/fmp/ticker/:ticker/market-data
- POST /api/ingestion/fmp/portfolio/:portfolioId/market-data

5. Confirm downstream data effects
- Stock metadata updates
- New PriceSnapshot rows
- New TechnicalSnapshot row
- Optional portfolio run-analysis output when requested

## Suggested Next Backend Priorities

- Add ingestion log wrapping to real-data-ingestion.service.ts for operational observability.
- Implement FMP fundamentals/news/earnings ingestion (separate milestone).
- Add FRED, Bank of Canada Valet, and GDELT provider integrations.
- Add CI checks for typecheck, tests, and build.
- Add auth and authorization middleware (separate roadmap item).
