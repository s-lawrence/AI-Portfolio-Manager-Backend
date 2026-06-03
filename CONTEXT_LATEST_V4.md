# Backend Context (Latest v4)

## Scope
Backend repository only for the AI-powered portfolio intelligence assistant.

Current stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Fastify
- Zod
- dotenv
- Vitest

Still intentionally out of scope in this phase:
- Frontend code
- Authentication/authorization
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
- Prisma AI report delegate naming gotcha handled (`prisma.aIReport`)

## Milestone 3: Service Layer (Completed)

Status:
- Services implemented and exported from `src/services/index.ts`
- Services compose repository functions (no direct Prisma usage in services)
- Business-rule validation and deterministic mock logic added

Core service behavior:
- Portfolio overview stats and sector breakdown
- Holding overview aggregation (price/technical/fundamental/report/news)
- Stock research bundle assembly
- Market snapshot recording and daily change calculation
- Technical indicator calculations (SMA, EMA, RSI, MACD) and trend classification
- Fundamental snapshot recording and delta comparison
- News recording (URL upsert) and sentiment/materiality summaries
- Earnings recording and upcoming portfolio earnings lookup
- Deterministic mock AI report generation from local stored data
- Portfolio summary generation from report mix and risk aggregation
- Prediction creation/scoring/outcome calculations
- Alert workflows and recommendation-change severity handling
- Ingestion logging lifecycle wrappers with rethrow on failure

## Milestone 4: Automated Testing Foundation (Completed)

Status:
- Vitest configured for Node + TypeScript
- Shared setup/teardown enforces deterministic cleanup before each test
- Test DB helper supports `TEST_DATABASE_URL` fallback to `DATABASE_URL`
- Cleanup is marker-based and dependency-ordered (no schema drops)
- Reusable factories exist for core entities and snapshots

Test foundation files:
- `vitest.config.ts`
- `src/test/setup.ts`
- `src/test/test-db.ts`
- `src/test/cleanup.ts`
- `src/test/factories.ts`

Service/repository test coverage exists across:
- Unit tests for technical analysis, market data, fundamentals, news, AI reports, predictions, portfolio summaries
- Integration tests for repository flows and end-to-end portfolio workflow

## Milestone 5: HTTP API Layer with Fastify + Zod (Completed)

Status:
- Fastify app/server wiring added
- CORS configured for local frontend origin
- dotenv-based env loading and startup validation added
- Centralized API error handling and response helpers added
- Route groups added for health + all requested domain endpoints
- Route handlers are thin and call service layer functions
- Request params/query/body validation implemented with Zod

App and config files:
- `src/config/env.ts`
- `src/app.ts`
- `src/server.ts`

API foundation files:
- `src/api/errors.ts`
- `src/api/response.ts`

Schema files:
- `src/api/schemas/common.schemas.ts`
- `src/api/schemas/portfolios.schemas.ts`
- `src/api/schemas/holdings.schemas.ts`
- `src/api/schemas/stocks.schemas.ts`
- `src/api/schemas/market-data.schemas.ts`
- `src/api/schemas/news.schemas.ts`
- `src/api/schemas/earnings.schemas.ts`
- `src/api/schemas/reports.schemas.ts`
- `src/api/schemas/portfolio-summaries.schemas.ts`
- `src/api/schemas/predictions.schemas.ts`
- `src/api/schemas/alerts.schemas.ts`

Route files:
- `src/api/routes/index.ts`
- `src/api/routes/health.routes.ts`
- `src/api/routes/portfolios.routes.ts`
- `src/api/routes/holdings.routes.ts`
- `src/api/routes/stocks.routes.ts`
- `src/api/routes/market-data.routes.ts`
- `src/api/routes/news.routes.ts`
- `src/api/routes/earnings.routes.ts`
- `src/api/routes/reports.routes.ts`
- `src/api/routes/portfolio-summaries.routes.ts`
- `src/api/routes/predictions.routes.ts`
- `src/api/routes/alerts.routes.ts`

Service-layer updates made to preserve route -> service -> repository boundaries:
- Added stock listing service method in `src/services/stocks.service.ts`
- Added ticker-based prediction listing service method in `src/services/predictions.service.ts`
- Added alert delete service method in `src/services/alerts.service.ts`

## API Behavior Notes

Response success shape:
- `{ "success": true, "data": ... }`

Error shape:
- `{ "success": false, "error": { "code": "...", "message": "...", "details": ... } }`

Error handling:
- Zod parse errors return 400 with validation details
- Known API/domain errors map to their status codes
- Unknown errors map to 500
- Production responses do not leak stack traces

Health endpoints:
- `GET /health`
- `GET /health/db` (DB reachability check using Prisma client)

## API Tests and Documentation

New API integration tests:
- `tests/integration/api-health.integration.test.ts`
- `tests/integration/api-portfolio.integration.test.ts`

API docs:
- `docs/api.md`

Documentation includes:
- Dev/build/start commands
- Base URL (`http://localhost:4000`)
- Health endpoints
- Main route groups
- Example curl commands for create portfolio, add holding, record snapshot, generate report, generate summary

## Tooling and Scripts

Current scripts:
- `prisma:generate`
- `prisma:migrate`
- `prisma:seed`
- `dev` -> `tsx watch src/server.ts`
- `build` -> `tsc -p tsconfig.json`
- `start` -> `node dist/server.js`
- `typecheck` -> `tsc -p tsconfig.json --noEmit`
- `test` -> `vitest run`
- `test:watch` -> `vitest`
- `test:coverage` -> `vitest run --coverage`

TypeScript config updates:
- `rootDir` set to `src`
- `outDir` set to `dist`
- Build emit enabled for production output
- Typecheck still no-emit via script flag

## Validation Status

Current known-good checks:
- `npm run typecheck` succeeds
- `npm test` succeeds
  - 11 test files passing
  - 42 tests passing
- `npm run build` succeeds
- API/server build artifacts generated under `dist/`

## Current Project State Summary

Completed:
- Database foundation
- Repository layer
- Service layer
- Automated testing foundation
- HTTP API transport layer

Still pending by design:
- Authentication/authorization
- External provider integrations
- Frontend work

## Recommended Next Step
- Add auth and authorization middleware (separate phase).
- Add OpenAPI/Swagger contract generation from route schemas.
- Add CI pipeline checks for build/typecheck/tests and optional coverage thresholds.
