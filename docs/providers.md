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
- /stable/key-metrics?symbol={symbol}
- /stable/ratios?symbol={symbol}
- /financial-growth?symbol={symbol}
- /income-statement?symbol={symbol}
- /cash-flow-statement?symbol={symbol}
- /earnings?symbol={symbol}
- /earnings-calendar?from={YYYY-MM-DD}&to={YYYY-MM-DD}&page={n}
- /news/stock?symbols={symbol}
- /treasury-rates
- /economic-indicators
- /economic-calendar (fallback /economics-calendar)
- /market-risk-premium

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
- Technical calculation targets include SMA20/SMA50/SMA200, RSI14, and MACD components when enough close history exists.
- If history is insufficient for a specific indicator window, ingestion returns explicit warnings.
- Annualized volatility is computed from recent close returns for research-bundle projection.
- Fundamentals ingestion primarily maps valuation/leverage fields from stable ratios and stable key-metrics, then fills additional fields from growth/income/cash-flow/profile endpoints.
- Ratios and key-metrics selection prefers annual records (`period = FY`) and then picks the most recent record by date.
- Fundamentals field mapping summary:
	- `peRatio <- ratios.priceToEarningsRatio` (fallback: `quote.price / eps` when available).
	- `pegRatio <- ratios.priceToEarningsGrowthRatio`.
	- `priceToSales <- ratios.priceToSalesRatio`.
	- `priceToBook <- ratios.priceToBookRatio`.
	- `debtToEquity <- ratios.debtToEquityRatio` (fallback: `totalDebt / totalStockholdersEquity`).
	- `evToEbitda <- keyMetrics.evToEBITDA` (fallback: `ratios.enterpriseValueMultiple`).
	- `marketCap <- keyMetrics.marketCap` (fallback: profile market cap).
	- `currentRatio <- ratios.currentRatio` (fallback: key metrics current ratio).
	- `grossMargin <- ratios.grossProfitMargin`.
	- `operatingMargin <- ratios.operatingProfitMargin`.
	- `netMargin <- ratios.netProfitMargin`.
	- `dividendYield <- ratios.dividendYield`; if missing, `dividendYieldPercentage / 100` is used.
	- `eps <- incomeStatement.eps` (fallback: `ratios.netIncomePerShare`).
- `forwardPeRatio` remains null unless a true forward P/E source is available. `forwardPriceToEarningsGrowthRatio` (forward PEG) is not mapped to `forwardPeRatio`.
- Fundamentals storage is same-day upsert idempotent (UTC-day scoped): re-runs refresh the existing same-day snapshot instead of skipping.
- If one fundamentals endpoint returns 404/no-data, ingestion continues with available endpoints.
- Percent-like fundamentals fields are normalized to decimal fractions internally (for example 5.4% stored as 0.054).
- Percent normalization applies to revenueGrowth, grossMargin, operatingMargin, netMargin, and dividendYield.
- Stable ratios `grossProfitMargin` and `dividendYield` are already decimal fractions and are stored as-is after defensive normalization.
- `dividendYieldPercentage` is only used when `dividendYield` is missing; it is converted from percentage points to decimal fraction.
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

### Snapshot Source Conventions

- Market quote snapshots ingested from FMP are stored with `source = FMP_QUOTE`.
- Historical daily snapshots ingested from FMP are stored with `source = FMP_HISTORICAL`.
- Historical daily ingestion is upserted by stock + UTC day: existing same-day rows are refreshed to FMP values rather than skipped.
- Local demo market snapshots are stored with `source = DEMO`.
- Latest snapshot selection is source-aware and will not allow `DEMO` rows to override available FMP rows.
- Technical calculations use source-aware historical prices and prefer FMP rows when sufficient provider history exists.

### Demo Data Seeding Notes

- `prisma/seed.ts` always creates only core demo context (user, preferences, portfolio, stocks, holdings).
- Demo analytical data (price/fundamentals/news/earnings/reports/predictions) is disabled by default.
- Set `SEED_DEMO_ANALYTICS=true` only when explicit local fake analytical seeding is required.

### Market Data CapturedAt Conventions

- Quote snapshots are persisted with ingestion-time `capturedAt` (current timestamp), representing latest tradable context.
- Historical EOD snapshots are persisted with provider historical date `capturedAt` (typically UTC midnight timestamps).
- Latest market snapshot reads use canonical selector logic:
	- newest `capturedAt` first,
	- intraday timestamp preferred on ties,
	- newest `createdAt` fallback tie-breaker.
- `PriceSnapshot` currently has no persisted `source` column, so source-level cleanup (for example demo-only purge by source) is not yet safe to automate.

### FMP Economics Market-Context Notes

- FMP economics ingestion is stored as market-context macro data (provider-level series/events), not ticker-level stock fundamentals.
- Treasury rates and market risk premium values are persisted in macro-series storage for reusable macro context.
- Economic calendar releases are persisted in macro-event storage for upcoming event context and report enrichment.
- Default economics ingestion set is designed for resilient partial completion; one category failure does not block others.
- This milestone uses FMP as the macro-context foundation only.
- FRED and Bank of Canada remain out of scope in this phase and will be added later as primary macro and Canadian-source integrations.