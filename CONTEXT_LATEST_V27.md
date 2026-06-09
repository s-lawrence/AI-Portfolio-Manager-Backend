# Backend Context (Latest v27)

## Handoff Snapshot

Date:
- 2026-06-08

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty
- This context captures the latest prompt window focused on upgrading Agent v1 orchestration to Agent v2 natural-language planning with OpenAI planner-first execution and deterministic fallback.

## Scope of the Latest Prompt Window

Prompt window covered:
1. Add OpenAI-backed tool planning before backend tool execution.
2. Enforce strict backend validation of planner output.
3. Preserve confirmation policy for refresh/mutation/high-impact tools.
4. Add planner/synthesis fallback metadata and diagnostics continuity.
5. Add planner-focused test coverage and docs.
6. Validate with typecheck/test/build and manual smoke prompts.

Primary objective status:
- Completed.
- Planner-first orchestration path is implemented.
- Tool execution remains backend-controlled through registry/executor only.
- Deterministic router remains fallback path.
- Confirmation safety remains enforced.

Constraints followed:
- Backend-only changes.
- No frontend/auth/paper-trading additions.
- No API key exposure in responses.
- OpenAI does not execute tools directly.
- No bypass of tool registry/executor.
- Standard API envelopes preserved.

## Implementation Details

### 1) Planner contract and types

Updated:
- src/agent/agent-chat.types.ts

Added planner contracts:
- OpenAiToolCatalogItem
- OpenAiToolPlannerInput
- openAiToolPlanToolCallSchema
- openAiToolPlanOutputSchema
- OpenAiToolPlanOutput

Planner output schema:
- intent
- needsTools
- toolCalls[{ toolName, input, purpose }]
- missingContext[]
- requiresConfirmation
- clarifyingQuestion

Agent chat metadata expanded:
- mode now supports:
  - OPENAI_PLANNED_SYNTHESIS
  - OPENAI_SYNTHESIS
  - DETERMINISTIC_ROUTER
- plannerUsed
- plannerFallbackUsed
- plannedToolCount
- executedToolCount
- droppedToolCount
- fallbackReason

Agent chat request expanded:
- allowMutation (alongside allowRefresh)

### 2) OpenAI planner client support

Updated:
- src/agent/openai-agent-client.ts

Added:
- generateToolPlan(input)
- GenerateToolPlanResult

Planner behavior implemented:
- JSON-mode chat completion with strict schema validation.
- Reuses timeout/retry/error mapping behavior.
- Optional fallback model behavior matches synthesis logic.
- Planner system prompt enforces:
  - safe backend planning
  - tool catalog-only selection
  - no direct provider/API calls
  - confirmation-aware planning
  - strict JSON-only output

Synthesis behavior preserved:
- generateAgentSynthesis unchanged in policy intent, now using shared request helpers.

### 3) Agent v2 orchestration flow

Updated:
- src/agent/agent-chat.service.ts

Preferred flow when OpenAI enabled:
1. Build tool catalog from registry.
2. Call OpenAI planner with message + context + catalog.
3. Validate plan and sanitize/dismiss invalid tool calls.
4. Execute approved calls through agentToolExecutor only.
5. Call OpenAI synthesis over tool summaries.

Backend plan validation implemented:
- Unknown tool names dropped.
- Invalid tool inputs dropped using registry Zod validation.
- Max planned tool calls capped by OPENAI_AGENT_MAX_TOOL_CALLS.
- DISABLED tools dropped.
- CONFIRMATION_REQUIRED tools:
  - execute only when confirmedToolExecutions includes tool name and policy gate allows.
  - otherwise return suggestedActions with requiresConfirmation=true.
- Refresh execution gate:
  - requires allowRefresh=true.
- Mutation/high-impact execution gate:
  - requires allowMutation=true.

Missing context / clarifying behavior:
- If planner returns missingContext or clarifyingQuestion, context-dependent calls are blocked.
- Only context-free safe read-only calls are allowed through in that case.

Fallback behavior:
- Planner failure => deterministic router fallback.
- Synthesis failure after planning => deterministic answer fallback using tool results.
- Non-production OpenAI diagnostics retained and surfaced safely.

Natural-language deterministic fallback improvements:
- Deterministic planner fallback covers natural phrases for:
  - daily risk review
  - ticker review (including company alias mapping e.g. Apple -> AAPL)
  - watchlist scoring
  - watchlist add suggestion/confirmation flow
  - refresh requests
- Command-word stopword filtering updated to avoid parsing "ADD" as ticker.

### 4) API schema and route wiring

Updated:
- src/api/schemas/agent-tools.schemas.ts
- src/api/routes/agent-tools.routes.ts

