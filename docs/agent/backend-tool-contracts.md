# Backend Agent Tool Contracts

## Purpose

The backend agent tool layer provides a curated registry of backend capabilities for agent workflows.

Agent orchestrators must use this layer instead of calling arbitrary backend routes directly.

## Safety and Design Rules

- Preserve backend response envelope semantics.
- Use explicit tool risk and execution policies.
- Validate tool input with Zod before execution.
- Return bounded, auditable execution results with timestamps and duration.
- Do not expose provider keys or bypass existing service guardrails.
- Keep refresh and mutation operations confirmation-gated.

## Core Contract

Each tool definition includes:

- `name`
- `description`
- `riskLevel`
- `executionMode`
- `inputSchema`
- optional `outputSchema`
- `notes`
- `execute(input, context)`

Execution context:

- `userId?`
- `portfolioId?`
- `requestId?`
- `source`: `USER | AGENT | SYSTEM`
- `dryRun?`

Execution result:

- `toolName`
- `success`
- `data?`
- `warnings: string[]`
- `errors: string[]`
- `metadata`:
  - `startedAt`
  - `finishedAt`
  - `durationMs`
  - `riskLevel`
  - `executionMode`
  - `dryRun`

## Risk Levels

- `READ_ONLY`
- `REFRESH`
- `MUTATION`
- `HIGH_IMPACT`

## Execution Modes

- `AUTO_ALLOWED`
- `CONFIRMATION_REQUIRED`
- `DISABLED`

Policy defaults:

- read-only tools: `AUTO_ALLOWED`
- refresh tools: `CONFIRMATION_REQUIRED`
- mutation tools: `CONFIRMATION_REQUIRED`
- high-impact tools: `DISABLED`

## Tool Catalog

### Read-only tools

- `getPortfolioOverview` -> `getPortfolioOverview`
- `getTickerResearchBundle` -> `getStockResearchBundle`
- `getWatchlistResearchBundle` -> `getWatchlistResearchBundle`
- `getDiscoveryCandidates` -> `listDiscoveryCandidates`
- `getGeopoliticalSummary` -> `getGeopoliticalSummary`
- `getLatestAnalystContext` -> `getLatestTickerAnalystSnapshot` + `listTickerAnalystActions`
- `scoreTickerResearch` -> `scoreTickerResearch`
  - Inputs: `ticker`
  - Outputs include:
    - `componentScores` (`technicalScore`, `fundamentalScore`, `valuationScore`, `analystScore`, `newsScore`, `macroRiskScore`, `earningsRiskScore`, `dataQualityScore`)
    - `compositeScore`
    - `suggestedStance` (`STRONG_CANDIDATE | CANDIDATE | WATCH | HOLD_OFF | AVOID`)
    - `bullishFactors`, `bearishFactors`, `missingData`, `staleDataWarnings`, `explanation`
- `scoreWatchlist` -> `scoreWatchlist`
  - Inputs: `watchlistId`
  - Returns ranked deterministic ticker scores for watchlist items
- `compareTickers` -> `compareTickers`
  - Inputs: `tickers: string[]`
  - Returns side-by-side deterministic scorecards and key differences
- `getPortfolioRiskSnapshot` -> `getPortfolioRiskSnapshot`
  - Inputs: `portfolioId`
  - Returns concentration, currency exposure, sector exposure, missing data, top risks, and summary

### Deterministic Scoring Notes

- Scoring tools are deterministic decision-support aids and are not investment advice.
- Scores are transparent heuristics from persisted backend data only (no external LLM calls).
- Component meanings:
  - `technicalScore`: trend/RSI/MACD and moving-average structure
  - `fundamentalScore`: growth, margins, balance-sheet/liquidity health
  - `valuationScore`: conservative multiple-range checks (not sector-relative fair value)
  - `analystScore`: upside, consensus, ratings distribution, upgrade/downgrade tilt
  - `newsScore`: sentiment/materiality directional context
  - `macroRiskScore`: broad macro/geopolitical backdrop risk context
  - `earningsRiskScore`: near-term event risk around upcoming earnings timing
  - `dataQualityScore`: confidence proxy from missing/stale data penalties
