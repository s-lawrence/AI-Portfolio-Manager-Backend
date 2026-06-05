# Backend Context (Latest v14)

## Handoff Snapshot

Date:
- 2026-06-04

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (macro/FX milestone plus full-refresh performance hardening implemented and validated)

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

## Milestone Summary

Primary outcomes completed:
- Added Bank of Canada and FRED macro/FX ingestion with storage, API endpoints, full-refresh integration, report enrichment, tests, and docs.
- Added full-refresh performance diagnostics, workload controls, strict include-flag gating, provider timeout handling, and no-op update suppression for macro/economics persistence.

Key runtime outcomes:
- Full-refresh supports quick, bounded runs by default while preserving optional deeper coverage through request flags/options.
- Provider HTTP calls fail fast on timeout and full-refresh continues non-blocking where designed.
- Macro/economics persistence now avoids unnecessary writes for unchanged records.

## Data Model and Config

Completed:
- Added FxRateSnapshot model and migration.
- Added environment support for BoC USD/CAD default series.
- Added provider timeout environment variable: PROVIDER_HTTP_TIMEOUT_MS (default 20000).
- Extended service/provider contracts with timing metadata and macro/economics control options.

Key files:
- prisma/schema.prisma
- prisma/migrations/20260605051738_add_fx_rate_snapshots/migration.sql
- src/config/env.ts
- .env.example
- src/providers/types.ts
- src/types/services.ts

## Provider Implementations

Completed:
- Bank of Canada provider integration.
- FRED provider integration.
- Timeout enforcement in provider clients using AbortController.

Bank of Canada behavior:
- Uses /observations/{seriesId}/json.
- No API key required.
- USD/CAD convention is base USD, quote CAD, rate in CAD per 1 USD.

FRED behavior:
- Uses /series/observations.
- API key required at call-time.
- Dot values (".") are skipped.

Timeout behavior:
- FMP, FRED, and BoC clients enforce PROVIDER_HTTP_TIMEOUT_MS.
- Timeout errors are surfaced as provider request errors with explicit timeout messaging.

Key files:
- src/providers/bank-of-canada/boc-client.ts
- src/providers/bank-of-canada/boc-provider.ts
- src/providers/bank-of-canada/boc.types.ts
- src/providers/fred/fred-client.ts
- src/providers/fred/fred-provider.ts
- src/providers/fred/fred.types.ts
- src/providers/fmp/fmp-client.ts
- src/providers/index.ts

## Repository and Services

Completed:
- Added FX repository and service wrappers.
- Added macro series service wrappers.
- Built macro ingestion orchestration service.
- Added full-refresh timing instrumentation and slow-section diagnostics.
- Added economics/macro request-level control plumbing.
- Added no-op upsert skip logic to reduce DB write load.

Performance-related repository behavior:
- Macro/Fx/event upserts now report created, updated, and skipped with no-op update suppression.

Key files:
- src/repositories/fx-rate-snapshots.repository.ts
- src/repositories/macro-series-observations.repository.ts
- src/repositories/macro-events.repository.ts
- src/services/fx-rates.service.ts
- src/services/macro-series.service.ts
- src/services/macro-ingestion.service.ts
- src/services/fmp-economics-ingestion.service.ts
- src/services/real-data-ingestion.service.ts
- src/services/index.ts
- src/repositories/index.ts

## API Layer

Completed:
- Added macro ingestion request schemas and route handlers.
- Registered macro ingestion routes.
- Extended full-refresh schema and route option plumbing for performance controls.

New macro endpoints:
- POST /api/ingestion/macro/boc/usd-cad
- POST /api/ingestion/macro/boc/series/:seriesId
- POST /api/ingestion/macro/fred/:seriesId
- POST /api/ingestion/macro/fred/default-set
- POST /api/ingestion/macro/default

Full-refresh request additions:
- refreshMode?: "quick" | "full" (default quick)
- includeEconomics?: boolean
- includeBankOfCanada?: boolean
- includeFred?: boolean
- economicsCalendarPastDays?: number
- economicsCalendarFutureDays?: number
- fredObservationLimit?: number
- bocObservationLimit?: number
- macroMaxSeries?: number

Key files:
- src/api/schemas/macro-ingestion.schemas.ts
- src/api/routes/macro-ingestion.routes.ts
- src/api/routes/index.ts
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

## Full-Refresh Diagnostics and Gating

Implemented in orchestration:
- Top-level durationMs added to full-refresh result.
- durationMs added to executed sections (marketData/fundamentals/earnings/news/economics/bankOfCanada/fred/macro/analysis when present).
- Strict include semantics using explicit true checks to prevent accidental macro/economics execution.
- refreshMode defaults to quick.
- Development slow-section logging for long-running sections.
- Macro/economics section failures remain non-blocking and aggregated as warnings.

Key file:
- src/services/real-data-ingestion.service.ts

## Macro and Economics Ingestion Controls

Implemented:
- FRED ingestion supports max series cap and per-series observation limits.
- BoC ingestion supports observation limit.
- Default macro FRED ingestion is batched for lower wall-clock time.
- Economics default-set supports configurable calendar past/future windows and section timing.

Key files:
- src/services/macro-ingestion.service.ts
- src/services/fmp-economics-ingestion.service.ts

## Report Enrichment

Completed:
- Macro summary includes BoC/FRED context when present:
- USD/CAD
- FRED 10Y/2Y curve snapshot
- Fed funds
- CPI
- Unemployment
- WTI
- Existing FMP macro fallback behavior is preserved when BoC/FRED data is not available.

Key file:
- src/services/ai-reports.service.ts

## Testing

Added/updated tests:
- tests/unit/bank-of-canada.provider.test.ts
- tests/unit/fred.provider.test.ts
- tests/unit/macro-ingestion.service.test.ts
- tests/unit/fmp-economics-ingestion.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts
- tests/unit/ai-reports.service.test.ts
- tests/integration/api-ingestion.integration.test.ts
- src/test/cleanup.ts (macro cleanup coverage for FMP/FRED/BANK_OF_CANADA)

Stabilization updates completed:
- Integration assertion updated to treat created + updated + skipped as processed work for idempotent no-op runs.
- Timeout warning assertion updated to check section-level warnings where timeout detail is surfaced.

## Docs

Updated:
- docs/providers.md
- docs/api.md

Documented items:
- Provider timeout configuration and behavior.
- Full-refresh performance options and include-flag semantics.
- durationMs diagnostics fields.
- Macro ingestion volume controls and no-op update behavior.

## Validation Status

Validation completed after final fixes:
- Targeted regression suite: passed
  - 4 files, 56 tests
- Focused scenario checks: passed
  - real-data full-refresh scenario subset: 5 passed
  - API ingestion scenario subset: 4 passed
- npm run typecheck: passed
- npm test: passed
  - 34 test files
  - 210 tests
- npm run build: passed

## Operational Notes

- FRED ingestion requires FRED_API_KEY when endpoint is called.
- Bank of Canada ingestion does not require an API key.
- Provider calls are bounded by PROVIDER_HTTP_TIMEOUT_MS.
- Full-refresh macro/economics sections are opt-in through explicit include flags.
- /api/ingestion/macro/default attempts both BoC and FRED sections.

## Resume Checklist

If continuing from this handoff:
1. Review working tree and commit milestone plus performance-hardening changes.
2. Optionally run live endpoint payload checks against a running dev server for external-provider behavior.
3. Extend default macro series/metadata as needed for additional strategy requirements.
