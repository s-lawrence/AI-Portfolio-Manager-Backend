# Backend Context (Latest v32)

## Handoff Snapshot

Date:
- 2026-07-01

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty (contains earlier in-progress changes plus this completed recommendation/report hardening scope)

Scope captured here:
- Detailed handoff for the last three implemented prompt cycles in this session.
- Focus is backend agent conversational recommendations, safe action orchestration, and report/tool reliability.

## Last Three Implemented Prompt Cycles

### Prompt Cycle 1: Continue iteration on ticker intelligence and report/tool execution hardening

Primary intent:
- Improve deterministic, ownership-safe, action-oriented backend tooling around ticker resolution, watchlist scoring, refresh operations, and report generation behavior.

Major changes:

1. New/expanded agent tools and contracts:
- Added resolveTickerOrCompany read-only tool for canonical ticker resolution with ambiguity detection and no blind auto-selection of short ambiguous symbols.
- Added rankWatchlist as canonical alias for scoreWatchlist.
- Added refreshTickerResearchData as confirmation-required refresh tool with section-level execution and partial-failure warnings.
- Expanded addTickerToWatchlist input to accept optional addedReason.

2. Tool payload and summary improvements:
- getTickerResearchBundle now returns richer context including data-quality and deterministic score metadata.
- scoreTickerResearch outputs include actionLabel and confidence.
- Executor dataSummary branches added/expanded for resolveTickerOrCompany, screenMarketCandidates, refreshTickerResearchData, and rankWatchlist compatibility.

3. Report generation hardening:
- ai-reports.service now has stronger OpenAI fallback orchestration and deterministic fallback persistence with structured provenance.
- Added policy normalization for OpenAI structured output:
  - low data quality forces low conviction,
  - mixed evidence normalizes BUY/SELL to WATCH,
  - analyst target language is stripped when target data is absent.
- Added bounded context array handling and improved context as-of timestamp derivation.

4. Confirmation path behavior:
- Explicit report-generation asks are allowed to execute generateTickerReport through planner validation when user intent is clearly report generation (while keeping other confirmation rules intact).

Primary files touched:
- src/agent/agent-tool.types.ts
- src/agent/agent-tool-registry.ts
- src/agent/agent-tool-executor.ts
- src/agent/agent-chat.service.ts
- src/services/research-scoring.service.ts
- src/services/ai-reports.service.ts
- src/types/services.ts

Test coverage touched in this cycle:
- tests/unit/agent-tool-registry.test.ts
- tests/unit/ai-reports.service.test.ts
- tests/integration/api-agent-tools.integration.test.ts
- tests/integration/api-auth.integration.test.ts
- tests/integration/api-portfolio.integration.test.ts

---

### Prompt Cycle 2: Continue iteration on conversational, recommendation-first market screening

Primary intent:
- Make agent recommendations conversational, preference-aware, and action-oriented while preserving backend safety constraints.

Major changes:

1. New screening model and service:
- Added preference and screening types:
  - AgentInvestmentPreferences
  - ScreenMarketCandidatesOptions
  - ScreenMarketCandidatesResult and candidate/rejection shapes
- Implemented screenMarketCandidates in market-discovery service:
  - candidate pooling from persisted discovery and stock data,
  - preference normalization/default assumptions,
  - preference-fit and portfolio-fit scoring,
  - qualification thresholding,
  - rejected-candidate rationale,
  - suggested refresh actions.

2. Tool registration and routing:
- Registered screenMarketCandidates as READ_ONLY and AUTO_ALLOWED.
- Added screenMarketCandidates dataSummary in executor.
- Prompt/planner guidance updated to prefer screening flow for new holding discovery.

3. Conversational planning updates in agent chat:
- Added extraction of preference signals from natural language.
- Added objective clarification rule for ambiguous recommendation asks with exact question:
  - What are you optimizing for: growth, dividends, lower risk, or diversification?
- Added sensible defaults when objective is absent but prompt is specific enough.
- MARKET_CANDIDATE_DISCOVERY path now routes through screenMarketCandidates instead of relying on legacy ranking as primary path.

4. Action-oriented suggestion behavior:
- Suggested addTickerToWatchlist actions now built from qualified screening output only.
- Suggested watchlist payload includes source, status, priority, and addedReason.
- Confirmation-required semantics are preserved for mutations.

