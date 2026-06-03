# Backend Context (Latest v3)

## Scope
Backend repository only for the AI-powered portfolio intelligence assistant.

Current stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Vitest

Still intentionally out of scope in this phase:
- Frontend code
- HTTP routes/controllers
- Authentication
- External market/news/AI provider integrations

## Milestone 1: Database Foundation (Completed)

Status:
- Prisma schema is implemented and stable (`prisma/schema.prisma`)
- Initial migration applied (`prisma/migrations/20260603051133_init/migration.sql`)
- Prisma client generation works
- Seed script is idempotent and works

Environment:
- `.env.example` present with placeholder
- `.env` configured for local Postgres
- Local Docker database used:
  - Image: `postgres:16`
  - Container: `ai-portfolio-db`
  - Port mapping: `5432:5432`

Seeded demo data:
- User: `demo@example.com`
- Demo preferences + demo portfolio
- Stocks: AAPL, MSFT, NVDA
- Owned holdings with shares, average cost, thesis

## Milestone 2: Typed Repository/Data Access Layer (Completed)

Status:
- Typed repository layer exists for all current Prisma models
- Repositories return null/empty-array patterns naturally via Prisma behavior
- Errors are not swallowed
- Shared helpers and common types implemented in `src/types/common.ts`

Repository design notes:
- Ticker normalization helper present
- List limit defaults and caps present
- Prisma AI report delegate naming gotcha already handled in repository layer (`prisma.aIReport`)

## Milestone 3: Service Layer (Completed)

Status:
- Services implemented and exported from `src/services/index.ts`
- Services compose repository functions only (no direct Prisma usage in services)
- Business-rule validation and deterministic mock logic added

Service files:
- `src/services/portfolios.service.ts`
- `src/services/holdings.service.ts`
- `src/services/stocks.service.ts`
- `src/services/market-data.service.ts`
- `src/services/news.service.ts`
- `src/services/earnings.service.ts`
- `src/services/technical-analysis.service.ts`
- `src/services/fundamentals.service.ts`
- `src/services/ai-reports.service.ts`
- `src/services/portfolio-summaries.service.ts`
- `src/services/predictions.service.ts`
- `src/services/alerts.service.ts`
- `src/services/data-ingestion.service.ts`
- `src/services/index.ts`

Service shared types:
- `src/types/services.ts`

Key service behavior implemented:
- Portfolio overview stats and sector breakdown
- Holding overview aggregation (price/technical/fundamental/report/news)
- Stock research bundle assembly
- Market snapshot recording and daily change calculation (no external API)
- Technical indicator utilities (SMA, EMA, RSI, MACD) and trend classification
- Fundamental snapshot recording and delta comparison
- News recording (URL upsert) and sentiment/materiality summaries
- Earnings recording and portfolio upcoming earnings lookup
- Deterministic mock AI report generation from local stored data
- Portfolio summary generation from report mix and risk aggregation
- Prediction creation/scoring/outcome calculation for due horizons
- Alert workflows including recommendation-change severity rules
- Ingestion logging lifecycle wrappers with rethrow on failure

## Milestone 4: Automated Testing Foundation (Completed)

Status:
- Vitest is configured for Node + TypeScript test execution
- Shared setup/teardown enforces deterministic cleanup before each test
- Test DB helper supports `TEST_DATABASE_URL` with fallback to `DATABASE_URL`
- Cleanup is marker-based and dependency-ordered (no schema drops)
- Reusable factories added for common entities (user, portfolio, holding, stock, snapshots, reports, predictions)

Test infrastructure files:
- `vitest.config.ts`
- `src/test/setup.ts`
- `src/test/test-db.ts`
- `src/test/cleanup.ts`
- `src/test/factories.ts`

Unit tests added:
- `tests/unit/technical-analysis.service.test.ts`
- `tests/unit/market-data.service.test.ts`
- `tests/unit/fundamentals.service.test.ts`
- `tests/unit/news.service.test.ts`
- `tests/unit/ai-reports.service.test.ts`
- `tests/unit/predictions.service.test.ts`
- `tests/unit/portfolio-summaries.service.test.ts`

Integration tests added:
- `tests/integration/repositories.integration.test.ts`
- `tests/integration/portfolio-workflow.integration.test.ts`

Coverage focus:
- Indicator math + trend classification
- Market snapshot recording and retrieval
- Fundamental delta calculations
- News URL upsert/dedup + sentiment aggregates
- Deterministic report generation and prediction creation
- Prediction due/scoring/outcome/idempotency behavior
- Portfolio summary aggregation/risk/coverage handling
- Cross-repository relational create/read flows
- End-to-end service workflow from portfolio -> holding -> data -> report -> summary -> prediction scoring

## Tooling and Scripts

Current `package.json` scripts:
- `prisma:generate`
- `prisma:migrate`
- `prisma:seed`
- `typecheck` -> `tsc -p tsconfig.json`
- `test` -> `vitest run`
- `test:watch` -> `vitest`
- `test:coverage` -> `vitest run --coverage`

TypeScript project config:
- `tsconfig.json` exists
- Strict mode enabled
- Includes `src/**/*.ts` and `prisma/seed.ts`

## Validation Status
- Editor diagnostics show no errors
- `npm run typecheck` succeeds
- `npm test` succeeds
  - 9 test files passing
  - 38 tests passing
- Prisma setup and seed workflow remain operational

## Current Project State Summary
- Database foundation complete
- Repository layer complete
- Service layer complete
- Automated testing foundation complete
- No transport/auth/frontend/provider integrations added yet

## Recommended Next Step
- Start API layer wiring (routes/controllers) against the existing services.
- In parallel, add CI test execution and optional coverage thresholds.
