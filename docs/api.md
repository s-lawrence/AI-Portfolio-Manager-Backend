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
- `/api/market-data`
- `/api/news`
- `/api/earnings`
- `/api/reports`
- `/api/portfolio-summaries`
- `/api/predictions`
- `/api/alerts`

## Development Helpers

- `GET /api/dev/demo-context`

Purpose:
- Returns seeded demo user, demo portfolio, and holdings for local frontend development.

Availability:
- Development and test environments only.
- Not available in production (`NODE_ENV=production`).

Example:

```bash
curl http://localhost:4000/api/dev/demo-context
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
