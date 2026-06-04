# Backend Context (Latest v12)

## Handoff Snapshot

Date:
- 2026-06-04

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (multiple backend improvements in progress; this file captures the historical upsert unique-constraint fix milestone)

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
- External LLM integration
- Heuristic retuning
- Schema modifications for this fix path

## Incident Summary

Primary failure observed during full refresh market-data ingestion:
- Prisma error on historical ingestion update path:
  - Invalid prisma.priceSnapshot.update()
  - Unique constraint failed on fields: (stockId, capturedAt)

Affected tickers in runtime flow:
- AAPL
- MSFT
- NVDA

Context of failure:
- Historical ingestion was recently changed from skip-only behavior to upsert/update behavior.
- Existing same-day legacy rows (null or demo source patterns) and mixed capturedAt conventions existed in local data.
- Upsert logic attempted to update one same-day row and mutate capturedAt to canonical day timestamp.
- If another row already occupied canonical capturedAt for that stock/day, update collided with unique(stockId, capturedAt).

## Root Cause

Technical root cause in previous implementation:
- Same-day candidate selection was broad and source-prioritized.
- Selected candidate row could have non-canonical capturedAt.
- Update operation set capturedAt to incoming/canonical day timestamp.
- Canonical timestamp was already taken by another row in some legacy states.
- Result: update on row id A to capturedAt currently owned by row id B violated unique constraint.

Why this appeared after upsert change:
- Skip-only mode never rewrote capturedAt on existing records.
- Update mode introduced capturedAt mutation on existing rows, exposing collision risk.

## Fix Strategy

Key design principle implemented:
- Never mutate capturedAt on arbitrary same-day rows.
- Treat canonical row identity as stockId + canonical UTC day timestamp.

Canonical behavior:
1. Compute canonical capturedAt for market day as UTC start-of-day.
2. If row exists exactly at canonical capturedAt, update only that row.
3. If canonical row does not exist, create canonical row.
4. If create races/collides on unique constraint, re-query canonical row and update it.
5. Do not convert quote rows into historical rows.
6. Optional safe duplicate cleanup removes same-day null or DEMO rows only after canonical row is confirmed.

This removes the collision path without requiring schema changes.

## Detailed Implementation

### 1) Repository: Safe UTC-day lookup and canonical lookup

Updated file:
- src/repositories/price-snapshots.repository.ts

Added:
- findPriceSnapshotsForStockOnUtcDay(stockId, date)
  - Uses UTC day bounds: capturedAt >= dayStart and capturedAt < nextDay
  - Returns deterministically sorted rows using source priority + createdAt + capturedAt
- findPriceSnapshotByStockIdAndCapturedAt(stockId, capturedAt)
  - Exact canonical-row fetch helper

Kept existing latest selector behavior:
- Latest selector still prioritizes FMP_QUOTE over stale/demo/null rows.

### 2) Service: Collision-safe canonical historical upsert

Updated file:
- src/services/market-data.service.ts

Added:
- upsertHistoricalPriceSnapshotByMarketDate(stockId, marketDate, input, options)
- UpsertHistoricalPriceSnapshotForDayOptions with cleanupLegacyDuplicates flag

Updated behavior in upsertHistoricalPriceSnapshotForDay:
- Delegates to canonical-by-market-date helper.

Critical safety details:
- Canonical timestamp: startOfUtcDay(marketDate)
- Update path never sets capturedAt
- Create path sets capturedAt only on insert
- Handles Prisma P2002 by fetch-and-update canonical row
- Skips if canonical row is FMP_QUOTE and incoming row is FMP_HISTORICAL
- Preserves created/updated/skipped result contract

### 3) Ingestion path: enable safe duplicate cleanup

Updated file:
- src/services/real-data-ingestion.service.ts

Historical loop now calls upsert with:
- cleanupLegacyDuplicates: true

Counts retained and validated:
- historicalSnapshotsCreated
- historicalSnapshotsUpdated
- historicalSnapshotsSkipped

### 4) Technical inputs: dedupe by market date and source-priority preference

Updated file:
- src/services/technical-analysis.service.ts

Added:
- UTC day dedupe for price snapshots before indicator calculation
- Per-day row selection preference favoring canonical FMP_HISTORICAL rows
- Source-priority tie-breaks for deterministic day selection

Selection tiers for indicator inputs:
1. FMP_HISTORICAL-only rows when sufficient history exists
2. FMP rows (historical + quote) when sufficient
3. Full deduped set fallback

Result:
- Same-date duplicates no longer distort technical series.
- FMP_HISTORICAL wins against DEMO/null for same day.

### 5) Dev cleanup enhancement for legacy null-source rows

Updated file:
- src/services/demo-data.service.ts

