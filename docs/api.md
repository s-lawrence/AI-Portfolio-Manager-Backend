# API Guide

## Start The Backend

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Build and run production-style output:

```bash
npm run build
npm start
```

## Base URL

`http://localhost:4000`

## Health Endpoints

- `GET /api/health`
- `GET /api/health/dependencies`
- `GET /health` (legacy alias)
- `GET /health/db` (legacy DB check)

## Main Route Groups

- `/api/health`
- `/api/portfolios`
- `/api/holdings`
- `/api/stocks`
- `/api/ingestion`
- `/api/market-data`
- `/api/news`
- `/api/earnings`
- `/api/reports`
- `/api/portfolio-summaries`
- `/api/predictions`
- `/api/alerts`
- `/api/auth`
- `/api/agent`
- `/api/watchlists`
- `/api/analyst`
- `/api/discovery`
- `/api/geopolitical`

## Authentication (Beta)

Feature flag behavior:

- `AUTH_ENABLED=false` (default local mode): existing local/demo request flow remains available.
- `AUTH_ENABLED=true` (beta hosted mode): session cookie auth and account scoping are enforced.

Auth endpoints:

- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/dev-login` (non-production only)

`GET /api/auth/me` response envelope includes:

- `authEnabled`
- `authenticated`
- `user` (null when unauthenticated)

Session and cookie notes:

- Uses HTTP-only signed cookie session (`apm_session`).
- `SameSite` uses `AUTH_COOKIE_SAME_SITE` (`lax` default).
- `secure` uses `AUTH_COOKIE_SECURE` when set; otherwise defaults to `true` in production and `false` in non-production.
- `AUTH_COOKIE_SAME_SITE=none` requires `AUTH_COOKIE_SECURE=true`.
- Google access tokens are not persisted.

Scoped-access behavior when `AUTH_ENABLED=true`:

- Portfolio, holding, watchlist, report, agent execution/chat context, and refresh/mutation routes enforce authenticated ownership checks.
- User identity is derived from authenticated session.
- Supplied `userId` values in request payload/route must match session identity (or are rejected).

Local-dev compatibility when `AUTH_ENABLED=false`:

- Existing explicit `userId` request flows remain supported.
- This preserves current demo/local workflows.

## Development Helpers

- `GET /api/dev/routes`
- `GET /api/dev/demo-context`
- `POST /api/dev/seed-demo-market-data`
- `POST /api/dev/seed-demo-market-data?runAnalysis=true`
- `GET /api/dev/market-data-audit/<TICKER>`
- `GET /api/dev/fmp/analyst-audit/<TICKER>`
- `GET /api/dev/gdelt/query-audit?query=<TEXT>&maxRecords=<N>`
- `POST /api/dev/purge-demo-analytical-data`
- `POST /api/dev/purge-demo-analytical-data/portfolio/<PORTFOLIO_CUID>`
- `POST /api/dev/purge-demo-analytical-data/ticker/<TICKER>`

Purpose:
- Returns seeded demo user, demo portfolio, and holdings for local frontend development.
- Seeds deterministic local fake market/news/fundamental/earnings data for demo holdings.
- Optionally runs portfolio analysis immediately when `runAnalysis=true`.
- Returns a market-data audit payload to diagnose latest-price selection issues for a ticker.
- Returns an analyst provider audit payload showing endpoint attempts, selected source, and mapping diagnostics.
- Returns a GDELT query audit payload with raw-shape diagnostics and mapped-count summary.
- Purges demo/local analytical rows while preserving users, portfolios, holdings, stocks, and preferences.

Availability:
- Development and test environments only.
- Not available in production (`NODE_ENV=production`).

Example:

```bash
curl http://localhost:4000/api/dev/demo-context
```

```bash
curl -X POST http://localhost:4000/api/dev/seed-demo-market-data
```

```bash
curl -X POST "http://localhost:4000/api/dev/seed-demo-market-data?runAnalysis=true"
```

```bash
curl http://localhost:4000/api/dev/market-data-audit/AAPL
```

```bash
curl http://localhost:4000/api/dev/fmp/analyst-audit/AAPL
```

```bash
curl "http://localhost:4000/api/dev/gdelt/query-audit?query=geopolitical%20risk&maxRecords=5"
```

```bash
curl -X POST http://localhost:4000/api/dev/purge-demo-analytical-data \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL"}'
```

`GET /api/dev/market-data-audit/<TICKER>` includes:

- `selectedLatestSnapshot`: canonical latest snapshot currently used by backend consumers.
- `latestByCapturedAt`: top 10 snapshots ordered by `capturedAt desc, createdAt desc`.
- `latestByCreatedAt`: top 10 snapshots ordered by `createdAt desc, capturedAt desc`.
- `fmpQuoteCheck`: optional live provider quote check (safe error summary, no API key exposure).
- `source`: persisted source marker when available (for example `FMP_QUOTE`, `FMP_HISTORICAL`, `DEMO`).

`POST /api/dev/purge-demo-analytical-data*` response includes deletion counts:

- `priceSnapshotsDeleted`
- `fundamentalSnapshotsDeleted`
- `earningsEventsDeleted`
- `newsArticlesDeleted`
- `aiReportsDeleted`
- `predictionsDeleted`
- `portfolioSummariesDeleted`
- `alertsDeleted`
- `warnings`

## Agent Endpoints

- `GET /api/agent/tools`
- `POST /api/agent/tools/:toolName/execute`
- `POST /api/agent/chat`

Current data-quality and scoring tools include:

- `scoreWatchlist` (returns `totalItems`, `activeItemsCount`, `scoredItemsCount`, `skippedItemsCount`, `skippedItems`, `rankedItems`)
- `getTickerDataQuality`
- `getWatchlistDataQuality`
- `getPortfolioDataQuality`
- `rankDiscoveryCandidates` (ranks persisted discovery candidates for potential new holdings)

Refresh tools that require confirmation include:

- `refreshWatchlistResearchData`
- `refreshTickerAnalystData`
- `refreshUsdCadFxRate`

Mutation tools that require confirmation include:

- `generateTickerReport`

Agent suggested-action behavior includes:

- Suggest `refreshWatchlistResearchData` when watchlist score/data-quality coverage is weak.
- Suggest `refreshTickerAnalystData` when ticker data-quality indicates analyst/data gaps.
- Prefer `refreshUsdCadFxRate` when portfolio outputs show missing FX coverage.
- For new-holding discovery flows with ranked candidates and a provided `watchlistId`, suggest confirmation-gated `addTickerToWatchlist` actions for top non-tracked names.

`POST /api/agent/chat` behavior:

- Uses OpenAI planner first (when enabled) to interpret natural language and propose tool calls.
- Validates planned tool names and inputs against backend registry and Zod schemas.
- Executes approved backend tools only through the agent tool registry/executor.
- Requires confirmation gates for refresh/mutation/high-impact tools.
- Uses OpenAI synthesis on tool results after validated execution.
- For new-holding candidate prompts, plans `rankDiscoveryCandidates` plus portfolio risk/quality context when portfolio scope is available.
- Uses persisted backend discovery/scoring data as the source of named candidates (no OpenAI-generated ticker invention).
- Tool execution remains backend-controlled and confirmation policy is unchanged.
- No background autonomous OpenAI loops are used; OpenAI calls only happen inline during the request.

Agent chat request example:

```bash
curl -X POST http://localhost:4000/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Research AAPL",
    "context": {
      "source": "USER",
      "portfolioId": "optional",
      "watchlistId": "optional",
      "ticker": "optional"
    },
    "confirmedToolExecutions": ["optional tool names"],
    "confirmedToolInputs": {
      "optionalToolName": {
        "input": "override"
      }
    },
    "maxToolCalls": 5,
    "allowRefresh": false,
    "allowMutation": false,
    "dryRun": false
  }'