- Missing/stale behavior:
  - missing components lower `dataQualityScore` and appear in `missingData`
  - stale snapshots/observations add `staleDataWarnings`
  - conservative penalties prevent overconfident outputs on sparse inputs

### Refresh tools

All refresh tools are `CONFIRMATION_REQUIRED`.

- `runPortfolioFullRefresh` -> `ingestPortfolioFmpFullRefresh`
  - Inputs:
    - `portfolioId`
    - `refreshMode?` (`quick` default)
    - `includeEconomics?` (`true` default)
    - `includeBankOfCanada?` (`true` default)
    - `includeFred?` (`true` default)
    - `includeAnalystData?` (`true` default)
    - `includeGdelt?` (`false` default)
    - `runAnalysis?` (`true` default)
- `refreshTickerAnalystData` -> `ingestTickerAnalystData`
  - Inputs: `ticker`
- `refreshWatchlistAnalystData` -> `ingestWatchlistAnalystData`
  - Inputs: `watchlistId`
- `refreshDiscoveryCategory` -> `ingestMarketDiscovery`
  - Inputs: `category`, `limit?`
- `refreshGdeltRiskContext` -> `ingestDefaultGdeltRiskSet`
  - Inputs:
    - `mode?` (`quick` default)
    - `maxRecordsPerQuery?`
    - `lookbackDays?` (`7` default)
  - Output preserves ingestion warnings and `failedQueries`.

### Mutation tools

All mutation tools are `CONFIRMATION_REQUIRED`.

- `addTickerToWatchlist` -> `addTickerToWatchlist`
  - Inputs:
    - `watchlistId`
    - `ticker`
    - `status?`
    - `priority?`
    - `thesis?`
    - `riskNotes?`
    - `targetEntryPrice?`
    - `targetExitPrice?`
    - `targetAllocation?`
    - `tags?`
    - `source?`
  - If `source` is omitted, source defaults to `AGENT` when `context.source = AGENT`; otherwise `USER`.
- `updateWatchlistItem` -> `updateWatchlistItemDetails`
  - Inputs:
    - `itemId`
    - one or more update fields (`status`, `priority`, `thesis`, `riskNotes`, targets, `tags`, `rejectionReason`)
- `removeWatchlistItem` -> `removeWatchlistItem`
  - Inputs: `itemId`

### Disabled high-impact placeholder

- `rebalancePaperPortfolio`
  - Risk: `HIGH_IMPACT`
  - Mode: `DISABLED`
  - Exists as a policy placeholder and cannot be executed.

## Confirmation and Dry-Run Policy

### Confirmation-required behavior

If a tool is `CONFIRMATION_REQUIRED` and `confirmed !== true`, execution fails with:

- status code: `409`
- code: `AGENT_TOOL_CONFIRMATION_REQUIRED`
- message: `Tool requires confirmation.`
- details include `toolName`, `riskLevel`, and `executionMode`

### Disabled behavior

If a tool is `DISABLED`, execution fails with:

- status code: `403`
- code: `AGENT_TOOL_DISABLED`

### Dry-run behavior

- For `READ_ONLY` tools, execution still runs normally.
- For `REFRESH` and `MUTATION` tools, dry-run validates input and returns a structured planned action.
- In dry-run for non-read-only tools, no provider calls and no database writes are performed.

Example dry-run result payload fragment:

```json
{
  "toolName": "addTickerToWatchlist",
  "success": true,
  "data": {
    "plannedAction": true,
    "toolName": "addTickerToWatchlist",
    "riskLevel": "MUTATION",
    "executionMode": "CONFIRMATION_REQUIRED",
    "input": {
      "watchlistId": "watchlist-1",
      "ticker": "AAPL"
    },
    "message": "Dry-run validated mutation input. No database write was performed."
  },
  "warnings": ["Dry-run mode: execution was not performed."]
}
```