allowLegacyDemoPurge behavior improved:
- Deletes null-source same-day rows when same-date FMP_HISTORICAL exists
- Does not delete FMP_QUOTE or FMP_HISTORICAL rows

### 6) Additional runtime correctness fix discovered during manual validation

Issue found:
- Latest technical snapshot in research bundle could still show stale values if an older snapshot had later capturedAt (for example demo rows captured at 20:00) than a freshly computed snapshot captured earlier that day.

Fix:
- Updated getLatestTechnicalSnapshot ordering to prefer createdAt desc, then capturedAt desc.

Updated file:
- src/repositories/technical-snapshots.repository.ts

Outcome:
- Most recently computed technical snapshot now wins, avoiding stale future-in-day capturedAt shadowing.

## Files Changed For This Fix Milestone

Core code:
- src/repositories/price-snapshots.repository.ts
- src/services/market-data.service.ts
- src/services/real-data-ingestion.service.ts
- src/services/technical-analysis.service.ts
- src/services/demo-data.service.ts
- src/repositories/technical-snapshots.repository.ts

Tests:
- tests/unit/market-data.service.test.ts
- tests/unit/technical-analysis.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts
- tests/unit/demo-data.service.test.ts

## Test Coverage Added/Updated

1. Historical upsert updates canonical row when canonical exists.
2. Historical upsert creates canonical row when only same-day legacy row exists.
3. Historical upsert updates canonical when canonical and legacy rows both exist.
4. Same-day quote row is not converted into historical row.
5. Technical loader dedupes same-day rows and prefers FMP_HISTORICAL.
6. Full refresh succeeds with legacy same-day duplicates present.
7. allowLegacyDemoPurge removes safe legacy null rows and preserves FMP rows.
8. Latest selector behavior still prefers FMP_QUOTE.

## Validation Status

Completed after final code state:
- npm run typecheck: passed
- npm test: passed
  - 31 test files
  - 179 tests
- npm run build: passed

## Manual API Validation (Requested Runtime Flow)

1) Purge with legacy cleanup enabled:
- Endpoint:
  - POST /api/dev/purge-demo-analytical-data/portfolio/<PORTFOLIO_ID>
- Payload:
  - allowLegacyDemoPurge=true
- Observed:
  - success=true
  - legacy/demo analytical rows removed safely

2) Full refresh run:
- Endpoint:
  - POST /api/ingestion/fmp/portfolio/<PORTFOLIO_ID>/full-refresh
- Payload:
  - historicalLimit=250
  - includeEconomics=true
  - runAnalysis=true
- Observed:
  - marketData.tickersFailed=0
  - No unique constraint failures
  - Historical rows updated/skipped as expected by idempotent rules

3) AAPL research bundle check:
- Endpoint:
  - GET /api/stocks/AAPL/research-bundle
- Observed:
  - latestPriceSnapshot.source = FMP_QUOTE
  - latestFundamentalSnapshot.source = FMP
  - latestTechnicalSnapshot reflects refreshed scale, not stale 210/221-only range

Observed sample post-fix technical values:
- SMA50: 278.9522
- SMA200: 264.40775
- 52-week high: 316.94
- 52-week low: 199.26

4) Latest AAPL report check:
- Endpoint:
  - GET /api/reports/AAPL/latest
- Observed technicalSummary references current trend and moving-average positioning aligned with refreshed technical snapshot.

## Behavioral Guarantees Now In Place

- Historical upsert no longer mutates capturedAt on arbitrary rows.
- Unique(stockId, capturedAt) collisions are safely avoided in upsert path.
- Canonical daily historical row identity is stable and deterministic.
- Quote rows are not accidentally transformed into historical rows.
- Same-day duplicate contamination is reduced via dedupe and optional cleanup.
- Technical calculations consume deduped, source-prioritized daily series.
- Most recently created technical snapshot is selected for latest views.

## Known Limitations

- Existing non-canonical legacy rows can still exist if cleanup is not requested.
- historicalSnapshotsSkipped remains expected on idempotent reruns when incoming payload matches existing canonical row.
- No schema changes were introduced by design for this fix path.

## Resume Checklist

1. Ensure local Postgres is running.
2. Run npm run typecheck.
3. Run npm test.
4. Run npm run build.
5. For runtime verification:
- POST /api/dev/purge-demo-analytical-data/portfolio/<PORTFOLIO_ID> with allowLegacyDemoPurge=true
- POST /api/ingestion/fmp/portfolio/<PORTFOLIO_ID>/full-refresh with historicalLimit=250 includeEconomics=true runAnalysis=true
- GET /api/stocks/AAPL/research-bundle
- GET /api/reports/AAPL/latest