```

When `AUTH_ENABLED=true`, agent routes derive `context.userId` from session and enforce portfolio/watchlist ownership before tool execution.

OpenAI synthesis enablement:

- `OPENAI_AGENT_PROVIDER_ENABLED=true`
- `OPENAI_API_KEY` present in backend environment
- optional `OPENAI_AGENT_MODEL_FALLBACK` for unsupported/unavailable primary model
- optional `OPENAI_AGENT_MAX_COMPLETION_TOKENS` to bound completion size/cost
- optional `OPENAI_DAILY_REQUEST_LIMIT_PER_USER` and `OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL`

Fallback behavior:

- If planner fails, deterministic router fallback is used.
- If synthesis fails after planning, deterministic answer fallback is used with tool summaries.
- If OpenAI is disabled, deterministic router mode is used directly.
- If OpenAI usage limits are reached, deterministic router mode is used directly.
- Chat metadata includes:
  - `mode` (`OPENAI_PLANNED_SYNTHESIS`, `OPENAI_SYNTHESIS`, or `DETERMINISTIC_ROUTER`)
  - `modelName` when OpenAI path is attempted
  - `fallbackUsed`
  - `plannerUsed`
  - `plannerFallbackUsed`
  - `plannedToolCount`
  - `executedToolCount`
  - `droppedToolCount`
  - `effectiveMaxToolCalls`
  - `fallbackReason` (optional)

Non-production fallback diagnostics:

- On OpenAI fallback in non-production, metadata may include `openAiDiagnostics` with safe fields only:
  - `openAiAttempted`
  - `openAiFailureStage`
  - `openAiErrorCode`
  - `openAiStatus`
  - `openAiResponsePreview` (redacted, max 200 chars)
  - `openAiModelName`

## Example cURL Commands

Create portfolio:

```bash
curl -X POST http://localhost:4000/api/portfolios \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<USER_CUID>",
    "name": "Core Growth",
    "description": "Primary strategy portfolio",
    "baseCurrency": "USD"
  }'
