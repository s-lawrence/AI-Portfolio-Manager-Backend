# Backend Context (Latest v15)

## Handoff Snapshot

Date:
- 2026-06-05

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (latest CAD-equivalent valuation implementation added and validated)

## Scope

Current backend stack:
- Node.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Fastify
- Zod
- Vitest

Still intentionally out of scope:
- Frontend implementation
- AuthN/AuthZ
- External LLM integration

## Milestone Summary

Primary outcomes completed in this iteration:
- Added CAD-equivalent valuation support to holding and portfolio overview responses using latest stored FX rates.
- Preserved existing response envelopes and compatibility fields while introducing native/cad valuation fields.
- Added conversion-status handling for direct CAD, converted USD, missing FX, and unsupported currency cases.

Key runtime outcomes:
- Holdings now expose both native valuation and CAD-equivalent valuation when conversion is possible.
- Portfolio overview now exposes CAD totals, FX metadata, and explicit lists for missing/unsupported conversion cases.
- OWNED holdings are included in totals; WATCHLIST holdings are excluded from totals.

## FX Conversion Behavior

Implemented conversion helper behavior:
- `convertMoneyToCad({ amount, currency, asOf? })`
- `convertAmountWithRate(amount, rate)`

Conversion rules:
- CAD:
  - amountCad = amount
  - fxRate = 1
  - conversionStatus = DIRECT_CAD
- USD:
  - reads latest stored USD/CAD snapshot
  - amountCad = amount * rate
  - conversionStatus = CONVERTED
- USD with no stored USD/CAD snapshot:
  - amountCad = null
  - conversionStatus = MISSING_FX
- Non-USD/CAD currencies:
  - amountCad = null
  - conversionStatus = UNSUPPORTED_CURRENCY

As-of support:
- Added repository query for latest FX snapshot at or before an `asOf` timestamp.

Key files:
- src/services/fx-rates.service.ts
- src/repositories/fx-rate-snapshots.repository.ts

## Holding Overview Enhancements

Added valuation fields to holding overview response:
- native valuation fields:
  - nativeCurrency
  - latestPriceNative
  - marketValueNative
  - costBasisNative
  - unrealizedGainLossNative
  - unrealizedGainLossPercent
- compatibility/native fields retained:
  - latestPrice
  - marketValue
  - costBasis
  - unrealizedGainLoss
- CAD conversion metadata and valuation:
  - cadFxRate
  - cadFxRateSource
  - cadFxRateCapturedAt
  - marketValueCad
  - costBasisCad
  - unrealizedGainLossCad
  - conversionStatus

Key file:
- src/services/holdings.service.ts

## Portfolio Overview Enhancements

Per-holding additions in portfolio overview:
- same native/cad valuation fields described above for holding overview.

Portfolio-level additions:
- portfolioBaseCurrency: "CAD"
- totalMarketValueNative (only populated when OWNED holdings are single-currency)
- totalMarketValueCad
- totalCostBasisCad
- totalUnrealizedGainLossCad
- totalUnrealizedGainLossPercentCad
- fxRateUsed:
  - pair: "USD/CAD"
  - rate
  - source
  - capturedAt
- holdingsMissingFx: [{ ticker, currency }]
- holdingsUnsupportedCurrency: [{ ticker, currency }]

Totals behavior:
- Includes OWNED holdings only.
- WATCHLIST holdings do not affect totals.
- Holdings that cannot convert are excluded from CAD totals and listed in missing/unsupported arrays.
- If no OWNED holdings can convert, CAD totals resolve to null.

Key file:
- src/services/portfolios.service.ts

## Types and Contracts

Extended service contracts with:
- CadConversionStatus union
- PortfolioFxIssue
- PortfolioFxRateUsed
- PortfolioOverviewHoldingSummary native/cad valuation fields
- PortfolioOverview CAD totals and FX metadata
- HoldingOverview native/cad valuation fields

Key file:
- src/types/services.ts

## Existing Macro/FX Baseline (Retained)

Previously completed and retained:
- BoC/FRED macro+FX ingestion and endpoints.
- Full-refresh performance diagnostics and include-flag gating.
- Provider timeout handling and macro/economics no-op upsert optimization.

## Testing

New tests added:
- tests/unit/fx-rates.service.test.ts
  - direct CAD conversion
  - USD conversion with latest USD/CAD
  - missing USD/CAD returns MISSING_FX
  - unsupported currency returns UNSUPPORTED_CURRENCY
- tests/unit/holdings.service.test.ts
  - USD holding native + CAD valuation
  - CAD holding direct valuation behavior

Updated tests:
- tests/unit/portfolios.service.test.ts
  - CAD totals for mixed USD/CAD owned holdings
  - watchlist exclusion from totals
  - missing FX exclusion + list
  - unsupported currency exclusion + list
  - compatibility fields remain present
- tests/integration/api-portfolio.integration.test.ts
  - overview payload contains new native/cad fields and portfolio CAD metadata
- tests/integration/portfolio-workflow.integration.test.ts
  - holding overview includes native valuation and conversion status

## Docs

Updated:
- docs/api.md
- docs/providers.md

Documented items:
- Holding overview native/cad valuation fields.
- Portfolio overview CAD totals and FX metadata fields.
- USD/CAD conversion convention (CAD per 1 USD).
- BoC USD/CAD stream supports CAD-equivalent portfolio valuation and missing-FX behavior.

## Validation Status

Targeted validation completed:
- npx vitest tests/unit/fx-rates.service.test.ts tests/unit/holdings.service.test.ts tests/unit/portfolios.service.test.ts tests/integration/api-portfolio.integration.test.ts tests/integration/portfolio-workflow.integration.test.ts --run
  - 5 files
  - 17 tests
  - passed

Full validation completed:
- npm run typecheck: passed
- npm test: passed
  - 36 test files
  - 220 tests
- npm run build: passed

## Manual API Validation (Local)

Executed:
1. POST /api/ingestion/macro/boc/usd-cad
2. GET /api/portfolios/<PORTFOLIO_ID>
3. GET /api/holdings/<HOLDING_ID>

Observed:
- BoC USD/CAD ingestion succeeded.
- Portfolio overview returned `totalMarketValueCad` and `fxRateUsed`.
- USD holdings returned both native and CAD values with `conversionStatus = CONVERTED`.
- Holding overview returned matching native and CAD fields.

Note:
- Demo context in this run did not include CAD-native holdings, so CAD==CAD direct behavior was validated by unit tests.

## Operational Notes

- CAD conversion relies on stored FX snapshots, not live provider calls in valuation paths.
- USD conversion requires both:
  - stock currency metadata set to USD
  - at least one stored USD/CAD FX snapshot
- Missing stock currency metadata is treated as unsupported currency in conversion logic.

## Resume Checklist

If continuing from this handoff:
1. Review working tree and commit the CAD valuation and documentation updates.
2. Optionally seed/create a CAD-native holding in a local portfolio to manually demonstrate DIRECT_CAD behavior through API responses.
3. If multi-currency support is expanded beyond USD/CAD, extend conversion service and totals logic with additional stored pairs.
