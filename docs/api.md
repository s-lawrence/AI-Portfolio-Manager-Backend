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

- `GET /health`
- `GET /health/db`

## Main Route Groups

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

## Development Helpers

- `GET /api/dev/demo-context`
- `POST /api/dev/seed-demo-market-data`
- `POST /api/dev/seed-demo-market-data?runAnalysis=true`
- `GET /api/dev/market-data-audit/<TICKER>`
- `POST /api/dev/purge-demo-analytical-data`
- `POST /api/dev/purge-demo-analytical-data/portfolio/<PORTFOLIO_CUID>`
- `POST /api/dev/purge-demo-analytical-data/ticker/<TICKER>`

Purpose:
- Returns seeded demo user, demo portfolio, and holdings for local frontend development.
- Seeds deterministic local fake market/news/fundamental/earnings data for demo holdings.
- Optionally runs portfolio analysis immediately when `runAnalysis=true`.
- Returns a market-data audit payload to diagnose latest-price selection issues for a ticker.
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
    "holdingId": "<HOLDING_CUID>"
  }'
```

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
- Each holding includes latest report summary fields when available:
  - `latestRecommendation`
  - `latestSentiment`
  - `latestConfidenceScore`
  - `latestRiskScore`
  - `latestReportDate`
- `estimatedMarketValue` is computed from OWNED holdings only, using `shares * latestPrice` when both are present.

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
- `includeBankOfCanada=false` skips BoC macro/FX and omits `bankOfCanada` from response.
- `includeFred=false` skips FRED macro and omits `fred` from response.
- If all macro flags are `false`, macro ingestion is skipped and `macro` is omitted.

Full-refresh response includes:

- `portfolioId`, `startedAt`, `finishedAt`, `durationMs`.
- `marketData` category result (including per-ticker failures).
- `fundamentals` category result (including per-ticker failures).
- `earnings` category result (including per-ticker failures).
- `news` category result (including per-ticker failures).
- optional `analysis` when `runAnalysis=true`.
- optional `economics` when `includeEconomics=true`.
- optional `bankOfCanada`, `fred`, and `macro` when macro flags are enabled.
- `warnings` aggregated across category-level partial failures.

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
