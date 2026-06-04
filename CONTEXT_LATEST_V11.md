# Backend Context (Latest v11)

## Handoff Snapshot

Date:
- 2026-06-04

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Last pushed commit baseline remains: 51bbd40
- Working tree: dirty (economics + report/volatility + latest-market-data correctness changes are implemented and validated locally, not yet committed)

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
- OpenAI/external LLM calls
- FRED/Bank of Canada/GDELT integration for this milestone

## Milestone Summary (New Since v10)

1. Critical latest market-data correctness fix (canonical selector)
- Added one canonical latest PriceSnapshot selector to prevent stale/wrong latest values across app surfaces.
- Selector priority is deterministic:
  - Newest capturedAt first.
  - If capturedAt ties, intraday timestamps are preferred over midnight-only records.
  - Remaining ties use newest createdAt, then stable id ordering.
- This removes inconsistent latest-value behavior between quote/historical coexistence and downstream consumers.

2. Cross-surface consumer unification
- Rewired all major latest-price consumers to use the same canonical selector:
  - Market data latest endpoint/service.
  - Stocks research bundle.
  - Portfolio overview holding summaries.
  - Holding overview.
  - AI report generation path.
- Result: latest market snapshot resolution now matches across market-data, research, portfolios, holdings, and reports.

3. Dev market-data audit endpoint added
- Added dev-only endpoint:
  - GET /api/dev/market-data-audit/<TICKER>
- Endpoint returns:
  - selectedLatestSnapshot (the canonical pick used by backend consumers)
  - latestByCapturedAt (top 10)
  - latestByCreatedAt (top 10)
  - optional fmpQuoteCheck with safe error summary (no API key exposure)
- Useful for diagnosing stale local snapshots, timestamp ordering conflicts, and provider/local divergence.

4. Market-data audit service support
- Added service-level market-data audit helper with serialization-safe output for bigint fields.
- Audit payload intentionally sets source to null because PriceSnapshot currently has no persisted source field.

5. Documentation updates for correctness behavior
- docs/api.md now documents:
  - /api/dev/market-data-audit/<TICKER>
  - Canonical latest snapshot selection behavior.
- docs/providers.md now documents:
  - Quote vs historical capturedAt conventions.
  - Canonical selector tie-breaking rules.
  - Current source-column limitation for safe automated purge logic.

## Canonical Latest Snapshot Behavior (Current)

Read behavior:
- Consumers use one shared selector from repository layer.

Ordering behavior:
1. capturedAt descending.
2. If same capturedAt: prefer intraday timestamp over midnight-only timestamp.
3. Then createdAt descending.
4. Then id tie-breaker for deterministic ordering.

Why this matters:
- Prevents stale historical EOD values from appearing as latest when quote-level intraday context should win.
- Eliminates cross-endpoint mismatches where one surface showed a different latest price than another.

## New/Updated Endpoint Notes

Development helper route (non-production only):
- GET /api/dev/market-data-audit/<TICKER>

Expected diagnostics in response:
- selectedLatestSnapshot
- latestByCapturedAt
- latestByCreatedAt
- fmpQuoteCheck

Availability:
- Development and test environments only.
- Not available in production (NODE_ENV=production).

## Key Files Added/Updated In This Milestone Delta

Updated core repository/service files:
- src/repositories/price-snapshots.repository.ts
- src/services/market-data.service.ts
- src/services/portfolios.service.ts
- src/services/stocks.service.ts
- src/services/holdings.service.ts
- src/services/ai-reports.service.ts
- src/api/routes/dev.routes.ts

Updated tests:
- tests/unit/real-data-ingestion.service.test.ts
- tests/integration/api-ingestion.integration.test.ts
- tests/integration/api-dev.integration.test.ts

Updated docs:
- docs/api.md
- docs/providers.md

## Validation Status (Latest)

Validated successfully after latest-market-data correctness implementation:
- npm run typecheck: passed
- npm test: passed
  - 29 test files passed
  - 160 tests passed
- npm run build: passed

Notes during validation:
- Existing volatility-warning stderr output in tests remains expected from previous volatility safeguards and does not fail CI.

## Runtime Notes

- npm run dev may fail if port 4000 is already in use (environment/runtime conflict, not compile/test failure).

## Resume Checklist

1. Ensure local Postgres is running.
2. Run npm run typecheck.
3. Run npm test.
4. Run npm run build.
5. Validate key flows manually:
- GET /api/market-data/<TICKER>/latest
- GET /api/stocks/<TICKER>/research-bundle
- GET /api/portfolios/<PORTFOLIO_CUID>
- GET /api/dev/market-data-audit/<TICKER>

## Recommended Next Steps

1. Commit the current dirty working tree in logically grouped commits (economics foundation and latest-market-data correctness can be split if desired).
2. If source-aware cleanup is required, add a dedicated source field to PriceSnapshot via a separate Prisma migration and then introduce safe purge helpers.
3. Optionally add explicit response schemas for dev market-data audit payload if stricter generated API contracts are needed.
