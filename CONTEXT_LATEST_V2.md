# Backend Context (Latest v2)

## Scope
Backend repository only for the AI-powered portfolio intelligence assistant.

Current stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM

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

## Recent Update Notes
- `src/services/ai-reports.service.ts` has the latest deterministic report/prediction generation logic and validation behavior.
- `src/services/portfolio-summaries.service.ts` has the latest summary aggregation logic and strict enum typing fixes.
- Strict typecheck currently passes after these updates.

## Tooling and Scripts

Current `package.json` scripts:
- `prisma:generate`
- `prisma:migrate`
- `prisma:seed`
- `typecheck` -> `tsc -p tsconfig.json`

TypeScript project config:
- `tsconfig.json` exists
- Strict mode enabled
- Includes `src/**/*.ts` and `prisma/seed.ts`

## Validation Status
- Editor diagnostics for `src` show no errors
- `npm run typecheck` succeeds
- Prisma setup and seed workflow remain operational

## Current Project State Summary
- Database foundation complete
- Repository layer complete
- Service layer complete
- No transport/auth/frontend/provider integrations added yet

## Recommended Next Step
- Add unit and integration tests for service business rules (especially AI report heuristics, prediction scoring/outcomes, and portfolio summary aggregation), then begin API layer wiring in a separate phase.
