# Backend Context (Latest v16)

## Handoff Snapshot

Date:
- 2026-06-05

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (watchlist + research pipeline foundation added)

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
- Added watchlist domain models and enums to Prisma schema.
- Added repository layer for watchlists and watchlist items.
- Added service layer with watchlist CRUD, item lifecycle handling, and local-data research bundle.
- Added API routes and schemas for watchlists and watchlist items.
- Added unit and integration coverage for watchlist service/API behavior.
- Updated docs and agent/backend tool contract mapping.

Key runtime outcomes:
- User-scoped watchlists and watchlist items now persist in DB.
- Duplicate ticker add to same watchlist updates existing item instead of duplicating.
- Research bundle endpoint returns only locally persisted context (no provider calls in route path).

## Prisma Changes

Added enums:
- WatchlistItemStatus:
  - WATCHING
  - RESEARCHING
  - CANDIDATE
  - REJECTED
  - CONVERTED_TO_HOLDING
  - ARCHIVED
- WatchlistItemPriority:
  - LOW
  - MEDIUM
  - HIGH
- WatchlistItemSource:
  - USER
  - SCREENER
  - AGENT
  - REPORT

Added models:
- Watchlist
  - fields: id, userId, name, description, isDefault, createdAt, updatedAt
  - relations: user -> User, items -> WatchlistItem[]
  - constraints: @@index([userId]), @@unique([userId, name])
- WatchlistItem
  - fields: id, watchlistId, stockId, status, priority, thesis, riskNotes, targetEntryPrice, targetExitPrice, targetAllocation, tags, source, addedReason, rejectionReason, convertedHoldingId, lastReviewedAt, createdAt, updatedAt
  - relations: watchlist -> Watchlist, stock -> Stock, convertedHolding -> Holding?
  - constraints: @@unique([watchlistId, stockId]), indexes on watchlistId, stockId, status, priority

Cross-model relation wiring:
- User.watchlists
- Stock.watchlistItems
- Holding.convertedWatchlistItems

Migration file created:
- prisma/migrations/20260605173000_add_watchlists/migration.sql

## Repository Layer

Added:
- src/repositories/watchlists.repository.ts
- src/repositories/watchlist-items.repository.ts

Implemented functions:
- Watchlists:
  - createWatchlist
  - getWatchlistById
  - getWatchlistWithItems
  - getWatchlistsByUserId
  - getDefaultWatchlistByUserId
  - updateWatchlist
  - deleteWatchlist
- Watchlist items:
  - createWatchlistItem
  - getWatchlistItemById
  - getWatchlistItemWithStock
  - getWatchlistItemsByWatchlistId
  - getWatchlistItemByWatchlistAndStock
  - updateWatchlistItem
  - deleteWatchlistItem
  - listWatchlistItemsByStatus

Barrel updated:
- src/repositories/index.ts

## Service Layer

Added:
- src/services/watchlists.service.ts

Implemented:
- createWatchlistForUser (exported as createWatchlist)
- listWatchlistsForUser
- getWatchlistDetail
- updateWatchlistDetails (exported as updateWatchlist)
- deleteWatchlistById (exported as deleteWatchlist)
- addTickerToWatchlist
  - normalizes ticker
  - ensures stock exists via existing stock service
  - duplicate (watchlistId, stockId) path updates existing item
- updateWatchlistItemDetails
- removeWatchlistItem
- getWatchlistResearchBundle
  - local persisted data only
  - includes item metadata, stock metadata, latest price/fundamental/technical/report, top 3 headlines + sentiment counts, next earnings date

Agent-readiness comments included for future wrappers:
- createWatchlist
- addTickerToWatchlist
- updateWatchlistItem
- getWatchlistResearchBundle

Barrel updated:
- src/services/index.ts

## API Layer

Added schemas:
- src/api/schemas/watchlists.schemas.ts
- src/api/schemas/common.schemas.ts (extended with watchlist enums)

Added routes:
- src/api/routes/watchlists.routes.ts

Registered route group:
- src/api/routes/index.ts
- prefix: /api/watchlists

Endpoints implemented:
- POST /api/watchlists
- GET /api/watchlists/user/:userId
- GET /api/watchlists/:watchlistId
- PATCH /api/watchlists/:watchlistId
- DELETE /api/watchlists/:watchlistId
- POST /api/watchlists/:watchlistId/items
- PATCH /api/watchlists/items/:itemId
- DELETE /api/watchlists/items/:itemId
- GET /api/watchlists/:watchlistId/research-bundle

Response behavior:
- All responses use existing standard envelope utilities.

## Types and Contracts

Updated:
- src/types/services.ts

Added:
- WatchlistDetailItem
- WatchlistDetail
- WatchlistResearchItemSummary
- WatchlistResearchBundle

## Seed and Demo Context

Updated:
- prisma/seed.ts

Behavior:
- Creates/updates default watchlist for demo user:
  - name: Default Watchlist
  - isDefault: true
- Idempotently upserts watchlist items for AAPL and MSFT when seeded stocks exist.
- No fake analytical data added beyond existing seeded context.

## Testing

Added unit tests:
- tests/unit/watchlists.service.test.ts
  - create watchlist
  - list watchlists
  - add ticker duplicate path updates existing item
  - update/remove item
  - detail includes stock metadata + latest report/price
  - research bundle includes local latest report/price
  - delete watchlist cascades items

Added integration tests:
- tests/integration/api-watchlists.integration.test.ts
  - envelope behavior for create/detail/research bundle
  - validation errors for invalid ticker/body
  - delete behavior and not-found follow-up

Test factory updates:
- src/test/factories.ts
  - createTestWatchlist
  - createTestWatchlistItem

## Docs

Updated:
- docs/api.md
  - watchlist routes, examples, enum values, payload notes
- docs/providers.md
  - clarified watchlist CRUD/research-bundle are local-data only (no provider calls)

Added:
- docs/agent/backend-tool-contracts.md
  - current tool candidates and future watchlist tool mapping

## Validation Status

Previously completed before this handoff:
- npx prisma generate: passed
- npm run typecheck: passed
- npm run build: passed

Previously blocked before this handoff:
- npx prisma migrate dev --name add_watchlists (DATABASE_URL missing in that shell context)
- tests requiring DB env vars in that shell context

Completed in this run (post .env verification):
- Environment check:
  - .env present
  - DATABASE_URL was missing from process env initially, then loaded from .env for command execution
  - TEST_DATABASE_URL remains unset in process env
- npx prisma migrate dev --name add_watchlists: passed
  - result: Already in sync, no schema change or pending migration
  - Prisma Client generated successfully
- npm run build: passed
- npm test: passed
  - 36 test files
  - 220 tests
  - exit code 0

## Operational Notes

- Prisma CLI warns that package.json#prisma config is deprecated for Prisma 7 and should move to prisma.config.ts in a future cleanup.
- Current tests pass without TEST_DATABASE_URL set in this shell; keeping a dedicated test DB URL is still recommended for stricter isolation.

## Resume Checklist

If continuing from this handoff:
1. Commit watchlist feature, tests, and docs changes.
2. Optionally set TEST_DATABASE_URL in .env for explicit test DB isolation.
3. If proceeding with agent workflows, implement wrappers aligned with docs/agent/backend-tool-contracts.md for watchlist operations.
