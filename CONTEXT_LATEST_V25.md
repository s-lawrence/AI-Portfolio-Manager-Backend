# Backend Context (Latest v25)

## Handoff Snapshot

Date:
- 2026-06-08

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty
- This context captures the last three prompts focused on adding OpenAI-backed Agent v1 synthesis with deterministic tool execution and fallback safety.

## Scope of the Last Three Prompts

Prompt window covered:
1. Integrate OpenAI into Agent v1 with secure backend-only config and deterministic fallback.
2. Add agent chat orchestration/route, structured synthesis contract, tests, and docs.
3. Validate with typecheck/test/build and manual smoke scenarios for disabled/enabled/fallback behavior.

Primary objective status:
- Completed.
- OpenAI synthesis was added as an optional post-tool-execution layer.
- Deterministic intent routing and backend tool execution remain the system of record.

Constraints followed:
- Backend-only changes.
- No frontend/auth/paper-trading additions.
- No API key exposure in responses.
- No direct OpenAI tool calling in this pass.
- Existing API envelope style preserved.

## Implementation Details

### 1) Environment configuration

Updated:
- src/config/env.ts
- .env.example

Added env fields and defaults:
- OPENAI_API_KEY (optional secret)
- OPENAI_AGENT_MODEL default "gpt-5.4-mini"
- OPENAI_REPORT_MODEL default "gpt-5.4-mini"
- OPENAI_DEEP_RESEARCH_MODEL default "gpt-5.5"
- OPENAI_AGENT_ENABLE_ESCALATION default false
- OPENAI_AGENT_MAX_TOOL_CALLS default 5
- OPENAI_AGENT_TIMEOUT_MS default 30000
- OPENAI_AGENT_PROVIDER_ENABLED default false

Behavior implemented:
- OpenAI path is active only when:
  - OPENAI_AGENT_PROVIDER_ENABLED=true
  - OPENAI_API_KEY present
- Otherwise synthesis stays deterministic.

### 2) OpenAI client wrapper

Added:
- src/agent/openai-agent-client.ts

Implemented:
- generateAgentSynthesis(input)
- generateTickerReport() deferred stub (explicit not implemented in this pass)

Client behavior:
- Uses official OpenAI SDK (`openai`) with API key from env.
- Timeout enforced via AbortController and OPENAI_AGENT_TIMEOUT_MS.
- Model selected from OPENAI_AGENT_MODEL.
- Structured output requested via JSON response format.
- Retries once for transient errors (429/5xx/network transient classes).
- Safe error mapping (no key/header logging, no raw secret exposure).

Dependency updates:
- package.json
- package-lock.json

### 3) Agent chat synthesis flow

Added:
- src/agent/agent-chat.service.ts
- src/agent/agent-chat.types.ts

Updated:
- src/agent/index.ts
- src/api/schemas/agent-tools.schemas.ts
- src/api/routes/agent-tools.routes.ts

New route:
- POST /api/agent/chat

Flow implemented:
1. Determine intent deterministically from user message.
2. Build deterministic execution plan from approved tool names.
3. Execute tools through existing agentToolExecutor only.
4. Build compact synthesis context:
   - user message
   - intent
   - summarized tool results
   - warnings
   - missing context
   - suggested actions
5. If OpenAI enabled, call generateAgentSynthesis.
6. Validate output shape and sanitize suggested actions.
7. If OpenAI disabled/fails/invalid, return deterministic fallback.

Important guardrails:
- OpenAI does not execute tools.
- Unknown tool suggestions from model are dropped.
- Suggested actions are post-processed to enforce requiresConfirmation for refresh/mutation/high-impact tools.
- Execution remains backend-deterministic and policy-controlled.

### 4) Structured output contract

Implemented response fields in agent chat flow:
- answer
- intent
- toolCalls
- suggestedActions
- warnings
- missingContext
- confidence (LOW | MEDIUM | HIGH)
- metadata:
  - mode (OPENAI_SYNTHESIS | DETERMINISTIC_ROUTER)
  - modelName (when OpenAI path attempted)
  - fallbackUsed
  - startedAt
  - finishedAt
  - durationMs

### 5) Prompting/instructions in OpenAI call

