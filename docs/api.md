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

Purpose:
- Returns seeded demo user, demo portfolio, and holdings for local frontend development.
- Seeds deterministic local fake market/news/fundamental/earnings data for demo holdings.
- Optionally runs portfolio analysis immediately when `runAnalysis=true`.

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
    "historicalLimit": 250,
    "newsLimitPerTicker": 20,
    "runAnalysis": true
  }'
```

Full-refresh response includes:

- `portfolioId`, `startedAt`, `finishedAt`.
- `marketData` category result (including per-ticker failures).
- `fundamentals` category result (including per-ticker failures).
- `earnings` category result (including per-ticker failures).
- `news` category result (including per-ticker failures).
- optional `analysis` when `runAnalysis=true`.
- `warnings` aggregated across category-level partial failures.

Each full-refresh category result includes:

- `tickersProcessed`
- `tickersFailed`
- `results`
- `failedTickers`

Fundamentals ingestion responses include:

- `snapshotCreated` to indicate whether a new snapshot was stored.
- `fieldsPopulated` listing which provider fields were present.
- `warnings` for no-data scenarios or same-day duplicate snapshot skips.

Fundamentals value convention:

- Valuation/ratio fields are plain numbers (for example `peRatio=31.4`, `priceToSales=8.4`).
- Percent-like fields are stored as decimal fractions:
  - `revenueGrowth=0.054` means 5.4%
  - `grossMargin=0.462` means 46.2%
  - `operatingMargin=0.287` means 28.7%
  - `netMargin=0.252` means 25.2%
  - `dividendYield=0.005` means 0.5%

Upcoming earnings endpoint behavior:

- `GET /api/earnings/portfolio/<PORTFOLIO_CUID>/upcoming` returns only useful upcoming events.
- Placeholder/blank events are excluded.
- When no useful upcoming earnings exist, the endpoint returns an empty list (`[]`).