```

Add holding:

```bash
curl -X POST http://localhost:4000/api/holdings \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioId": "<PORTFOLIO_CUID>",
    "ticker": "AAPL",
    "status": "OWNED",
    "shares": 20,
    "averageCost": 165
  }'
```

Holding-create ambiguity warnings:

- `POST /api/holdings` now returns `data.warnings`.
- One-character/short ambiguous tickers (for example `E`, `F`, `T`) include:
  - `Ticker <SYMBOL> is ambiguous; verify security mapping.`
- The holding is still created so imports remain non-blocking, but mapping should be reviewed/corrected.

Search stock/security candidates for symbol correction:

```bash
curl "http://localhost:4000/api/stocks/search?query=E"
```

- `GET /api/stocks/search` behavior:
  - searches local `Stock` records by `ticker` and `companyName` first
  - optionally augments with provider candidates when FMP is configured
  - returns bounded `candidates[]` with:
    - `stockId` (when local record exists)
    - `ticker`
    - `companyName`
    - `exchange`
    - `currency`
    - `country`
    - `provider`
    - `matchType` (`LOCAL` | `PROVIDER`)
    - `confidence` (`HIGH` | `MEDIUM` | `LOW`)
- Short symbols remain candidate-based (no implicit auto-selection).

Correct a holding to a different linked security:

```bash
curl -X PATCH http://localhost:4000/api/holdings/<HOLDING_CUID>/stock \
  -H "Content-Type: application/json" \
  -d '{
    "stockId": "<STOCK_CUID>"
  }'
```

or

```bash
curl -X PATCH http://localhost:4000/api/holdings/<HOLDING_CUID>/stock \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "ENB.TO",
    "companyName": "Enbridge Inc",
    "exchange": "TSX",
    "currency": "CAD",
    "provider": "FMP",
    "refreshAfterCorrection": false
  }'
```

- `PATCH /api/holdings/<HOLDING_CUID>/stock`:
  - accepts either `stockId` or `ticker` input (not both)
  - preserves holding quantity/cost/thesis fields
  - reassigns `holding.stockId` to selected/created stock identity
  - returns `holdingOverview` for the corrected holding
  - returns `warnings` including market-data refresh guidance
  - includes warning: `Market data should be refreshed for corrected ticker.`
  - when `refreshAfterCorrection=true`, attempts bounded ticker market/fundamental refresh and returns non-blocking warnings on failures

Auth/scoping note:

- When `AUTH_ENABLED=true`, correction is ownership-scoped; users cannot reassign holdings they do not own.

Record market snapshot:

```bash
curl -X POST http://localhost:4000/api/market-data/AAPL/snapshots \
  -H "Content-Type: application/json" \
  -d '{
    "price": 193.22,
    "previousClose": 190.11,
    "volume": 52300000
  }'
```

Generate ticker report:

```bash
curl -X POST http://localhost:4000/api/reports/AAPL/generate \
  -H "Content-Type: application/json" \
  -d '{
    "holdingId": "<HOLDING_CUID>",
    "portfolioId": "<OPTIONAL_PORTFOLIO_CUID>",
    "watchlistId": "<OPTIONAL_WATCHLIST_CUID>",
    "useOpenAi": true,
    "refreshBeforeGenerate": false,
    "includeMacro": true,
    "includeGeopolitical": true,
    "includeNews": true,
    "includeAnalyst": true,
    "includeScore": true,
    "createPredictions": true
  }'
