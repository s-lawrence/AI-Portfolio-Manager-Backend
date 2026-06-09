# Backend Context (Latest v23)

## Handoff Snapshot

Date:
- 2026-06-08

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty
- This context captures implementation details from the last three prompts focused on deterministic agent-ready scoring tools and runtime validation.

## Scope of the Last Three Prompts

Prompt window covered:
1. Add agent-ready deterministic metrics/scoring tools to the backend assistant.
2. Add/adjust tests and docs, then run validation (`typecheck`, `test`, `build`).
3. Complete runtime smoke execution for all four new scoring tools and resolve endpoint-path assumptions for watchlist/portfolio ID discovery.

Primary objective completed:
- Introduce deterministic, transparent, backend-only scoring and portfolio-risk capabilities exposed through agent tools.

Constraints followed:
- Backend-only changes.
- Existing API envelope behavior preserved.
- No schema migration required for this scoring pass.
- No LLM dependency added; scoring is deterministic from persisted backend data.
- New scoring tools are read-only and auto-allowed under current agent policy.

## Implementation Details

### 1) Deterministic scoring service foundation

Added:
- src/services/research-scoring.service.ts

New exported operations:
- `scoreTickerResearch(ticker)`
- `scoreWatchlist(watchlistId)`
- `compareTickers(tickers)`
- `getPortfolioRiskSnapshot(portfolioId)`

Core design characteristics:
- Deterministic output only (no stochastic model calls, no external LLM integration).
- Input sanitization for ticker/watchlist/portfolio identifiers.
- Conservative scoring defaults when coverage is sparse.
- Explicit data-quality treatment via missing/stale penalties.

Scoring architecture for `scoreTickerResearch`:
- Component scores produced:
  - `technicalScore`
  - `fundamentalScore`
  - `valuationScore`
  - `analystScore`
  - `newsScore`
  - `macroRiskScore`
  - `earningsRiskScore`
  - `dataQualityScore`
- Weighted composite formula:
  - technical 16%
  - fundamental 18%
  - valuation 14%
  - analyst 14%
  - news 12%
  - macro risk 10%
  - earnings risk 8%
  - data quality 8%
- Deterministic stance mapping:
  - `>= 75`: `STRONG_CANDIDATE`
  - `>= 63`: `CANDIDATE`
  - `>= 50`: `WATCH`
  - `>= 38`: `HOLD_OFF`
  - `< 38`: `AVOID`

Component logic highlights:
- Technical:
  - Uses SMA50/SMA200 relationship, trendDirection, MACD sign, RSI regime.
  - Applies staleness warning when technical snapshot age exceeds threshold.
- Fundamental and valuation:
  - Uses growth, margin averages, leverage/liquidity checks.
  - Uses PE/forward PE/PS/PB/EV-EBITDA bands for conservative valuation checks.
  - Uses optional FMP financial rating ROE/ROA sub-scores.
- Analyst:
  - Uses upsidePercent, consensus semantics, vote distribution, and recent upgrade/downgrade skew.
- News:
  - Uses sentiment mix and materiality weighting from recent articles.
  - Flags stale news windows.
- Macro risk:
  - Builds context from geopolitical summary and FRED macro series (`DGS10`, `DGS2`, `FEDFUNDS`, `CPIAUCSL`).
  - Adds bearish/bullish context from event volume, sentiment mix, yield-curve shape, rates, inflation.
- Earnings risk:
  - Penalizes near-term earnings proximity to reflect volatility/event risk.
- Data quality:
  - Penalizes missing and stale evidence to avoid overconfident outputs.
  - Returns `missingData` and `staleDataWarnings` arrays for transparency.

Watchlist and comparison behavior:
- `scoreWatchlist`:
  - Scores each watchlist ticker via `scoreTickerResearch`.
  - Sorts descending by composite score, then ticker lexical tie-break.
  - Returns ranked items with embedded per-ticker score objects.
- `compareTickers`:
  - Normalizes, de-duplicates, and scores requested tickers.
  - Adds `keyDifferences` that summarize meaningful score/component spreads.

Portfolio risk snapshot behavior:
- `getPortfolioRiskSnapshot`:
  - Loads portfolio overview and computes concentration/currency/sector exposure views.
  - Flags missing FX, unsupported currencies, missing latest prices.
  - Produces concentration risk entries for dominant single-name, top-3 concentration, and top-sector concentration thresholds.
  - Returns `topRisks` and a deterministic summary paragraph.

### 2) Shared type contracts for scoring outputs

Updated:
- src/types/services.ts

Added service contracts:
- `SuggestedResearchStance`
- `TickerResearchComponentScores`
- `TickerResearchScoreResult`
- `WatchlistScoredItem`
- `WatchlistResearchScoreResult`
- `CompareTickersResult`
- `PortfolioRiskExposure`
- `PortfolioConcentrationRisk`
- `PortfolioRiskSnapshotResult`

Outcome:
- Scoring and risk snapshot shapes are now explicit and reusable across service/tool/api/test layers.

### 3) Agent tool registry expansion for scoring

Updated:
- src/agent/agent-tool.types.ts
- src/agent/agent-tool-registry.ts

Added read-only, auto-allowed tools:
- `scoreTickerResearch`
- `scoreWatchlist`
- `compareTickers`
- `getPortfolioRiskSnapshot`

