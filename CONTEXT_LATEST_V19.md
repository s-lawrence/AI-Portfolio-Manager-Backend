# Backend Context (Latest v19)

## Handoff Snapshot

Date:
- 2026-06-08

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (v17 watchlist/runtime work plus new analyst/discovery foundation changes)

## Objective and Constraints (This Implementation)

Primary objective implemented:
- Build end-to-end analyst and discovery ingestion foundation for FMP in backend:
  - persistence models
  - provider contracts + FMP mapping provider
  - repositories
  - services
  - API schemas/routes
  - full-refresh integration
  - research/report enrichment
  - tests and docs

Constraints followed:
- Backend-only changes (no frontend)
- No auth system added
- No OpenAI or external LLM calls added
- Existing API response envelope pattern preserved
- Non-blocking ingestion behavior retained where applicable

## Implementation Details

### 1) Prisma schema and migration

Schema changes in prisma/schema.prisma:
- Added Stock relations:
  - analystSnapshots AnalystSnapshot[]
  - analystActionEvents AnalystActionEvent[]
  - marketDiscoverySnapshots MarketDiscoverySnapshot[]
- Added model AnalystSnapshot with:
  - unique(stockId, capturedAt)
  - price target fields, analyst counts, rating consensus, upside percent
  - raw JSON payload
- Added model AnalystActionEvent with:
  - unique(stockId, eventDate, firm, actionType)
  - action metadata (ratings/targets/firm/headline/url)
  - raw JSON payload
- Added model MarketDiscoverySnapshot with:
  - category/ticker/capturedAt snapshots
  - optional stockId relation (SET NULL)
  - market mover metrics + raw JSON payload

Migration file created:
- prisma/migrations/20260608110931_add_analyst_discovery_data/migration.sql

Migration SQL includes:
- CREATE TABLE for AnalystSnapshot, AnalystActionEvent, MarketDiscoverySnapshot
- supporting indexes + unique constraints
- foreign keys to Stock with expected delete behavior

### 2) Provider contracts and FMP payload types

Provider-neutral contracts added in src/providers/types.ts:
- ProviderAnalystSnapshot
- ProviderAnalystActionEvent
- ProviderMarketDiscoveryItem
- AnalystProvider interface:
  - getPriceTargetSummary
  - getPriceTargetConsensus
  - getAnalystRatings
  - getUpgradesDowngrades
  - getMarketMovers

FMP payload interfaces added in src/providers/fmp/fmp.types.ts:
- FmpPriceTargetSummaryItem
- FmpPriceTargetConsensusItem
- FmpAnalystRatingItem
- FmpUpgradeDowngradeItem
- FmpMarketMoverItem

### 3) FMP analyst/discovery provider implementation

New provider file:
- src/providers/fmp/fmp-analyst.provider.ts

Provider capabilities:
- Price target summary:
  - stable endpoint with fallback: /stable/price-target-summary -> /price-target-summary
- Price target consensus:
  - /stable/price-target-consensus -> /price-target-consensus
- Analyst ratings:
  - /stable/analyst-ratings -> /analyst-ratings -> /stable/recommendation-trends -> /recommendation-trends
- Upgrades/downgrades events:
  - /stable/upgrades-downgrades -> /upgrades-downgrades -> /stable/upgrades-downgrades-consensus -> /upgrades-downgrades-consensus
- Discovery movers:
  - gainers/losers/active with stable + fallback endpoint sets
  - analyst_upgrades / analyst_downgrades derived from upgrades-downgrades feed

Mapping behavior:
- Robust numeric parsing from number/string payloads
- Ticker normalization to uppercase
- Event date extraction across alternate field names
- Action type normalization (UPGRADE/DOWNGRADE/etc.)
- Sorting newest-first where relevant
- limit normalization and cap

Error behavior:
- 404 endpoint fallback to next candidate
- 402 mapped to ProviderConfigurationError (plan/entitlement)
- 401/403 mapped to ProviderConfigurationError (auth/key)
- 429 mapped to ProviderRateLimitError

Wiring:
- Export and singleton added in src/providers/fmp/index.ts as fmpAnalystProvider