```

`POST /api/reports/<TICKER>/generate` notes:

- Uses local persisted research context for report generation.
- If `useOpenAi=true`, backend attempts OpenAI structured generation first, then falls back to deterministic generation on disable/failure.
- If `refreshBeforeGenerate=true`, backend performs bounded per-ticker refresh attempts before building report context.
- Response includes generation metadata:
  - `reportMode` (`OPENAI_STRUCTURED` or `DETERMINISTIC_FALLBACK`)
  - `fallbackUsed`
  - `warnings[]`
  - `dataGaps[]`
  - `modelName` (when available)
- When `AUTH_ENABLED=true`, optional `portfolioId` and `watchlistId` are ownership-checked against the authenticated user.

Report payload metadata:

- `GET /api/reports/<TICKER>/latest`
- `GET /api/reports/<TICKER>`

Each returned report item includes flattened stock metadata fields:

- `ticker`
- `companyName`
- `exchange`
- `currency`
- `sector`
- `industry`

Generate portfolio summary:

```bash
curl -X POST http://localhost:4000/api/portfolio-summaries/<PORTFOLIO_CUID>/generate
```

Run portfolio analysis orchestration:

```bash
curl -X POST http://localhost:4000/api/portfolios/<PORTFOLIO_CUID>/run-analysis
```

Portfolio overview payload:

- `GET /api/portfolios/<PORTFOLIO_CUID>` now returns per-holding summary fields for dashboard cards.
- Each holding includes latest market data when available:
  - `latestPrice`
  - `latestPriceCapturedAt`
  - `dailyChangePercent`
  - `previousClose`
  - `volume`
  - `marketCap`
  - `currency`
  - `exchange`
- Each holding includes valuation fields in native currency:
  - `nativeCurrency`
  - `latestPriceNative`
  - `marketValueNative`
  - `costBasisNative`
  - `unrealizedGainLossNative`
  - `unrealizedGainLossPercent`
- Each holding includes CAD conversion metadata and values:
  - `cadFxRate`
  - `cadFxRateSource`
  - `cadFxRateCapturedAt`
  - `marketValueCad`
  - `costBasisCad`
  - `unrealizedGainLossCad`
  - `conversionStatus` (`DIRECT_CAD`, `CONVERTED`, `MISSING_FX`, `UNSUPPORTED_CURRENCY`)
- Compatibility valuation fields remain in native currency:
  - `latestPrice`
  - `marketValue`
  - `costBasis`
  - `unrealizedGainLoss`
- Each holding includes latest report summary fields when available:
  - `latestRecommendation`
  - `latestSentiment`
  - `latestConfidenceScore`
  - `latestRiskScore`
  - `latestReportDate`
- `estimatedMarketValue` is computed from OWNED holdings only, using `shares * latestPrice` when both are present.
- Portfolio-level CAD totals and FX metadata:
  - `portfolioBaseCurrency` (current portfolio intelligence valuation currency, `CAD`)
  - `totalMarketValueNative` (only populated for single-currency OWNED holdings)
  - `totalMarketValueCad`
  - `totalCostBasisCad`
  - `totalUnrealizedGainLossCad`
  - `totalUnrealizedGainLossPercentCad`
  - `fxRateUsed` (`USD/CAD` pair metadata when conversion occurred)
  - `holdingsMissingFx` (OWNED holdings excluded from CAD totals due to missing USD/CAD rate)
  - `holdingsUnsupportedCurrency` (OWNED holdings excluded from CAD totals due to unsupported currency)

Holding overview payload:

- `GET /api/holdings/<HOLDING_CUID>` includes the same native and CAD valuation fields as portfolio holdings.
- USD/CAD conversion convention is: `baseCurrency = USD`, `quoteCurrency = CAD`, `rate = CAD per 1 USD`.

Canonical latest market snapshot selection:

- Backend consumers now use one shared selector for latest market data.
- Source priority is applied first: `FMP_QUOTE` > `FMP_HISTORICAL` > other non-demo sources > `null` > `DEMO`.
- Primary ordering is newest `capturedAt`.
- If `capturedAt` ties, intraday timestamps are preferred over midnight-only records.
- Remaining ties are broken by newest `createdAt`, then stable id order.
- This selector is used consistently by:
  - `GET /api/market-data/<TICKER>/latest`
  - `GET /api/stocks/<TICKER>/research-bundle`
  - `GET /api/portfolios/<PORTFOLIO_CUID>` per-holding latest fields
  - Report generation paths that rely on latest market snapshot

Research bundle technical snapshot fields:

- `GET /api/stocks/<TICKER>/research-bundle` returns `latestTechnicalSnapshot` with canonical persisted fields such as:
  - `sma20`, `sma50`, `sma200`
  - `rsi14`
  - `macd`, `macdSignal`, `macdHistogram`
  - `trendDirection`
  - `capturedAt`
- Compatibility aliases are also included in the response:
  - `ma50` (alias of `sma50`)
  - `ma200` (alias of `sma200`)
  - `rsi` (alias of `rsi14`)
- `volatility` is projected as annualized 30-trading-day close log-return volatility.
- Value format is a decimal fraction (for example `0.22` means 22%).
- Canonical backend field for RSI remains `rsi14`.

Research bundle analyst fields:

- `GET /api/stocks/<TICKER>/research-bundle` also returns:
  - `latestAnalystSnapshot`
  - `recentAnalystActions`
- `GET /api/watchlists/<WATCHLIST_CUID>/research-bundle` includes per-item analyst fields:
  - `latestAnalystSnapshot`
  - `recentAnalystActions`
  - `discoveryContext` (when available for screener/agent-origin items)

Prediction list payloads:

- `GET /api/predictions/open`
- `GET /api/predictions/due`
- `GET /api/predictions/stock/<TICKER>`

Each prediction item includes stock metadata fields:

- `ticker`
- `companyName`
- `exchange`
- `currency`

Each prediction item also includes computed `dueDate` (UTC-based, not persisted):

- `ONE_DAY` => `predictionDate + 1 day`
- `ONE_WEEK` => `predictionDate + 7 days`
- `ONE_MONTH` => `predictionDate + 30 days`

Ingest real market data for one ticker from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/ticker/AAPL/market-data \
  -H "Content-Type: application/json" \
  -d '{
    "historicalLimit": 250
  }'
```

