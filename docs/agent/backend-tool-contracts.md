# Backend Agent Tool Contracts

## Scope

This document is the canonical contract for all registered backend agent tools.

Each tool must define:

- `toolName`
- `description`
- `category`
- `riskLevel`
- `executionMode`
- `inputSchema` (Zod)
- `notes`
- `execute(input, context)`
- optional `dryRunPlan(input, context)`

## Execution Result Contract

All executions return:

- `toolName`
- `success`
- `data` (full payload)
- `dataSummary` (bounded operator-facing summary)
- `warnings: string[]`
- `errors: string[]`
- `metadata`:
  - `startedAt`
  - `finishedAt`
  - `durationMs`
  - `riskLevel`
  - `executionMode`
  - `dryRun`

`dataSummary` is required to stay compact and diagnostic-oriented. It must not dump entire raw payloads.

## Policy Matrix

Risk levels:

- `READ_ONLY`
- `REFRESH`
- `MUTATION`
- `HIGH_IMPACT`

Execution modes:

- `AUTO_ALLOWED`
- `CONFIRMATION_REQUIRED`
- `DISABLED`

Global policy:

- `READ_ONLY` tools are normally `AUTO_ALLOWED`.
- `REFRESH` and `MUTATION` tools are `CONFIRMATION_REQUIRED`.
- `HIGH_IMPACT` tools are `DISABLED` unless explicitly enabled in a future phase.

## Tool Matrix