Primary files touched:
- src/services/market-discovery.service.ts
- src/types/services.ts
- src/agent/agent-tool.types.ts
- src/agent/agent-tool-registry.ts
- src/agent/agent-tool-executor.ts
- src/agent/agent-chat.service.ts
- src/agent/openai-agent-client.ts

Test coverage touched in this cycle:
- tests/unit/agent-chat.service.test.ts

---

### Prompt Cycle 3: Continue iteration on stabilization, ownership guardrails, docs, and full validation

Primary intent:
- Stabilize behavior under edge cases, preserve strict auth/ownership and confirmation policy, and validate/document final behavior.

Major changes:

1. Ownership-safe planner input handling:
- Added guardrails for planner-supplied optional portfolioId/watchlistId so execution only proceeds when ids match canonical context.
- Optional-context tools now safely receive canonical portfolio context when available.

2. Clarification heuristic refinement:
- Avoid over-triggering objective clarification when concrete constraints already exist (for example risk, region, sector, currency, horizon).
- Keeps clarification strict for truly ambiguous generic recommendation prompts.

3. Confirmation semantics and follow-up actions:
- Confirmed mutation execution honors confirmedToolInputs payload.
- After successful addTickerToWatchlist confirmation, follow-up suggestions are generated (for example refreshWatchlistResearchData or generateTickerReport).

4. Documentation updates:
- Updated backend tool contract docs for new/expanded tools and payload semantics.
- Updated API docs for screening flow, clarification behavior, and confirmed input execution semantics.

Primary files touched:
- src/agent/agent-chat.service.ts
- docs/agent/backend-tool-contracts.md
- docs/api.md

Test coverage touched in this cycle:
- tests/unit/agent-chat.service.test.ts

---

## Consolidated Behavior After These Three Cycles

1. Recommendation integrity:
- Candidate recommendations are now screening-driven, preference-aware, and based on persisted backend data only.
- No ticker hallucination path was introduced.

2. Safety and governance:
- Auth/account ownership scoping remains enforced.
- Confirmation-required operations remain gated.
- Planner-injected ownership ids are blocked unless they match canonical request context.

3. Action orientation:
- Recommendation responses can produce qualified, confirmation-required watchlist actions with richer rationale payloads.
- Confirmed actions feed deterministic next-step suggestions.

4. Report robustness:
- OpenAI report path now degrades deterministically with explicit warnings and policy normalization controls.

## Validation Summary

Historical validation completed during implementation window:
- npm run typecheck: PASS
- npm test: PASS (56 files, 517 tests)
- npm run build: PASS

Latest focused re-validation (most recent run):
- npm run typecheck: PASS
- npx vitest run tests/unit/agent-chat.service.test.ts tests/unit/agent-tool-registry.test.ts tests/unit/ai-reports.service.test.ts tests/integration/api-agent-tools.integration.test.ts tests/integration/api-auth.integration.test.ts tests/integration/api-portfolio.integration.test.ts --reporter=dot
- Result: PASS (6 files, 184 tests, exit code 0)

## Files Most Relevant For Future Follow-Up

Core orchestration and planning:
- src/agent/agent-chat.service.ts
- src/agent/openai-agent-client.ts

Tool contracts and execution:
- src/agent/agent-tool.types.ts
- src/agent/agent-tool-registry.ts
- src/agent/agent-tool-executor.ts

Screening and scoring logic:
- src/services/market-discovery.service.ts
- src/services/research-scoring.service.ts
- src/types/services.ts

Report reliability:
- src/services/ai-reports.service.ts

Docs:
- docs/agent/backend-tool-contracts.md
- docs/api.md

## Residual Risks and Suggested Next Steps

Residual risks:
- Manual end-to-end interactive smoke of recommendation and confirm flows was not executed in a UI session in this handoff cycle.
- Heuristic extraction is keyword-driven; future refinements may be needed for broader natural-language coverage.

Suggested next steps:
1. Run manual API smoke for ambiguous recommendation ask, clear preference ask, suggested add action, and confirmed execution with confirmedToolInputs.
2. Decide whether rankDiscoveryCandidates should remain as a compatibility path or be fully deprecated after screening rollout.
3. If needed, add additional scenario tests for mixed-objective phrasing and multilingual phrasing.