Ingest real market data for all holdings in a portfolio from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/market-data \
  -H "Content-Type: application/json" \
  -d '{
    "historicalLimit": 250,
    "runAnalysis": true
  }'
```

Ingest fundamentals for one ticker from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/ticker/AAPL/fundamentals \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ingest fundamentals for all holdings in a portfolio from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/fundamentals \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ingest earnings for one ticker from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/ticker/AAPL/earnings \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ingest earnings for all holdings in a portfolio from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/earnings \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ingest company news for one ticker from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/ticker/AAPL/news \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 30
  }'
```

Ingest company news for all holdings in a portfolio from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/news \
  -H "Content-Type: application/json" \
  -d '{
    "limitPerTicker": 20
  }'
```

Ingest analyst data for one ticker from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/ticker/AAPL/analyst \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ingest analyst data for all holdings in a portfolio from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/analyst \
  -H "Content-Type: application/json" \
  -d '{}'
```

Ingest analyst data for all items in a watchlist from FMP:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/watchlist/<WATCHLIST_CUID>/analyst \
  -H "Content-Type: application/json" \
  -d '{}'
```

Read latest analyst context:

```bash
curl http://localhost:4000/api/analyst/AAPL/latest
```

```bash
curl "http://localhost:4000/api/analyst/AAPL/actions?limit=20"
```

Analyst ingestion/read responses include subsource diagnostics when available:

- `priceTargetSummaryStatus`
- `priceTargetConsensusStatus`
- `gradesConsensusStatus`
- `gradesHistoricalStatus`
- `gradesStatus`
- `analystEstimatesStatus`
- `ratingsSnapshotStatus`
- `analystRatingsStatus`
- `analystActionsStatus`
- `subsourceWarnings`

Compatibility aliases:

- `analystRatingsStatus` mirrors `gradesConsensusStatus`
- `analystActionsStatus` mirrors `gradesStatus`

Status values are `SUCCESS`, `EMPTY`, `ENTITLEMENT`, `ERROR`, or `SKIPPED`.

Refresh and read discovery candidates:

```bash
curl -X POST http://localhost:4000/api/discovery/fmp/GAINERS/refresh \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'
```

```bash
curl -X POST http://localhost:4000/api/discovery/fmp/default-set \
  -H "Content-Type: application/json" \
  -d '{"limit": 25}'