## Agent Tool API

### List registered tools

- `GET /api/agent/tools`

### Execute a tool

- `POST /api/agent/tools/:toolName/execute`

Request:

```json
{
  "context": {
    "userId": "...",
    "portfolioId": "...",
    "source": "USER",
    "dryRun": false
  },
  "input": {},
  "confirmed": false
}
```

Behavior:

- validates tool existence
- validates input with the registered Zod schema
- enforces execution mode (`CONFIRMATION_REQUIRED`, `DISABLED`)
- executes via the tool executor and returns bounded result metadata

## Agent Chat API (v1)

### Endpoint

- `POST /api/agent/chat`

Request:

```json
{
  "message": "Research AAPL",
  "context": {
    "source": "USER",
    "userId": "optional",
    "portfolioId": "optional",
    "requestId": "optional"
  }
}
```

Response payload includes:

- `answer`
- `intent`
- `toolCalls`
- `suggestedActions`
- `warnings`
- `missingContext`
- `confidence` (`LOW | MEDIUM | HIGH`)
- `metadata`:
  - `mode` (`OPENAI_SYNTHESIS` or `DETERMINISTIC_ROUTER`)
  - `modelName` (only populated when OpenAI synthesis is attempted)
  - `fallbackUsed`
  - `startedAt`
  - `finishedAt`
  - `durationMs`

### Deterministic execution model

- Intent routing and tool execution are always backend-controlled and deterministic.
- OpenAI is only used for final synthesis text when enabled.
- OpenAI does not execute tools directly in Agent v1.
- Tool execution still goes through the registry/executor policy layer.

### OpenAI enablement and fallback

OpenAI synthesis is enabled only when both conditions are true:

- `OPENAI_AGENT_PROVIDER_ENABLED=true`
- `OPENAI_API_KEY` is present

Optional model fallback:

- `OPENAI_AGENT_MODEL_FALLBACK` can be set to a secondary model name.
- Fallback is attempted only when the primary model is unavailable/unsupported.
- Fallback usage is surfaced in metadata/warnings and is not silent.

When OpenAI is disabled, fails, or returns invalid output:

- the backend returns deterministic synthesis
- `metadata.fallbackUsed=true` when OpenAI was attempted but fallback was used
- confirmation policy for refresh/mutation tools remains unchanged

### Non-production diagnostics on fallback

When OpenAI synthesis fails and `NODE_ENV != production`, response metadata may include `openAiDiagnostics`:

- `openAiAttempted`
- `openAiFailureStage` (`REQUEST_FAILED | TIMEOUT | EMPTY_RESPONSE | PARSE_FAILED | VALIDATION_FAILED | UNSUPPORTED_MODEL | UNKNOWN`)
- `openAiErrorCode` (when available)
- `openAiStatus` (when available)
- `openAiResponsePreview` (redacted, max 200 chars)
- `openAiModelName`

### OpenAI synthesis safety rules

- Never log `OPENAI_API_KEY`.
- Never return `OPENAI_API_KEY` in any endpoint.
- Never expose raw model request headers.
- Never send provider API keys to OpenAI.
- Keep synthesis payload compact and avoid sending huge raw provider payloads.
- Suggested actions with unknown tool names are dropped.
- Suggested actions for refresh/mutation/high-impact tools are marked `requiresConfirmation=true`.

## Audit Logging Note

Dedicated per-tool audit log persistence is intentionally deferred.

The current foundation exposes tool metadata (`toolName`, execution mode, risk, timestamps, duration, dry-run flag) to support later audit sink integration without changing tool contracts.

## Rule for LLM Integration

Any future LLM or agentic orchestration must invoke backend capabilities through this tool registry/executor contract.

It must not bypass this layer by calling arbitrary backend API routes.