Execution/wiring notes:
- Input schemas are validated with Zod before execution.
- Not-found semantics are mapped to structured `AgentToolExecutionError(404, "NOT_FOUND", ...)`.
- Notes clarify deterministic decision-support intent and no-LLM behavior.

Policy posture:
- All four new scoring tools are:
  - `riskLevel = READ_ONLY`
  - `executionMode = AUTO_ALLOWED`

### 4) API tool surface and error propagation

Added/updated route and schema layer:
- src/api/routes/agent-tools.routes.ts
- src/api/schemas/agent-tools.schemas.ts
- src/api/routes/index.ts

Behavior:
- Tool catalog endpoint:
  - `GET /api/agent/tools`
- Tool execution endpoint:
  - `POST /api/agent/tools/:toolName/execute`
- Maintains existing standard API envelope (`success/data/error`).

Error mapping update:
- src/api/errors.ts now maps `AgentToolExecutionError` into API envelope-compatible `ApiError` with preserved status/code/details.

### 5) Service exports and module wiring

Updated:
- src/services/index.ts
- src/agent/index.ts

Outcome:
- Research scoring service and agent registry/executor exports are available through existing barrel patterns.

### 6) Tests added/updated for deterministic scoring and tool execution

Added:
- tests/unit/research-scoring.service.test.ts

Updated:
- tests/unit/agent-tool-registry.test.ts
- tests/integration/api-agent-tools.integration.test.ts

Coverage added in this prompt window:
- Unit checks for deterministic scoring behavior:
  - component score presence
  - explanation presence
  - data-quality degradation when coverage is missing
  - analyst upside/downside effect on analyst score
  - RSI overbought caution path
  - watchlist ranking behavior
  - compare tickers and portfolio concentration detection
- Registry/executor checks:
  - default tool listing includes new scoring tools
  - scoring tool execution path and normalized ticker behavior
  - confirmation/dry-run/disabled behavior remains intact
- API integration checks:
  - scoring tool endpoint execution via `/api/agent/tools/:toolName/execute`
  - envelope consistency and service invocation assertions

## Prompt-by-Prompt Delta Summary

### Prompt 1 delta (implementation)

Completed:
- Deterministic scoring service with four core operations.
- Agent registry extensions for four new read-only tools.
- Service/type/export wiring for compile-time contract integrity.

### Prompt 2 delta (tests/docs/validation)

Completed:
- Added scoring unit suite and expanded registry/integration tests.
- Updated docs/agent/backend-tool-contracts.md with scoring tool catalog and deterministic interpretation notes.
- Ran validation commands successfully:
  - `npm run -s typecheck`
  - `npm test`
  - `npm run -s build`

Observed results from validation run:
- Typecheck: PASS
- Test suite: PASS (45 files, 302 tests)
- Build: PASS

### Prompt 3 delta (runtime smoke and route-path correction)

Initial issue:
- Manual smoke attempted `GET /api/watchlists` and failed because watchlist/portfolio listing is user-scoped.

Resolved by route inspection:
- Correct list endpoints:
  - `GET /api/watchlists/user/:userId`
  - `GET /api/portfolios/user/:userId`
- Reliable demo context bootstrap endpoint:
  - `GET /api/dev/demo-context` for `userId` and `portfolioId`

Manual smoke sequence completed against local backend:
1. `scoreTickerResearch` executed for `AAPL`.
2. `scoreWatchlist` executed for discovered default watchlist.
3. `compareTickers` executed for `AAPL/MSFT/NVDA`.
4. `getPortfolioRiskSnapshot` executed for discovered portfolio.

Smoke output highlights captured:
- `scoreTickerResearch`: 200, stance `CANDIDATE`, composite `63.88`
- `scoreWatchlist`: 200, watchlist item count `3`
- `compareTickers`: 200, requested `3`, scored `3`
- `getPortfolioRiskSnapshot`: 200, top risks count `1`

## Files Added in This Prompt Window

- src/agent/agent-tool-executor.ts
- src/agent/agent-tool-registry.ts
- src/agent/agent-tool.types.ts
- src/agent/index.ts
- src/api/routes/agent-tools.routes.ts
- src/api/schemas/agent-tools.schemas.ts
- src/services/research-scoring.service.ts
- tests/integration/api-agent-tools.integration.test.ts
- tests/unit/agent-tool-registry.test.ts
- tests/unit/research-scoring.service.test.ts

## Files Updated in This Prompt Window

- docs/agent/backend-tool-contracts.md
- src/api/errors.ts
- src/api/routes/index.ts
- src/services/index.ts
- src/types/services.ts

## Known Notes and Follow-ups

- Deterministic scores are intentionally conservative and should be treated as decision support, not investment advice.
- The current scoring model is heuristic and does not include sector-relative valuation normalization.
- If needed later, direct non-agent read endpoints under `/api/research` can be added without changing current agent-tool contracts.

## Resume Checklist

1. Optional: add API-level non-agent wrappers for scoring operations if required by non-agent clients.
2. Optional: add additional coverage for edge-case macro staleness and sparse-watchlist ranking tie scenarios.
3. Optional: add observability counters for score component coverage and stance distribution over time.