```

```bash
curl "http://localhost:4000/api/discovery/GAINERS?limit=25"
```

```bash
curl "http://localhost:4000/api/discovery/GAINERS?minPrice=5&maxChangePercent=300&excludeOtc=true"
```

Discovery list filtering parameters:

- `minPrice`
- `minVolume`
- `minMarketCap`
- `maxChangePercent` (applies to absolute percentage change)
- `exchanges` (CSV or repeated query usage)
- `excludeOtc`
- `excludeLowPrice`

Default list guards when omitted:

- `minPrice=5`
- `maxChangePercent=300`
- `excludeOtc=true`

Ingest geopolitical/news-event context for one query from GDELT:

```bash
curl -X POST http://localhost:4000/api/ingestion/gdelt/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "war OR sanctions",
    "from": "2026-06-01T00:00:00.000Z",
    "to": "2026-06-08T00:00:00.000Z",
    "maxRecords": 25
  }'
```

Ingest geopolitical/news-event context using the default global-risk query set:

```bash
curl -X POST http://localhost:4000/api/ingestion/gdelt/default-risk-set \
  -H "Content-Type: application/json" \
  -d '{
    "maxRecordsPerQuery": 25,
    "mode": "quick"
  }'
```

`mode` options:

- `quick`: smaller default query subset intended for routine refreshes.
- `full`: full default global-risk query set.

Default response includes:

- `queriesProcessed`
- `queriesFailed`
- `eventsCreated`
- `eventsUpdated`
- `eventsSkipped`
- `failedQueries[]` with `query`, `reason`, optional `failureCode`, optional `statusCode`, optional `retryAttempted`
- `warnings[]`
- `durationMs`
- optional `queryProfiles[]`
- optional `responseDiagnostics[]` in non-production only

GDELT failure codes:

- `GDELT_HTTP_ERROR`
- `GDELT_TIMEOUT`
- `GDELT_NON_JSON_RESPONSE`
- `GDELT_EMPTY_RESPONSE`
- `GDELT_PARSE_ERROR`
- `GDELT_NO_RESULTS`

Notes:

- Non-JSON/empty/malformed provider responses are classified and returned as safe diagnostics.
- Raw HTML bodies are never emitted as direct API error messages.

Read latest geopolitical events and summary:

```bash
curl "http://localhost:4000/api/geopolitical/latest?limit=20"
```

```bash
curl "http://localhost:4000/api/geopolitical/summary?days=7"
```

`GET /api/geopolitical/summary` returns persisted local context only.

- If local event storage is empty for the requested window, response includes a `message` explaining that no persisted GDELT events are available locally.
- Empty local storage does not imply global risk is absent.
- Response includes `suggestedActions` with an actionable refresh suggestion (`refreshGdeltRiskContext`).

Earnings ingestion responses include:

- `eventsCreated` count of inserted earnings events.
- `eventsUpdated` count of matched existing events updated.
- `nextEarningsDate` from the nearest upcoming stored earnings event when available.
- `warnings` for no-data scenarios.

FMP earnings provider source details used by backend ingestion:

- Ticker earnings source: `/stable/earnings?symbol=<TICKER>&limit=<N>`
- Calendar source: `/stable/earnings-calendar?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>&page=<N>`
- Supported mapped fields: `date`, `epsActual`, `epsEstimated`, `revenueActual`, `revenueEstimated`, `lastUpdated`.
- Calendar limitation: max 90-day range per request.
- Fiscal quarter and earnings time may be unavailable in these stable endpoint payloads.

News ingestion responses include:

- `articlesCreated` count of newly inserted articles.
- `articlesUpdated` count of existing URL-keyed articles updated.
- `articlesSkipped` count of invalid/ignored records.
- `warnings` for no-data scenarios.

Run market-data + fundamentals ingestion in one call (optional analysis):

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/full-basic \
  -H "Content-Type: application/json" \
  -d '{
    "historicalLimit": 250,
    "runAnalysis": false
  }'
```

Run full FMP portfolio refresh in one call (market-data + fundamentals + earnings + news + optional analysis):

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/full-refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshMode": "quick",
    "historicalLimit": 120,
    "newsLimitPerTicker": 12,
    "includeAnalystData": true,
    "includeGdelt": true,
    "gdeltMaxRecordsPerQuery": 25,
    "gdeltLookbackDays": 7,
    "includeEconomics": false,
    "includeBankOfCanada": false,
    "includeFred": false,
    "economicsCalendarPastDays": 7,
    "economicsCalendarFutureDays": 30,
    "fredObservationLimit": 120,
    "bocObservationLimit": 120,
    "macroMaxSeries": 6,
    "runAnalysis": true
  }'