### 4) Repositories for analyst/discovery persistence

New repositories:
- src/repositories/analyst-snapshots.repository.ts
- src/repositories/analyst-action-events.repository.ts
- src/repositories/market-discovery-snapshots.repository.ts

Barrel export updated:
- src/repositories/index.ts

Repository behavior:
- AnalystSnapshot upsert by unique stockId + capturedAt
- AnalystActionEvent upsert by stockId + eventDate + actionType + firm matching policy
- MarketDiscoverySnapshot create + latest-by-category listing + recent listing filters

Important Prisma JSON handling fix:
- For nullable JSON columns, repository logic now converts nullable values to Prisma.DbNull for create/update input compatibility
- Added comparable/persisted JSON helper conversion to avoid TS/Prisma type mismatch and preserve idempotency checks

### 5) Service layer: analyst ingestion and discovery

New services:
- src/services/analyst-ingestion.service.ts
- src/services/market-discovery.service.ts

Barrel export updated:
- src/services/index.ts

Analyst ingestion service behavior:
- ingestTickerAnalystData(ticker):
  - ensures stock exists
  - pulls summary/consensus/ratings with soft-failure warning collection
  - merges snapshot components
  - computes upsidePercent from latest price snapshot if provider did not return one
  - upserts analyst snapshot
  - ingests upgrades/downgrades events via upsert
- ingestPortfolioAnalystData(portfolioId):
  - iterates unique portfolio tickers
  - per-ticker hard failure recorded in failedTickers
  - returns aggregate counters and duration
- ingestWatchlistAnalystData(watchlistId):
  - same continuation semantics as portfolio path
- read helpers:
  - getLatestTickerAnalystSnapshot
  - listTickerAnalystActions
  - listTickerAnalystSnapshots

Discovery service behavior:
- ingestMarketDiscovery(category, {limit}):
  - fetches movers via provider
  - ensures stock records exist
  - stores category snapshots
- ingestDefaultMarketDiscoverySet:
  - categories:
    - GAINERS
    - LOSERS
    - ACTIVE
    - ANALYST_UPGRADES
    - ANALYST_DOWNGRADES
  - continues on per-category failures and returns warnings
- listDiscoveryCandidates:
  - returns latest captured batch for category with optional limit

### 6) API schemas/routes and route registration

New schemas:
- src/api/schemas/analyst-ingestion.schemas.ts
- src/api/schemas/discovery.schemas.ts

New routes:
- src/api/routes/analyst-ingestion.routes.ts
- src/api/routes/discovery.routes.ts

Registered in:
- src/api/routes/index.ts
  - app.register(discoveryRoutes, { prefix: "/api/discovery" })
  - app.register(analystIngestionRoutes, { prefix: "/api" })

Analyst endpoints:
- POST /api/ingestion/fmp/ticker/:ticker/analyst
- POST /api/ingestion/fmp/portfolio/:portfolioId/analyst
- POST /api/ingestion/fmp/watchlist/:watchlistId/analyst
- GET /api/analyst/:ticker/latest
- GET /api/analyst/:ticker/actions?limit=<n>

Discovery endpoints:
- POST /api/discovery/fmp/:category/refresh
- POST /api/discovery/fmp/default-set
- GET /api/discovery/:category?limit=<n>

Envelope behavior:
- Routes use existing runService + ok helpers, preserving standard success/error envelope shape

### 7) Full-refresh integration (includeAnalystData)

Request surface updates:
- src/api/schemas/ingestion.schemas.ts:
  - includeAnalystData added to full-refresh body schema
- src/api/routes/ingestion.routes.ts:
  - includeAnalystData forwarded to ingestPortfolioFmpFullRefresh options

Service integration in src/services/real-data-ingestion.service.ts:
- Added includeAnalystData option support in full-refresh
- Added analystData section execution after news and before macro/analysis completion
- Non-blocking behavior:
  - if analyst ingestion throws, returns fallback analystData section with warnings
  - overall refresh still succeeds
- Added warning aggregation:
  - ticker failures and analyst warnings rolled into top-level warnings
- Added slow-section logging metadata for analystData
- Response now includes optional analystData in PortfolioFmpFullRefreshResult

