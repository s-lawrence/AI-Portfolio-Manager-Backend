# Providers Guide

## Financial Modeling Prep (FMP)

### Environment Configuration

Set these values in your local environment file:

```bash
FMP_API_KEY=""
FMP_BASE_URL="https://financialmodelingprep.com/stable"
```

Notes:
- Keep API keys in environment variables only.
- Do not commit populated .env files.
- If FMP_API_KEY is missing, server startup still works; ingestion calls fail with a clear configuration error when invoked.

### Supported FMP Endpoints In This Milestone

- /quote?symbol={symbol}
- /profile?symbol={symbol}
- /historical-price-eod/full?symbol={symbol}
- /key-metrics?symbol={symbol}
- /ratios?symbol={symbol}
- /financial-growth?symbol={symbol}
- /income-statement?symbol={symbol}
- /cash-flow-statement?symbol={symbol}

### Ticker Examples

Canadian examples:
- RY.TO
- TD.TO
- ENB.TO
- SHOP.TO
- XEQT.TO
- VFV.TO

U.S. examples:
- AAPL
- MSFT
- NVDA

### Internal Processing Notes

- Tickers are normalized to uppercase and preserve suffixes such as .TO and .V.
- Technical indicators are calculated internally from stored price history after ingestion; they are not sourced directly from FMP.
- Fundamentals ingestion merges the latest values across key metrics, ratios, growth, income statement, cash flow, and profile endpoints.
- If one fundamentals endpoint returns 404/no-data, ingestion continues with available endpoints.
- Unauthorized API key and rate-limit failures are surfaced as explicit provider errors.