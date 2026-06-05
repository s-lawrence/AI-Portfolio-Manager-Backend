# Backend Context (Latest v13)

## Handoff Snapshot

Date:
- 2026-06-04

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (BoC/FRED macro+FX milestone implemented and validated; ready for commit)

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

Primary milestone completed:
- Add Bank of Canada and FRED macro/FX ingestion with storage, API endpoints, full-refresh integration, report enrichment, tests, and docs.

Major outcome:
- Macro+FX ingestion is now first-class and non-blocking.
- Full-refresh can optionally include BoC/FRED sections.
- Report macro summary now includes USD/CAD and FRED curve/rates context when available.

## Data Model and Config

Completed:
- Added `FxRateSnapshot` model and migration.
- Added environment support for BoC USD/CAD default series.
- Extended provider and service contracts for macro/FX ingestion sections.

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

Bank of Canada behavior:
- Uses `/observations/{seriesId}/json`.
- No API key required.
- USD/CAD convention is base `USD`, quote `CAD`, rate in CAD per 1 USD.

FRED behavior:
- Uses `/series/observations`.
- API key required at call-time.
- Dot values (`"."`) are skipped.

Key files:
- src/providers/bank-of-canada/boc-client.ts
- src/providers/bank-of-canada/boc-provider.ts
- src/providers/bank-of-canada/boc.types.ts
- src/providers/fred/fred-client.ts
- src/providers/fred/fred-provider.ts
- src/providers/fred/fred.types.ts
- src/providers/index.ts

## Repository and Services

Completed:
- Added FX repository and services.
- Added macro series service wrappers.
- Built macro ingestion orchestration service.
- Exported new services from service barrel.

Key files:
- src/repositories/fx-rate-snapshots.repository.ts
- src/repositories/index.ts
- src/services/fx-rates.service.ts
- src/services/macro-series.service.ts
- src/services/macro-ingestion.service.ts
- src/services/index.ts

## API Layer

Completed:
- Added macro ingestion request schemas and route handlers.
- Registered macro ingestion routes.
- Added full-refresh request flags for macro providers.

New macro endpoints:
- POST /api/ingestion/macro/boc/usd-cad
- POST /api/ingestion/macro/boc/series/:seriesId
- POST /api/ingestion/macro/fred/:seriesId
- POST /api/ingestion/macro/fred/default-set
- POST /api/ingestion/macro/default

Full-refresh additions:
- `includeBankOfCanada?: boolean`
- `includeFred?: boolean`

Key files:
- src/api/schemas/macro-ingestion.schemas.ts
- src/api/routes/macro-ingestion.routes.ts
- src/api/routes/index.ts
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

## Full-Refresh Integration

Completed in real-data orchestration:
- Optional macro ingestion call integrated into full-refresh.
- Macro ingestion is non-blocking.
- Warnings are aggregated if macro sections fail.
- Result payload now includes optional `bankOfCanada`, `fred`, and `macro` sections.

Key file:
- src/services/real-data-ingestion.service.ts

## Report Enrichment

Completed:
- Macro summary now includes BoC/FRED context when present:
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
- tests/unit/real-data-ingestion.service.test.ts
- tests/unit/ai-reports.service.test.ts
- tests/integration/api-ingestion.integration.test.ts
- src/test/cleanup.ts (extended macro cleanup for FRED/BANK_OF_CANADA providers)

Important stabilization note:
- Macro cleanup now removes `FMP`, `FRED`, and `BANK_OF_CANADA` provider rows to prevent order-dependent upsert test flakes.

## Docs

Updated:
- docs/providers.md
- docs/api.md

Documented items:
- BoC and FRED provider configuration.
- USD/CAD convention and default FRED series set.
- New macro ingestion endpoints.
- Full-refresh macro flags and response sections.

## Validation Status

Final validation completed:
- npm run typecheck: passed
- npx vitest run --reporter=dot: passed
  - 34 test files
  - 200 tests
- npm run build: passed

## Operational Notes

- FRED ingestion requires `FRED_API_KEY` when endpoint is called.
- Bank of Canada ingestion does not require an API key.
- Full-refresh macro sections are opt-in via request flags.
- /api/ingestion/macro/default always attempts both BoC and FRED sections.

## Resume Checklist

If continuing from this handoff:
1. Review working tree and commit milestone changes.
2. Optionally run targeted local smoke checks on macro endpoints against running dev server.
3. If needed, extend FRED metadata map for additional custom series.