### 8) Watchlist/ticker/report output enrichment

Ticker research bundle enriched in src/services/stocks.service.ts:
- Added to getStockResearchBundle output:
  - latestAnalystSnapshot
  - recentAnalystActions

Watchlist research bundle enriched in src/services/watchlists.service.ts:
- Added per-item:
  - latestAnalystSnapshot
  - recentAnalystActions (top 3)
  - discoveryContext for screener/agent-sourced items using recent discovery snapshots

AI report enrichment in src/services/ai-reports.service.ts:
- Added buildAnalystSummary helper
- Added analyst-derived scoring signals in generateMockTickerReport:
  - implied upside/downside from targets
  - rating consensus sentiment keywords
  - recent upgrade vs downgrade tilt
- Added warning when analyst context absent
- Appended analyst summary text into fundamentalSummary
- Included analystSummary in rawModelOutput

### 9) Test cleanup updates

Updated cleanup in src/test/cleanup.ts:
- Added deleteMany cleanup for:
  - analystActionEvent
  - analystSnapshot
  - marketDiscoverySnapshot
- Keeps dependency-safe cleanup order for tests

### 10) Tests added/updated

New unit tests:
- tests/unit/fmp-analyst-provider.test.ts
  - endpoint fallback and mapping coverage for summary/consensus/ratings/actions/discovery
- tests/unit/analyst-ingestion.service.test.ts
  - ticker ingestion happy path
  - portfolio/watchlist continuation when one ticker fails
  - null/empty read behavior for unknown ticker
- tests/unit/market-discovery.service.test.ts
  - category ingestion/listing
  - default-set continuation on one category failure
  - latest-batch selection behavior

Updated unit tests:
- tests/unit/real-data-ingestion.service.test.ts
  - includeAnalystData=true returns analystData section
  - includeAnalystData=false skips analyst ingestion and omits section
- tests/unit/ai-reports.service.test.ts
  - verifies analyst-context enrichment appears in report summary and raw output

Updated integration tests:
- tests/integration/api-ingestion.integration.test.ts
  - analyst ingestion/read endpoint envelopes
  - discovery refresh/default/list envelopes
  - full-refresh includeAnalystData response section
  - stock research-bundle assertions for analyst fields
- tests/integration/api-watchlists-runtime.integration.test.ts
  - watchlist research-bundle assertions for analyst fields

## Documentation Updates

Updated docs:
- docs/providers.md
  - added analyst/discovery endpoint coverage and entitlement/no-data behavior notes
- docs/api.md
  - added analyst/discovery endpoints
  - added includeAnalystData full-refresh request/response documentation
  - added research-bundle analyst field notes

New docs:
- docs/agent/backend-tool-contracts.md
  - contracts for:
    - getTickerAnalystContext
    - refreshTickerAnalystData
    - refreshWatchlistAnalystData
    - getDiscoveryCandidates

## Validation and Execution Results (Post-DB Validation)

Environment confirmation:
- .env exists
- DATABASE_URL present
- TEST_DATABASE_URL not set; tests intentionally fallback to DATABASE_URL in src/test/test-db.ts
- Local PostgreSQL container running (ai-portfolio-db, localhost:5432)

Prisma and migration:
- npx prisma migrate status initially reported one unapplied migration:
  - 20260608110931_add_analyst_discovery_data
- npx prisma migrate dev --name add_analyst_discovery_data succeeded
- npx prisma generate succeeded
- Database is now in sync with prisma/schema.prisma

Targeted DB-backed validation (all pass):
- npx vitest tests/unit/analyst-ingestion.service.test.ts --run
  - 1 file, 4 tests passed
- npx vitest tests/unit/market-discovery.service.test.ts --run
  - 1 file, 3 tests passed
- npx vitest tests/integration/api-ingestion.integration.test.ts --run
  - 1 file, 19 tests passed
- npx vitest tests/integration/api-watchlists-runtime.integration.test.ts --run
  - 1 file, 3 tests passed

Full validation (all pass):
- npm run -s typecheck: PASS
- npx vitest --run: PASS
  - Test Files: 40 passed
  - Tests: 241 passed
