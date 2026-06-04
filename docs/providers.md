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
- /earnings?symbol={symbol}
- /earnings-calendar?from={YYYY-MM-DD}&to={YYYY-MM-DD}&page={n}
- /news/stock?symbols={symbol}

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
- Percent-like fundamentals fields are normalized to decimal fractions internally (for example 5.4% stored as 0.054).
- Percent normalization applies to revenueGrowth, grossMargin, operatingMargin, netMargin, and dividendYield.
- Valuation and leverage ratios (for example peRatio, priceToSales, priceToBook, debtToEquity) remain plain numeric ratios.
- Unauthorized API key and rate-limit failures are surfaced as explicit provider errors.
- Earnings ingestion uses stable /earnings for ticker-level upcoming and historical data.
- Earnings calendar support uses stable /earnings-calendar with date ranges.
- Earnings calendar requests are limited to a maximum 90-day date range per request.
- Fiscal quarter and earnings time may be unavailable from these stable endpoints.
- News ingestion reads company news from FMP and upserts by unique article URL for idempotency.
- If provider sentiment/materiality is missing, deterministic local fallback classification is applied.
- Demo-marked local fake news is explicitly identified so reports can prefer real company headlines.
- Combined portfolio full-refresh orchestration runs market-data, fundamentals, earnings, and news ingestion in sequence before optional portfolio analysis.