```

Full-refresh request options:

- `refreshMode`: optional, one of `quick` or `full` (default `quick`).
- `includeAnalystData`: optional boolean (default `false`).
- `includeGdelt`: optional boolean (default `false`).
- `gdeltMaxRecordsPerQuery`: optional integer limit for each default GDELT query when `includeGdelt=true`.
- `gdeltLookbackDays`: optional integer lookback window for GDELT ingestion when `includeGdelt=true`.
- `includeEconomics`: optional boolean (default `false`).
- `includeBankOfCanada`: optional boolean (default `false`).
- `includeFred`: optional boolean (default `false`).
- `economicsCalendarPastDays`: optional integer, calendar lookback window.
- `economicsCalendarFutureDays`: optional integer, calendar lookahead window.
- `fredObservationLimit`: optional integer limit for per-series FRED observations.
- `bocObservationLimit`: optional integer limit for BoC USD/CAD observations.
- `macroMaxSeries`: optional integer to cap number of default FRED series processed.

Include-flag semantics:

- `includeEconomics=false` skips FMP economics and omits `economics` from response.
- `includeAnalystData=false` skips analyst ingestion and omits `analystData` from response.
- `includeGdelt=false` skips GDELT ingestion and omits `geopolitical` from response.
- When `includeGdelt=true`, full-refresh uses `mode=quick` for default GDELT query ingestion.
- GDELT query failures remain non-blocking and are preserved in `geopolitical.failedQueries`.
- `includeBankOfCanada=false` skips BoC macro/FX and omits `bankOfCanada` from response.
- `includeFred=false` skips FRED macro and omits `fred` from response.
- If all macro flags are `false`, macro ingestion is skipped and `macro` is omitted.

Full-refresh response includes:

- `portfolioId`, `startedAt`, `finishedAt`, `durationMs`.
- `marketData` category result (including per-ticker failures).
- `fundamentals` category result (including per-ticker failures).
- `earnings` category result (including per-ticker failures).
- `news` category result (including per-ticker failures).
- optional `analystData` when `includeAnalystData=true`.
- optional `analystWarningsSummary` when `includeAnalystData=true`.
- optional `geopolitical` when `includeGdelt=true`.
- optional `analysis` when `runAnalysis=true`.
- optional `economics` when `includeEconomics=true`.
- optional `bankOfCanada`, `fred`, and `macro` when macro flags are enabled.
- `warnings` aggregated across category-level partial failures.

Analyst warning aggregation (`includeAnalystData=true`):

- `analystData.warnings` is UI-facing and bounded (summarized, not per-endpoint spam).
- `analystData.rawWarnings` preserves detailed raw per-ticker/per-endpoint messages.
- `analystData.analystWarningsSummary` includes:
  - `entitlementIssuesCount`
  - `noDataCount`
  - `noRecordsCount`
  - `affectedTickers`
  - `examples`
- When FMP plan entitlement gaps are detected, warning wording is:
  - `Analyst data unavailable for some tickers under current FMP plan.`

Timing fields:

- Each executed section includes `durationMs`.
- `marketData`, `fundamentals`, `earnings`, `news`, `economics`, `bankOfCanada`, `fred`, `macro`, and `analysis` (when present) include timing metadata.

Each full-refresh category result includes:

- `tickersProcessed`
- `tickersFailed`
- `results`
- `failedTickers`
- `durationMs`

FMP economics ingestion endpoints:

- `POST /api/ingestion/fmp/economics/treasury-rates`
- `POST /api/ingestion/fmp/economics/indicators`
- `POST /api/ingestion/fmp/economics/calendar`
- `POST /api/ingestion/fmp/economics/market-risk-premium`
- `POST /api/ingestion/fmp/economics/default-set`

Example economics requests:

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/economics/treasury-rates \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-01-01",
    "to": "2026-06-03",
    "limit": 100
  }'
```

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/economics/calendar \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-06-01",
    "to": "2026-07-01"
  }'
```

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/economics/default-set \
  -H "Content-Type: application/json" \
  -d '{
    "includeTreasuryRates": true,
    "includeCalendar": true,
    "includeMarketRiskPremium": true,
    "includeIndicators": false
  }'
```

Economics ingestion default-set result includes:

