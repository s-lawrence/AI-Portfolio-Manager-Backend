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

Run market-data + fundamentals ingestion in one call (optional analysis):

```bash
curl -X POST http://localhost:4000/api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/full-basic \
  -H "Content-Type: application/json" \
  -d '{
    "historicalLimit": 250,
    "runAnalysis": false
  }'
```

Fundamentals ingestion responses include:

- `snapshotCreated` to indicate whether a new snapshot was stored.
- `fieldsPopulated` listing which provider fields were present.
- `warnings` for no-data scenarios or same-day duplicate snapshot skips.