Added request field handling for chat:
- allowMutation
- Existing v1-expanded fields preserved:
  - confirmedToolExecutions
  - confirmedToolInputs
  - allowRefresh
  - dryRun
  - context.userId/portfolioId/watchlistId/ticker

## Tests

Updated:
- tests/unit/agent-chat.service.test.ts
- tests/integration/api-agent-chat.integration.test.ts

Planner-focused unit scenarios covered:
1. Natural message "Anything I should be worried about today?" plans portfolio overview + risk + geopolitical tools.
2. "Take a look at Apple" plans ticker bundle + score for AAPL.
3. "Which watchlist names/stocks look best?" plans scoreWatchlist.
4. "Add NVDA to my watchlist" returns confirmation action and does not mutate.
5. Unknown planner tool is dropped.
6. Invalid planner input is dropped with warning.
7. Planner failure falls back to deterministic router.
8. Synthesis failure after successful planning falls back deterministic with tool summaries.
9. Refresh tool is not executed without confirmation.
10. Confirmed refresh executes only with allowRefresh=true and confirmedToolExecutions.

Integration updates:
- /api/agent/chat route still returns standard envelope.
- Extended chat payload/metadata contract wiring verified.

## Documentation Updates

Updated:
- docs/agent/backend-tool-contracts.md
- docs/api.md

Documented:
- Agent v2 planner-first behavior.
- Backend validation of planner output.
- Confirmation policy enforcement under planner mode.
- Natural-language handling expectation.
- Planner/synthesis fallback behavior and metadata fields.

## Validation Results (Executed)

Commands run:
- npm run typecheck
- npm test
- npm run build

Observed outcomes:
- typecheck: PASS
- tests: PASS
  - Test Files: 47 passed
  - Tests: 315 passed
- build: PASS

## Manual Smoke Results (Executed)

Smoke endpoint:
- POST /api/agent/chat

Environment note:
- OPENAI planner path was attempted.
- In this local runtime, planner fell back due invalid OpenAI key diagnostics (401 invalid_api_key).
- Deterministic fallback executed correctly and still handled natural-language prompts.

Scenario 1:
- Message: "Anything I should be worried about today?" with portfolioId
- Result:
  - success true
  - mode DETERMINISTIC_ROUTER
  - plannerFallbackUsed true
  - intent DAILY_RISK_CHECK
  - tools executed: getPortfolioOverview, getPortfolioRiskSnapshot, getGeopoliticalSummary

Scenario 2:
- Message: "Take a look at Apple"
- Result:
  - success true
  - mode DETERMINISTIC_ROUTER
  - plannerFallbackUsed true
  - intent RESEARCH_TICKER
  - tools executed: getTickerResearchBundle, scoreTickerResearch

Scenario 3:
- Message: "Which watchlist stocks look best?" with watchlistId
- Result:
  - success true
  - mode DETERMINISTIC_ROUTER
  - plannerFallbackUsed true
  - intent WATCHLIST_SCORE
  - tools executed: scoreWatchlist

Scenario 4:
- Message: "Add NVDA to my watchlist" with watchlistId
- Result:
  - success true
  - mode DETERMINISTIC_ROUTER
  - plannerFallbackUsed true
  - intent WATCHLIST_ADD
  - no mutation executed
  - suggestedAction addTickerToWatchlist returned with requiresConfirmation=true

Scenario 5:
- Message: "Confirm add NVDA to my watchlist"
- Inputs: confirmedToolExecutions=[addTickerToWatchlist], allowMutation=true
- Result:
  - success true
  - mode DETERMINISTIC_ROUTER
  - plannerFallbackUsed true
  - intent CONFIRM_TOOL_EXECUTION
  - mutation executed: addTickerToWatchlist

## Files Updated In This Prompt Window

- docs/agent/backend-tool-contracts.md
- docs/api.md
- src/agent/agent-chat.service.ts
- src/agent/agent-chat.types.ts
- src/agent/openai-agent-client.ts
- src/api/routes/agent-tools.routes.ts
- src/api/schemas/agent-tools.schemas.ts
- tests/integration/api-agent-chat.integration.test.ts
- tests/unit/agent-chat.service.test.ts

## Notes and Follow-ups

- Agent v2 planner-first orchestration is in place with strict backend validation and safety policy enforcement.
- Deterministic fallback remains robust and now supports broader natural-language planning behavior.
- To validate full OPENAI_PLANNED_SYNTHESIS runtime mode in local smoke, provide a valid OpenAI key/model; current local key state produced REQUEST_FAILED/401 planner fallback diagnostics.
