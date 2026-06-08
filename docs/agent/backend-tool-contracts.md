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

## refreshGdeltRiskContext

Purpose:
- Trigger GDELT ingestion for either one explicit query or the default global-risk query set.

Recommended backend calls:
- Single query: `POST /api/ingestion/gdelt/query`
- Default set: `POST /api/ingestion/gdelt/default-risk-set`

Input (single query):

```json
{
  "query": "war OR sanctions",
  "from": "2026-06-01T00:00:00.000Z",
  "to": "2026-06-08T00:00:00.000Z",
  "maxRecords": 25
}
```

Input (default risk set):

```json
{
  "from": "2026-06-01T00:00:00.000Z",
  "to": "2026-06-08T00:00:00.000Z",
  "maxRecordsPerQuery": 25
}
```

Output:

```json
{
  "queriesProcessed": 8,
  "queriesFailed": 0,
  "eventsCreated": 42,
  "eventsUpdated": 6,
  "eventsSkipped": 3,
  "warnings": [],
  "failedQueries": []
}
```

Failure behavior:
- Query-level failures are captured in `failedQueries` and should not block all results.

## getLatestGeopoliticalContext

Purpose:
- Retrieve recent stored GDELT geopolitical events for near-term context retrieval.

Recommended backend call:
- `GET /api/geopolitical/latest?limit=<N>&days=<D>`

Input:

```json
{
  "limit": 20,
  "days": 7
}
```

Output:

```json
{
  "from": "2026-06-01T00:00:00.000Z",
  "to": "2026-06-08T00:00:00.000Z",
  "items": []
}
```

Failure behavior:
- Empty result is valid (`items: []`).

## getGeopoliticalSummary

Purpose:
- Fetch bounded aggregate geopolitical/global-risk summary for reports and watchlists.

Recommended backend call:
- `GET /api/geopolitical/summary?days=<D>`

Input:

```json
{
  "days": 7
}
```

Output:

```json
{
  "totalEvents": 100,
  "countsByCategory": [
    { "key": "GEOPOLITICAL", "count": 40 }
  ],
  "countsByTheme": [
    { "key": "GLOBAL_RISK", "count": 30 }
  ],
  "sentimentMix": {
    "positive": 12,
    "neutral": 55,
    "negative": 28,
    "unknown": 5
  },
  "topHeadlines": []
}
```

Failure behavior:
- If no events exist, return summary with `totalEvents = 0` and empty arrays.