System prompt semantics in openai-agent-client enforce:
- Research assistant posture, no certainty claims.
- No guaranteed personalized advice.
- Use only provided tool summaries.
- Mention stale/missing data.
- No fabricated prices/ratings/targets/holdings.
- Distinguish holdings vs watchlist context.
- Confirmation marking for mutation/refresh suggestions.
- Concise actionable output.

### 6) Tests (mocked OpenAI only)

Added:
- tests/unit/agent-chat.service.test.ts
- tests/integration/api-agent-chat.integration.test.ts

Coverage includes:
- OpenAI disabled path uses deterministic mode.
- OpenAI enabled path calls client after tool execution.
- OpenAI invalid output fallback behavior.
- OpenAI error fallback behavior with warning.
- Unapproved tool suggestion rejection.
- Metadata includes modelName/fallbackUsed semantics.
- API envelope and validation behavior for /api/agent/chat.

## Documentation Updates

Updated:
- docs/agent/backend-tool-contracts.md
- docs/api.md
- .env.example

Documented:
- OPENAI_AGENT_PROVIDER_ENABLED and model envs.
- Agent chat endpoint contract.
- Deterministic fallback behavior.
- Tool execution remains backend controlled.
- Confirmation policy unchanged.
- Backend-only key handling expectations.

## Validation Results (Executed)

Commands run:
- npm run typecheck
- npm test
- npm run build

Observed outcomes:
- typecheck: PASS
- tests: PASS
  - Test Files: 47 passed
  - Tests: 310 passed
- build: PASS

## Manual Smoke Results (Executed)

Smoke endpoint:
- POST /api/agent/chat with message "Research AAPL"

Scenario 1 (provider disabled):
- OPENAI_AGENT_PROVIDER_ENABLED=false
- Result:
  - status 200
  - metadata.mode = DETERMINISTIC_ROUTER
  - metadata.fallbackUsed = false
  - intent = RESEARCH_TICKER

Scenario 2 (provider enabled + key present):
- OPENAI_AGENT_PROVIDER_ENABLED=true
- OPENAI_API_KEY present in environment
- Result observed in this environment:
  - status 200
  - metadata.mode = DETERMINISTIC_ROUTER
  - metadata.fallbackUsed = true
  - metadata.modelName = gpt-5.4-mini
- Interpretation:
  - OpenAI path attempted, then deterministic fallback used due runtime synthesis failure/invalid output in local environment.

Scenario 3 (provider enabled + key forced empty):
- OPENAI_AGENT_PROVIDER_ENABLED=true
- OPENAI_API_KEY=""
- Result:
  - status 200
  - metadata.mode = DETERMINISTIC_ROUTER
  - metadata.fallbackUsed = true

## Prompt-by-Prompt Delta Summary

### Prompt 1 delta (OpenAI integration)

Completed:
- Env configuration for OpenAI provider and models.
- OpenAI synthesis client wrapper with timeout/retry/validation safety.
- Agent chat deterministic orchestrator with optional OpenAI synthesis and fallback.

### Prompt 2 delta (tests and docs)

Completed:
- Unit and integration tests for OpenAI/deterministic chat behavior.
- Docs updates for agent contracts, API usage, and env toggles.

### Prompt 3 delta (validation and smoke)

Completed:
- typecheck/test/build all passing.
- Manual smoke scenarios executed for disabled/enabled/fallback conditions.
- Fallback behavior confirmed safe and deterministic.

## Files Added in This Prompt Window

- CONTEXT_LATEST_V25.md
- src/agent/agent-chat.service.ts
- src/agent/agent-chat.types.ts
- src/agent/openai-agent-client.ts
- tests/integration/api-agent-chat.integration.test.ts
- tests/unit/agent-chat.service.test.ts

## Files Updated in This Prompt Window

- .env.example
- CONTEXT_LATEST.md
- docs/agent/backend-tool-contracts.md
- docs/api.md
- package-lock.json
- package.json
- src/agent/index.ts
- src/api/routes/agent-tools.routes.ts
- src/api/schemas/agent-tools.schemas.ts
- src/config/env.ts

## Notes and Follow-ups

- OpenAI enabled smoke in this environment currently falls back; investigate model/key/runtime response validity if OPENAI_SYNTHESIS mode is required in local smoke.
- Confirmation-required execution policy is unchanged and still enforced in executor.
- Deterministic route remains stable as baseline even when OpenAI path fails.