| toolName | category | riskLevel | executionMode | required input fields | dryRun behavior | output summary fields (`dataSummary`) | known limitations |
|---|---|---|---|---|---|---|---|
| `getPortfolioOverview` | Portfolio Read | `READ_ONLY` | `AUTO_ALLOWED` | `portfolioId` | Executes normally | `portfolioId`, `totalMarketValueCad`, `holdingsCount`, `missingFxOrCurrencyIssuesCount` | Depends on existing persisted holdings/prices/FX coverage |
| `getTickerResearchBundle` | Ticker Read | `READ_ONLY` | `AUTO_ALLOWED` | `ticker` | Executes normally | `ticker`, `latestPrice`, `recommendation`, `analystConsensus`, `missingDataCategories` | Freshness depends on prior ingestion |
| `getWatchlistResearchBundle` | Watchlist Read | `READ_ONLY` | `AUTO_ALLOWED` | `watchlistId` | Executes normally | `watchlistId`, `itemCount`, `tickersWithUsefulResearch`, `tickersMissingData` | Uses persisted research only |
| `getDiscoveryCandidates` | Discovery Read | `READ_ONLY` | `AUTO_ALLOWED` | `category` | Executes normally | `category`, `candidateCount`, `topTickers`, `capturedAt`, `warningCount` | Snapshot quality/freshness depends on prior discovery refresh |
| `rankDiscoveryCandidates` | Discovery Ranking | `READ_ONLY` | `AUTO_ALLOWED` | none (`category`, `portfolioId`, `watchlistId` optional) | Executes normally | `category`, `totalCandidates`, `scoredCandidatesCount`, `skippedCandidatesCount`, `topRankedTickers`, `warningCount`, `suggestedRefreshActions` | Deterministic scoring from persisted data only; excludes existing holdings/watchlist items by options |
| `getGeopoliticalSummary` | Geopolitical Read | `READ_ONLY` | `AUTO_ALLOWED` | none | Executes normally | `totalEvents`, `sentimentMix`, `topHeadlines`, `topRisks`, optional `message`, optional `suggestedActions` | Reads persisted local GDELT context only; empty local data should suggest refresh |
| `getLatestAnalystContext` | Analyst Read | `READ_ONLY` | `AUTO_ALLOWED` | `ticker` | Executes normally | fallback summary (`toolName`, `hasData`) | Detailed payload remains in `data`; summary is intentionally minimal |
| `scoreTickerResearch` | Deterministic Scoring | `READ_ONLY` | `AUTO_ALLOWED` | `ticker` | Executes normally | `ticker`, `compositeScore`, `suggestedStance`, `topBullishFactors`, `topBearishFactors`, `missingDataCount` | Heuristic aid only; not investment advice |
| `scoreWatchlist` | Deterministic Scoring | `READ_ONLY` | `AUTO_ALLOWED` | `watchlistId` | Executes normally | `totalItems`, `activeItemsCount`, `scoredItemsCount`, `skippedItemsCount`, `topRankedTickers` | Quality constrained by per-ticker coverage |
| `getTickerDataQuality` | Data Quality Read | `READ_ONLY` | `AUTO_ALLOWED` | `ticker` | Executes normally | `ticker`, `missingDataCount`, `staleDataWarningCount`, `suggestedRefreshActions` | Diagnostic-only; no provider calls |
| `getWatchlistDataQuality` | Data Quality Read | `READ_ONLY` | `AUTO_ALLOWED` | `watchlistId` | Executes normally | `watchlistId`, `itemCount`, `completeItemsCount`, `partialItemsCount`, `emptyItemsCount`, `perTickerQualityCount`, `suggestedRefreshActions` | Diagnostic-only; quality reflects persisted snapshots |
| `getPortfolioDataQuality` | Data Quality Read | `READ_ONLY` | `AUTO_ALLOWED` | `portfolioId` | Executes normally | `portfolioId`, `holdingCount`, `missingFxIssuesCount`, `missingCurrencyIssuesCount`, `missingPriceIssuesCount`, `staleDataWarningCount`, `suggestedRefreshActions` | Diagnostic-only; complements risk snapshot |
| `compareTickers` | Deterministic Scoring | `READ_ONLY` | `AUTO_ALLOWED` | `tickers` | Executes normally | `requestedTickers`, `comparedCount`, `highestScoreTicker`, `highestScore`, `warnings` | Comparison quality constrained by data completeness |
| `getPortfolioRiskSnapshot` | Portfolio Risk Read | `READ_ONLY` | `AUTO_ALLOWED` | `portfolioId` | Executes normally | `concentrationRisksCount`, `holdingsMissingFxCount`, `holdingsUnsupportedCurrencyCount`, `topRisks`, `fxRateUsed` | Deterministic snapshot only; not advisory output |
| `runPortfolioFullRefresh` | Portfolio Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | `portfolioId` | Planned action only, no writes/provider calls | `plannedOrExecuted`, `portfolioId`, `tickersProcessed`, `tickersFailed`, `warningCount` | Potentially expensive; execution breadth depends on options |
| `refreshTickerAnalystData` | Analyst Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | `ticker` | Planned action only, no writes/provider calls | `plannedOrExecuted`, `ticker`, `snapshotsCreated`, `snapshotsUpdated`, `warningCount` | Provider availability/rate limits can affect result |
| `refreshUsdCadFxRate` | FX Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | none | Planned action only, no writes/provider calls | `plannedOrExecuted`, `recordsCreated`, `recordsUpdated`, `recordsSkipped`, `warningCount` | Targets Bank of Canada USD/CAD series only |
| `refreshWatchlistAnalystData` | Analyst Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | `watchlistId` | Planned action only, no writes/provider calls | `plannedOrExecuted`, `watchlistId`, `tickersProcessed`, `tickersFailed`, `tickersSkipped`, `warningCount` | Per-ticker partial failures are possible |
| `refreshWatchlistResearchData` | Watchlist Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | `watchlistId` | Uses `dryRunPlan`; returns planned tickers and options | `plannedOrExecuted`, `toolName`, `plannedAction`, `watchlistId`, `plannedTickers`, `plannedTickersCount`, `tickersProcessed`, `tickersSkipped`, `message` | Can return mixed success across categories/tickers |
| `refreshDiscoveryCategory` | Discovery Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | `category` | Planned action only, no writes/provider calls | `plannedOrExecuted`, `category`, `recordsCreated`, `warningCount` | Discovery source quality and throughput vary |
| `refreshGdeltRiskContext` | Geopolitical Refresh | `REFRESH` | `CONFIRMATION_REQUIRED` | none | Dry-run returns planned query profiles only; no writes/provider calls | `plannedOrExecuted`, `queriesProcessed`, `queriesFailed`, `eventsCreated`, `warningCount`, bounded `failedQueries` | Query throttling/partial failures may occur; failure codes are preserved |
| `generateTickerReport` | Report Mutation | `MUTATION` | `CONFIRMATION_REQUIRED` | `ticker` | Uses `dryRunPlan`; returns context preview and selected options without writes | `plannedOrExecuted`, `reportId`, `recommendation`, `reportMode`, `fallbackUsed`, `predictionCount`, `warningCount`, `dataGapCount`, `modelName` | OpenAI path may fallback deterministically; writes report/prediction rows when not dry-run |
| `addTickerToWatchlist` | Watchlist Mutation | `MUTATION` | `CONFIRMATION_REQUIRED` | `watchlistId`, `ticker` | Planned write only, no DB mutation | `plannedOrExecuted`, `itemId`, `watchlistId`, `ticker` | Defaults source/status/priority when omitted |
| `updateWatchlistItem` | Watchlist Mutation | `MUTATION` | `CONFIRMATION_REQUIRED` | `itemId` + at least one update field | Planned write only, no DB mutation | `plannedOrExecuted`, `itemId`, `watchlistId`, `ticker` | Requires at least one mutable field |
| `removeWatchlistItem` | Watchlist Mutation | `MUTATION` | `CONFIRMATION_REQUIRED` | `itemId` | Planned delete only, no DB mutation | `plannedOrExecuted`, `itemId`, `watchlistId`, `ticker` | Hard removal outcome depends on item existence |
| `rebalancePaperPortfolio` | High-Impact Placeholder | `HIGH_IMPACT` | `DISABLED` | `portfolioId` | Not executable | no execution summary (blocked by policy) | Intentionally disabled in this phase |

## Confirmation, Disabled, and Dry-Run Rules

### Confirmation-required

If a tool is `CONFIRMATION_REQUIRED` and `confirmed !== true`, execution fails with:

- status code `409`
- code `AGENT_TOOL_CONFIRMATION_REQUIRED`
- message `Tool requires confirmation.`
- details: `toolName`, `riskLevel`, `executionMode`

### Disabled tool

If a tool is `DISABLED`, execution fails with:

- status code `403`
- code `AGENT_TOOL_DISABLED`

### Dry-run

- `READ_ONLY` tools execute normally.
- Non-read-only tools return planned output and warnings without provider calls or writes.
- `refreshWatchlistResearchData` uses tool-specific planning that includes planned ticker details.

## Error and Diagnostics Rules

- Tool errors are returned in structured envelope form.
- Error strings are bounded and secret-safe (no raw token/key leakage, no stack-trace dumping).
- Warnings and diagnostics should be concise and operationally useful.
- Detailed payload remains in `data`; compact operator digest belongs in `dataSummary`.

## API Endpoints

- `GET /api/agent/tools`
- `POST /api/agent/tools/:toolName/execute`
- `POST /api/agent/chat`
