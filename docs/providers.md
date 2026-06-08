# Providers Guide

## Financial Modeling Prep (FMP)

### Environment Configuration

Set these values in your local environment file:

```bash
FMP_API_KEY=""
FMP_BASE_URL="https://financialmodelingprep.com/stable"
PROVIDER_HTTP_TIMEOUT_MS="20000"
```

Notes:
- Keep API keys in environment variables only.
- Do not commit populated .env files.
- If FMP_API_KEY is missing, server startup still works; ingestion calls fail with a clear configuration error when invoked.
- All provider fetch calls use timeout protection (`PROVIDER_HTTP_TIMEOUT_MS`, default 20000ms).

## Federal Reserve Economic Data (FRED)

### Environment Configuration

Set these values in your local environment file:

```bash
FRED_API_KEY=""
FRED_BASE_URL="https://api.stlouisfed.org/fred"
```

Notes:
- `FRED_API_KEY` is required for FRED requests.
- The API key is validated lazily (on call), so server startup still succeeds without it.
- If `FRED_API_KEY` is missing when a FRED ingestion endpoint is called, the request fails with a clear configuration error.
- If FRED times out, the provider surfaces a timeout request error and full-refresh keeps running remaining sections.

### Supported FRED Endpoints In This Milestone

- `/series/observations?series_id={SERIES_ID}`

### Default FRED Macro Series In This Milestone

- `FEDFUNDS`
- `DGS10`
- `DGS2`
- `T10Y2Y`
- `CPIAUCSL`
- `CPILFESL`
- `UNRATE`
- `PAYEMS`
- `ICSA`
- `GDP`
- `BAMLH0A0HYM2`
- `VIXCLS`
- `DTWEXBGS`
- `DCOILWTICO`

## Bank of Canada Valet

### Environment Configuration

Set these values in your local environment file:

```bash
BANK_OF_CANADA_BASE_URL="https://www.bankofcanada.ca/valet"
BANK_OF_CANADA_USD_CAD_SERIES_ID="FXUSDCAD"
```

Notes:
- Bank of Canada Valet does not require an API key for this integration.
- `BANK_OF_CANADA_USD_CAD_SERIES_ID` controls which BoC series is used for USD/CAD ingestion.
- BoC calls also use the shared provider timeout guard (`PROVIDER_HTTP_TIMEOUT_MS`).

### Supported Bank of Canada Endpoints In This Milestone

- `/observations/{SERIES_ID}/json`

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
- /stable/price-target-summary?symbol={symbol} (fallback /price-target-summary)
- /stable/price-target-consensus?symbol={symbol} (fallback /price-target-consensus)
- /stable/analyst-ratings?symbol={symbol} (fallback /analyst-ratings, /stable/recommendation-trends, /recommendation-trends)
- /stable/upgrades-downgrades?symbol={symbol} (fallback /upgrades-downgrades, /stable/upgrades-downgrades-consensus, /upgrades-downgrades-consensus)
- /stable/biggest-gainers (fallback /biggest-gainers, /stable/market-biggest-gainers, /market-biggest-gainers)
- /stable/biggest-losers (fallback /biggest-losers, /stable/market-biggest-losers, /market-biggest-losers)
- /stable/most-actives (fallback /most-actives, /stable/market-most-active, /market-most-active)
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
- Analyst ingestion reads price-target summary/consensus, analyst ratings, and upgrades-downgrades endpoints.
- Discovery ingestion reads gainers/losers/most-active plus analyst-upgrades/downgrades categories.
- Analyst/discovery endpoint fallback behavior: 404 responses try the next candidate endpoint automatically.
- Analyst/discovery no-data behavior: empty payloads are treated as soft no-data warnings (not hard failures).
- Analyst/discovery entitlement behavior: 402 responses are surfaced as provider configuration errors indicating plan limits.
- Analyst/discovery auth behavior: 401/403 responses are surfaced as API-key configuration errors.
- Analyst/discovery throttle behavior: 429 responses are surfaced as provider rate-limit errors.
- Combined portfolio full-refresh orchestration runs market-data, fundamentals, earnings, news, and optional analyst ingestion in sequence before optional portfolio analysis.

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

### BoC/FRED Macro Integration Notes

- Macro and FX ingestion now supports FRED and Bank of Canada as first-class providers.
- BoC USD/CAD snapshots are stored with convention: base `USD`, quote `CAD`, and value = CAD per 1 USD.
- Portfolio and holding CAD-equivalent valuation reads the latest stored USD/CAD snapshot from this BoC-backed FX stream.
- If no USD/CAD snapshot exists yet, USD holdings are flagged as missing FX for CAD totals until ingestion runs.
- FRED observation values with `value = "."` are ignored during ingestion.
- Default macro ingestion can run BoC and FRED together; section failures are non-blocking and surfaced as warnings.
- FRED default-series ingestion runs in small batches (instead of fully sequential single-series calls) to reduce wall-clock time.
- Full-refresh supports `fredObservationLimit`, `bocObservationLimit`, and optional `macroMaxSeries` to bound macro ingestion work.
- Macro and economics upserts now skip no-op updates where data is unchanged to reduce repeated write load.

### Current Limitations

- FRED and BoC ingestion currently covers observations only (no historical revisions endpoint handling).
- Currency ingestion currently targets USD/CAD only in the default BoC flow.
- Series metadata for FRED is statically mapped for the default set and may need extension for custom series.