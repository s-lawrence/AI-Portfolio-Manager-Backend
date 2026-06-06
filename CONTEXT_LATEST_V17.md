# Backend Context (Latest v17)

## Handoff Snapshot

Date:
- 2026-06-05

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (watchlist runtime registration fix integrated and validated)

## Incident Summary

Runtime symptom observed:
- GET /api/watchlists/user/:userId returned Fastify default route-not-found payload:
  - { "message": "Route GET:/api/watchlists/user/... not found", "error": "Not Found", "statusCode": 404 }

Meaning:
- Request was not reaching API handlers and not flowing through standard response envelope utilities.

## Root Cause

Primary cause:
- Watchlist feature files were missing from this branch/runtime source tree (routes/services/repositories/schema additions not present).

Contributing cause:
- Route registration index did not include watchlists plugin under /api/watchlists.

Result:
- Fastify had no registered matching route, so request fell through to framework default 404 payload.

## Fix Applied

### 1) Restored watchlist domain and persistence

Prisma schema restored with watchlist enums/models and relation wiring:
- WatchlistItemStatus
- WatchlistItemPriority
- WatchlistItemSource
- Watchlist
- WatchlistItem
- User.watchlists
- Stock.watchlistItems
- Holding.convertedWatchlistItems

Files:
- prisma/schema.prisma
- prisma/migrations/20260605173000_add_watchlists/migration.sql

Prisma generated an additional drift migration during sync:
- prisma/migrations/20260606014338_add_watchlists/migration.sql
- Change: ALTER TABLE "WatchlistItem" ALTER COLUMN "tags" DROP DEFAULT;

### 2) Restored repository/service/api layers

Added repositories:
- src/repositories/watchlists.repository.ts
- src/repositories/watchlist-items.repository.ts

Added service:
- src/services/watchlists.service.ts

Added API schema/routes:
- src/api/schemas/watchlists.schemas.ts
- src/api/routes/watchlists.routes.ts

Updated barrels/types/common schema:
- src/repositories/index.ts
- src/services/index.ts
- src/types/services.ts
- src/api/schemas/common.schemas.ts

### 3) Registered routes correctly at runtime

Updated route index:
- src/api/routes/index.ts

Registration:
- app.register(watchlistsRoutes, { prefix: "/api/watchlists" })

Route coverage now live:
- POST /api/watchlists
- GET /api/watchlists/user/:userId
- GET /api/watchlists/:watchlistId
- PATCH /api/watchlists/:watchlistId
- DELETE /api/watchlists/:watchlistId
- POST /api/watchlists/:watchlistId/items
- PATCH /api/watchlists/items/:itemId
- DELETE /api/watchlists/items/:itemId
- GET /api/watchlists/:watchlistId/research-bundle

### 4) Added non-production route-map/debug visibility

Dev-only route added:
- GET /api/dev/routes

File:
- src/api/routes/dev.routes.ts

Payload includes:
- nodeEnv
- cwd
- app.printRoutes() output

Startup diagnostics (non-production only):
- logs cwd
- logs NODE_ENV
- logs route map from app.printRoutes()

File:
- src/server.ts

### 5) Ensured route ordering avoids shadowing

In watchlists routes, static/specific routes are declared before dynamic :watchlistId routes:
1. GET /user/:userId
2. PATCH/DELETE /items/:itemId
3. POST /:watchlistId/items
4. GET /:watchlistId/research-bundle
5. GET /:watchlistId
6. PATCH /:watchlistId
7. DELETE /:watchlistId
8. POST /

## Runtime and Error Handling Notes

- Route registration in src/api/routes/index.ts uses awaited app.register calls.
- Startup failure path in src/server.ts logs and exits with non-zero code.
- This ensures plugin/import registration errors fail loudly, rather than silently masking missing routes.

## Validation

Executed and passed:
- npx prisma generate
- npm run typecheck
- npm test
  - 37 test files
  - 223 tests
- npm run build

Migration status:
- npx prisma migrate dev --name add_watchlists
  - applied 20260605173000_add_watchlists
  - applied generated 20260606014338_add_watchlists

## New Runtime Integration Test Coverage

Added:
- tests/integration/api-watchlists-runtime.integration.test.ts

Assertions include:
- GET /api/watchlists/user/:userId returns standard app envelope
- POST /api/watchlists returns standard app envelope
- GET /api/watchlists/:watchlistId/research-bundle returns standard app envelope
- existing routes must not return Fastify default not-found payload shape

## Manual Smoke (Fresh Dev Process)

Process hygiene:
- Stopped existing listener on port 4000.
- Started npm run dev from C:\GitLab\AI-Portfolio-Manager-Backend.

Observed:
- startup logs confirm cwd and non-production route map
- /api/dev/routes includes /api/watchlists tree

Manual calls:
1. GET /api/dev/routes
- success envelope; route tree contains watchlists endpoints

2. GET /api/watchlists/user/cmpxm04y10000tluoakvethcr
- success envelope returned
- no Fastify default route-not-found payload

3. POST /api/watchlists
- success envelope returned with created watchlist when JSON body is valid
- no Fastify default route-not-found payload

Windows shell note:
- Inline curl JSON quoting in PowerShell produced invalid JSON body in some attempts.
- Using Invoke-RestMethod or curl payload-file mode produced valid request payloads reliably.

## Files Added

- prisma/migrations/20260605173000_add_watchlists/migration.sql
- prisma/migrations/20260606014338_add_watchlists/migration.sql
- src/repositories/watchlists.repository.ts
- src/repositories/watchlist-items.repository.ts
- src/services/watchlists.service.ts
- src/api/schemas/watchlists.schemas.ts
- src/api/routes/watchlists.routes.ts
- tests/integration/api-watchlists-runtime.integration.test.ts

## Files Updated

- prisma/schema.prisma
- src/api/routes/index.ts
- src/api/routes/dev.routes.ts
- src/server.ts
- src/api/schemas/common.schemas.ts
- src/repositories/index.ts
- src/services/index.ts
- src/types/services.ts

## Resume Checklist

If continuing from this handoff:
1. Review and commit watchlist runtime registration fix files.
2. Optionally consolidate migration naming if you want a cleaner migration history.
3. Keep /api/dev/routes gated to non-production and retain startup route map logs for near-term debugging.
4. If desired later, remove or tone down startup route map log verbosity once runtime confidence is stable.