- `startedAt`, `finishedAt`
- `treasuryRates`, `economicIndicators`, `economicCalendar`, `marketRiskPremium`
- each section includes `recordsCreated`, `recordsUpdated`, `recordsSkipped`, and `warnings`
- `warnings` aggregates section-level failures while allowing partial completion

Macro/FX ingestion endpoints (BoC/FRED):

- `POST /api/ingestion/macro/boc/usd-cad`
- `POST /api/ingestion/macro/boc/series/<SERIES_ID>`
- `POST /api/ingestion/macro/fred/<SERIES_ID>`
- `POST /api/ingestion/macro/fred/default-set`
- `POST /api/ingestion/macro/default`

Macro ingestion request body:

- `from` optional date string `YYYY-MM-DD`
- `to` optional date string `YYYY-MM-DD`
- `limit` optional max records per series

Example macro requests:

```bash
curl -X POST http://localhost:4000/api/ingestion/macro/boc/usd-cad \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-06-01",
    "to": "2026-06-30",
    "limit": 100
  }'
```

```bash
curl -X POST http://localhost:4000/api/ingestion/macro/fred/default-set \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-06-01",
    "to": "2026-06-30"
  }'
```

```bash
curl -X POST http://localhost:4000/api/ingestion/macro/default \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-06-01",
    "to": "2026-06-30"
  }'
```

`POST /api/ingestion/macro/default` response includes:

- `startedAt`, `finishedAt`
- `bankOfCanada` section (`recordsCreated`, `recordsUpdated`, `recordsSkipped`, `warnings`, optional `failedSeries`)
- `fred` section (`recordsCreated`, `recordsUpdated`, `recordsSkipped`, `warnings`, optional `failedSeries`)
- `warnings` aggregated across sections

Fundamentals ingestion responses include:

- `snapshotCreated` to indicate whether a new snapshot was stored.
- `snapshotUpdated` to indicate whether an existing same-day snapshot was refreshed.
- `snapshotSkipped` only when no provider fundamentals were returned.
- `fieldsPopulated` listing which provider fields were present.
- `warnings` for real issues only (for example no provider data or provider failures).

Portfolio fundamentals responses also include:

- `snapshotsCreated`
- `snapshotsUpdated`
- `snapshotsSkipped`

Same-day fundamentals idempotency behavior:

- Re-running fundamentals ingestion on the same UTC day updates the existing same-day snapshot with latest provider values.
- No duplicate same-day fundamental snapshots are created.

Price snapshot source conventions:

- FMP quote snapshots: `source = "FMP_QUOTE"`
- FMP historical snapshots: `source = "FMP_HISTORICAL"`
- Demo/local fake snapshots: `source = "DEMO"`

Market-data ingestion historical behavior:

- Historical rows are upserted by stock + UTC date-day (not exact timestamp-only matching).
- Existing same-day rows are updated to FMP historical values and tagged `FMP_HISTORICAL`.
- Response includes:
  - `historicalSnapshotsCreated`
  - `historicalSnapshotsUpdated`
  - `historicalSnapshotsSkipped`

Fundamentals value convention:

- Valuation/ratio fields are plain numbers (for example `peRatio=31.4`, `priceToSales=8.4`).
- `peRatio` is sourced from stable ratios (`priceToEarningsRatio`) when available.
- `pegRatio` is sourced from stable ratios (`priceToEarningsGrowthRatio`).
- `evToEbitda` prefers stable key metrics (`evToEBITDA`) and falls back to ratios (`enterpriseValueMultiple`).
- `debtToEquity` is sourced from stable ratios (`debtToEquityRatio`) with balance-sheet fallback when needed.
- Percent-like fields are stored as decimal fractions:
  - `revenueGrowth=0.054` means 5.4%
  - `grossMargin=0.462` means 46.2%
  - `operatingMargin=0.287` means 28.7%
  - `netMargin=0.252` means 25.2%
  - `dividendYield=0.005` means 0.5%
- `dividendYieldPercentage` is only used when `dividendYield` is missing, and is converted to decimal fraction.
- `forwardPeRatio` intentionally remains null until a true forward P/E source is wired.

Upcoming earnings endpoint behavior:

- `GET /api/earnings/portfolio/<PORTFOLIO_CUID>/upcoming` returns only useful upcoming events.
- Placeholder/blank events are excluded.
- When no useful upcoming earnings exist, the endpoint returns an empty list (`[]`).