- npm run build: PASS

Route registration runtime check:
- Started fresh dev server
- Called GET /api/dev/routes
- Confirmed route signatures present for:
  - POST /api/ingestion/fmp/ticker/:ticker/analyst
  - POST /api/ingestion/fmp/portfolio/:portfolioId/analyst
  - POST /api/ingestion/fmp/watchlist/:watchlistId/analyst
  - GET /api/analyst/:ticker/latest
  - GET /api/analyst/:ticker/actions
  - POST /api/discovery/fmp/:category/refresh
  - POST /api/discovery/fmp/default-set
  - GET /api/discovery/:category

Manual smoke results (runtime):
- POST /api/ingestion/fmp/ticker/AAPL/analyst
  - 200, success envelope true, warnings returned (no action events)
- GET /api/analyst/AAPL/latest
  - 200, success envelope true
- GET /api/analyst/AAPL/actions
  - 200, success envelope true
- POST /api/discovery/fmp/default-set
  - 200, success envelope true, warnings returned for empty categories
- GET /api/discovery/GAINERS
  - 200, success envelope true
- GET /api/stocks/AAPL/research-bundle
  - 200, success envelope true
- GET /api/watchlists/<generatedWatchlistId>/research-bundle
  - 200, success envelope true

Observed warning semantics (expected non-blocking behavior):
- Analyst warning example:
  - No analyst action events returned for ticker AAPL.
- Discovery warning examples:
  - ANALYST_UPGRADES: No discovery results returned for category ANALYST_UPGRADES.
  - ANALYST_DOWNGRADES: No discovery results returned for category ANALYST_DOWNGRADES.

Known limitations:
- TEST_DATABASE_URL remains unset in current local setup (tests still pass via fallback behavior).
- Prisma warns that package.json prisma config is deprecated (future Prisma 7 cleanup item).

## Files Added

- CONTEXT_LATEST_V19.md
- CONTEXT_LATEST_V18.md
- docs/agent/backend-tool-contracts.md
- prisma/migrations/20260608110931_add_analyst_discovery_data/migration.sql
- src/api/routes/analyst-ingestion.routes.ts
- src/api/routes/discovery.routes.ts
- src/api/schemas/analyst-ingestion.schemas.ts
- src/api/schemas/discovery.schemas.ts
- src/providers/fmp/fmp-analyst.provider.ts
- src/repositories/analyst-action-events.repository.ts
- src/repositories/analyst-snapshots.repository.ts
- src/repositories/market-discovery-snapshots.repository.ts
- src/services/analyst-ingestion.service.ts
- src/services/market-discovery.service.ts
- tests/unit/analyst-ingestion.service.test.ts
- tests/unit/fmp-analyst-provider.test.ts
- tests/unit/market-discovery.service.test.ts

## Files Updated (Primary)

- CONTEXT_LATEST.md
- docs/api.md
- docs/providers.md
- prisma/schema.prisma
- src/api/routes/index.ts
- src/api/routes/ingestion.routes.ts
- src/api/schemas/ingestion.schemas.ts
- src/providers/fmp/fmp.types.ts
- src/providers/fmp/index.ts
- src/providers/types.ts
- src/repositories/index.ts
- src/services/ai-reports.service.ts
- src/services/index.ts
- src/services/real-data-ingestion.service.ts
- src/services/stocks.service.ts
- src/services/watchlists.service.ts
- src/test/cleanup.ts
- src/types/services.ts
- tests/integration/api-ingestion.integration.test.ts
- tests/integration/api-watchlists-runtime.integration.test.ts
- tests/unit/ai-reports.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts

## Resume Checklist

1. Optional hardening:
  - Set TEST_DATABASE_URL explicitly to isolate test DB from dev DB.
2. Optional config maintenance:
  - Migrate Prisma configuration from package.json to prisma config file before Prisma 7.
3. For repeat validation:
   - npm run prisma:generate
   - npm run typecheck
   - npm test
   - npm run build
4. Commit strategy:
  - Group by layer (schema/provider/services/api/tests/docs/context) or squash as one feature commit per team preference.
