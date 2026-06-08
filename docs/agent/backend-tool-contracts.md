# Backend Tool Contracts

This document defines backend-facing contracts for agent tools that need analyst and discovery context.

## Conventions

- All tool responses should preserve backend envelope semantics when mapped from API routes:
  - Success: `{ success: true, data: ... }`
  - Error: `{ success: false, error: { code, message, details? } }`
- Tickers are uppercase and normalized by backend rules.
- Empty/no-data cases return successful responses with null/empty lists unless explicitly noted.

## getTickerAnalystContext

Purpose:
- Fetch latest analyst snapshot and recent analyst actions for one ticker.

Recommended backend calls:
- `GET /api/analyst/:ticker/latest`
- `GET /api/analyst/:ticker/actions?limit=<N>`

Input:

```json
{
  "ticker": "AAPL",
  "limit": 20
}
```

Output:

```json
{
  "ticker": "AAPL",
  "latestAnalystSnapshot": {
    "priceTargetConsensus": 215,
    "ratingConsensus": "BUY",
    "analystCount": 30
  },
  "recentAnalystActions": []
}
```

Failure behavior:
- If latest snapshot is missing, treat as no-data context and return null snapshot with empty actions.
- If actions endpoint fails but latest succeeds, return latest snapshot and empty actions plus warning metadata.

## refreshTickerAnalystData

Purpose:
- Trigger provider ingestion for one ticker analyst context.

Recommended backend call:
- `POST /api/ingestion/fmp/ticker/:ticker/analyst`

Input:

```json
{
  "ticker": "AAPL"
}
```

Output:

```json
{
  "ticker": "AAPL",
  "snapshotsCreated": 1,
  "snapshotsUpdated": 0,
  "actionsCreated": 2,
  "actionsUpdated": 0,
  "warnings": []
}
```

Failure behavior:
- Provider entitlement/no-data issues should surface as warnings where possible.
- Hard validation/storage errors should return backend error envelope.

## refreshWatchlistAnalystData

Purpose:
- Trigger analyst ingestion for all tickers in one watchlist.

Recommended backend call:
- `POST /api/ingestion/fmp/watchlist/:watchlistId/analyst`

Input:

```json
{
  "watchlistId": "ckxxxxxxxxxxxxxxxxxxxx"
}
```

Output:

```json
{
  "watchlistId": "ckxxxxxxxxxxxxxxxxxxxx",
  "tickersProcessed": 8,
  "tickersFailed": 1,
  "snapshotsCreated": 6,
  "snapshotsUpdated": 2,
  "actionsCreated": 10,
  "actionsUpdated": 1,
  "results": [],
  "failedTickers": [],
  "warnings": []
}
```

Failure behavior:
- Partial failures are expected and should be represented in `failedTickers` without failing the entire call.

## getDiscoveryCandidates

Purpose:
- Read latest discovery candidates for one category, optionally after refresh.

Recommended backend calls:
- Refresh category: `POST /api/discovery/fmp/:category/refresh`
- Refresh defaults: `POST /api/discovery/fmp/default-set`
- Read latest category: `GET /api/discovery/:category?limit=<N>`

Input:

```json
{
  "category": "GAINERS",
  "limit": 25,
  "refresh": true
}
```

Output:

```json
{
  "category": "GAINERS",
  "items": [
    {
      "ticker": "AAPL",
      "companyName": "Apple Inc.",
      "price": 205.12,
      "changePercent": 3.1,
      "capturedAt": "2026-06-08T12:00:00.000Z"
    }
  ]
}
```

Failure behavior:
- Unsupported category should return backend error envelope.
- Empty category result is valid and should return `items: []`.
