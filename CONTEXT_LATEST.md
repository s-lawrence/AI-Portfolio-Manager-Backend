# Backend Context (Latest)

## Project Scope
Backend-only repository for an AI-powered portfolio intelligence assistant.

Active stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM

Intentionally not implemented yet:
- Frontend UI
- API route layer (Express/Fastify/Nest)
- Auth
- External market/news/AI provider integrations

## Milestone 1: Prisma Database Foundation (Completed)

### Database setup status
- Prisma schema implemented at `prisma/schema.prisma`
- Initial migration created and applied:
  - `prisma/migrations/20260603051133_init/migration.sql`
  - `prisma/migrations/migration_lock.toml`
- Prisma client generation works
- Seed script works and is idempotent

### Environment and local DB
- `.env.example` created with placeholder URL
- `.env` is configured with local docker Postgres:
  - `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"`
- Local Postgres Docker container used:
  - Image: `postgres:16`
  - Name: `ai-portfolio-db`
  - Port: `5432:5432`

### Seed data status
- Demo user: `demo@example.com`
- Demo preferences created/updated
- Demo portfolio created/updated
- Demo stocks upserted: AAPL, MSFT, NVDA
- Demo owned holdings upserted with shares, average cost, thesis

## Milestone 2: TypeScript Data Access Layer (Completed)

Goal achieved: backend code can use typed repository functions instead of calling Prisma directly throughout services.

### Added directories
- `src/db`
- `src/repositories`
- `src/types`

### Added files
- `src/db/prisma.ts`
- `src/types/common.ts`
- `src/repositories/index.ts`
- `src/repositories/users.repository.ts`
- `src/repositories/portfolios.repository.ts`
- `src/repositories/holdings.repository.ts`
- `src/repositories/stocks.repository.ts`
- `src/repositories/price-snapshots.repository.ts`
- `src/repositories/technical-snapshots.repository.ts`
- `src/repositories/fundamental-snapshots.repository.ts`
- `src/repositories/news-articles.repository.ts`
- `src/repositories/earnings-events.repository.ts`
- `src/repositories/macro-events.repository.ts`
- `src/repositories/ai-reports.repository.ts`
- `src/repositories/portfolio-summaries.repository.ts`
- `src/repositories/predictions.repository.ts`
- `src/repositories/prediction-outcomes.repository.ts`
- `src/repositories/alerts.repository.ts`
- `src/repositories/data-ingestion-logs.repository.ts`

### Repository layer behavior
- Small typed async CRUD/query functions per model
- Prisma input types used for create/update operations
- Single-record getters return `null` if not found
- List functions return arrays (empty when no results)
- Errors are not swallowed (unexpected Prisma errors bubble up)

### Shared helper types/utilities
Implemented in `src/types/common.ts`:
- `PaginationOptions`
- `DateRangeOptions`
- `RepositoryListOptions`
- `normalizeListLimit()` with defaults/caps
- `normalizeTickerOrThrow()` for uppercase normalization + empty ticker rejection

Default list behavior:
- Default limit: 50
- Max limit cap: 500

### Prisma client singleton
Implemented in `src/db/prisma.ts` using a `globalThis` pattern to avoid multiple PrismaClient instances in development.

### Notable implementation note
- For Prisma model `AIReport`, the generated Prisma Client delegate is `prisma.aIReport` (not `prisma.aiReport`).
  - Repository implementation already handles this correctly.

## Package/Tooling Updates
Current `package.json` highlights:
- Dependencies:
  - `@prisma/client`
- Dev dependencies:
  - `prisma`
  - `tsx`
  - `typescript`
  - `@types/node` (added to support strict TS checks in backend code)

Prisma warning status:
- Current setup still uses `package.json#prisma.seed` and works on Prisma 6.
- Prisma CLI warns this moves to `prisma.config.ts` in Prisma 7.

## Validation Status
- Prisma migrate: successful
- Prisma generate: successful
- Prisma seed: successful
- Repository layer diagnostics: no editor errors
- Strict TypeScript check for src layer: successful using explicit compiler flags and Node types

## Commands Commonly Used
Database commands:
1. `npm install`
2. `npx prisma migrate dev --name init`
3. `npx prisma generate`
4. `npx prisma db seed`

Strict TypeScript check (src layer):
1. `$files = Get-ChildItem -Path src -Filter *.ts -Recurse | ForEach-Object { $_.FullName }; npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck $files`

## Current State Summary
- Prisma schema and migration are stable
- Local DB and seed workflow are working
- Typed repository/data-access layer is in place for all current models
- No API routes/services wired yet (by design for this phase)

## Suggested Next Backend Step
- Build a service layer that composes repository calls and enforces domain/business rules, while still keeping transport concerns (HTTP routes/auth) out of scope until next phase.
