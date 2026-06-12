# Backend Context (Latest v30)

## Handoff Snapshot

Date:
- 2026-06-11 (night handoff)

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- Working tree: dirty

Scope captured here:
- GDELT reliability hardening finalization
- Google OAuth authentication and account-scoped backend routing
- Beta-readiness hardening pass for small hosted trial (2 users)
- Cost-control and production-safety guardrails
- Full validation and deployment notes

## What Was Completed Tonight

### 1) GDELT reliability hardening (bounded, diagnosable, non-blocking)

Objective:
- Make geopolitical ingestion safer, more diagnosable, and resilient under provider failures.

Completed:
- Added explicit GDELT failure-code taxonomy:
  - GDELT_HTTP_ERROR
  - GDELT_TIMEOUT
  - GDELT_NON_JSON_RESPONSE
  - GDELT_EMPTY_RESPONSE
  - GDELT_PARSE_ERROR
  - GDELT_NO_RESULTS
- Added response-shape diagnostics in provider/client with bounded, redacted previews.
- Hardened content validation for non-JSON/empty/malformed payloads before persistence.
- Added query-profile model and default-risk profile planning (portfolioRisk, macroRisk).
- Preserved non-blocking ingestion behavior with structured failed-query details.
- Updated summary behavior to return actionable guidance when local geopolitical context is empty.

Key files touched:
- src/providers/gdelt/gdelt-client.ts
- src/providers/gdelt/gdelt-provider.ts
- src/providers/gdelt/gdelt.types.ts
- src/providers/types.ts
- src/services/geopolitical-ingestion.service.ts
- src/types/services.ts
- tests/unit/gdelt-client.test.ts
- tests/unit/gdelt-provider.test.ts
- tests/unit/geopolitical-ingestion.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts
- docs/providers.md
- docs/api.md

Behavior outcomes:
- GDELT failures are classified and diagnosable instead of opaque.
- Non-JSON and malformed upstream responses no longer leak unsafe raw error content.
- Full-refresh keeps running and returns warnings/failed-query details instead of hard-failing when GDELT fails.

---

### 2) Google OAuth + session auth + account scoping

Objective:
- Add beta-ready login and strict per-user account isolation while preserving local/dev compatibility.

Completed:
- Added auth domain model changes:
  - AuthProvider enum (LOCAL/GOOGLE/DEV)
  - User identity/auth fields (googleSub, displayName, avatarUrl, emailVerified, authProvider, lastLoginAt)
  - AuthSession table for server-side session tracking
- Added migration for the above schema changes.
- Implemented auth service and guards:
  - signed HTTP-only cookie session
  - OAuth state cookie handling
  - Google code -> ID token verification flow
  - session creation/lookup/clear
  - ownership checks for portfolio/watchlist/holding/report and agent context
- Added auth routes:
  - GET /api/auth/google/start
  - GET /api/auth/google/callback
  - GET /api/auth/me
  - POST /api/auth/logout
  - POST /api/auth/dev-login (non-production only)
- Added route-level ownership/scoping enforcement across user-specific and refresh/mutation endpoints.
- Added agent-context ownership enforcement so agent chat/tool execution derives valid session scope.

Key files touched:
- prisma/schema.prisma
- prisma/migrations/20260611093000_add_google_oauth_sessions/migration.sql
- src/auth/auth.service.ts
- src/auth/auth-guards.ts
- src/auth/index.ts
- src/api/routes/auth.routes.ts
- src/api/schemas/auth.schemas.ts
- src/api/errors.ts
- src/api/routes/index.ts
- src/api/routes/portfolios.routes.ts
- src/api/routes/holdings.routes.ts
- src/api/routes/watchlists.routes.ts
- src/api/routes/reports.routes.ts
- src/api/routes/portfolio-summaries.routes.ts
- src/api/routes/ingestion.routes.ts
- src/api/routes/analyst-ingestion.routes.ts
- src/api/routes/geopolitical.routes.ts
- src/api/routes/agent-tools.routes.ts
- src/app.ts
- src/config/env.ts
- docs/auth.md
- docs/api.md
- tests/integration/api-auth.integration.test.ts

Behavior outcomes:
- AUTH_ENABLED=true enforces authenticated account ownership for key resources and agent paths.
- AUTH_ENABLED=false preserves legacy local/dev userId request flows.
- Dev-login remains unavailable in production.

Compatibility fix completed after regression discovery:
- Reinstated strict create-schema validation in auth-disabled mode (userId required) for legacy VALIDATION_ERROR behavior.
- Kept auth-enabled flexibility by making userId optional only at route-parse time.

Key files touched for compatibility fix:
- src/api/schemas/portfolios.schemas.ts
- src/api/schemas/watchlists.schemas.ts
- src/api/routes/portfolios.routes.ts
- src/api/routes/watchlists.routes.ts

---

### 3) Beta-readiness hardening pass (environment, cost, hosting safety)

Objective:
- Prepare backend for a small hosted beta with explicit safety and cost controls, without overbuilding.

Completed:

Environment and secrets documentation:
- Expanded .env.example with hosted-beta backend and frontend env requirements.
- Added BACKEND_BASE_URL support while preserving APP_BASE_URL compatibility.
- Added AUTH_COOKIE_SAME_SITE, CORS_ALLOWED_ORIGINS, and optional OpenAI budget limits.

CORS and cookie hardening:
- Added trusted-origin resolution with explicit allowlist behavior.
- Blocked wildcard CORS when credentials are enabled.
- Enforced production cookie safety constraints:
  - AUTH_COOKIE_SECURE required for auth in production
  - SameSite=None requires secure cookies
- Added configurable auth cookie sameSite handling.

OpenAI cost controls and deterministic fallback behavior:
- Added per-request maxToolCalls support in chat request schema.
- Added effectiveMaxToolCalls enforcement in planning and execution caps.
- Added optional completion token budget for OpenAI chat completion calls.
- Added optional request-limit gates:
  - OPENAI_DAILY_REQUEST_LIMIT_PER_USER
  - OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL
- Added deterministic fallback mode when request limits are reached.
- Added metadata fields for limit-config/limit-reason in non-production diagnostics.
- Preserved explicit provider-disable fallback behavior and no autonomous background OpenAI loops.

Health/deployment endpoints:
- Added GET /api/health.
- Added GET /api/health/dependencies with non-secret readiness booleans:
  - database status
  - provider config present booleans
  - OpenAI enabled/config booleans
  - auth enabled/config booleans
- Kept legacy health aliases (/health and /health/db).

Production/dev route safety:
- Strengthened production dev-route gating through env-aware registration.
- Ensured route-map debug endpoint remains unavailable in production.
- Scrubbed OpenAI diagnostics and route-context debug metadata from production agent chat responses.
- Preserved production-safe error behavior (no raw stack traces in production envelopes).

Minimal runbook:
- Added docs/beta-runbook.md with setup, migration, OAuth, smoke flow, limitations, and rollback notes.

Key files touched:
- .env.example
- src/config/env.ts
- src/app.ts
- src/auth/auth.service.ts
- src/api/routes/health.routes.ts
- src/api/routes/index.ts
- src/agent/openai-usage-limits.ts
- src/agent/agent-chat.types.ts
- src/api/schemas/agent-tools.schemas.ts
- src/agent/agent-chat.service.ts
- src/agent/openai-agent-client.ts
- src/api/routes/agent-tools.routes.ts
- docs/api.md
- docs/auth.md
- docs/beta-runbook.md

Behavior outcomes:
- Hosted CORS + cookie configuration is explicit and safer by default.
- OpenAI spend can be bounded by tool-call count, completion-token budget, and optional request-limit gating.
- Health readiness can be checked by deployment automation without leaking secrets.

## Tests Added/Updated Tonight

New tests:
- tests/integration/api-auth.integration.test.ts
- tests/unit/gdelt-client.test.ts
- tests/unit/openai-usage-limits.test.ts

Updated tests (targeted to tonight changes):
- tests/integration/api-health.integration.test.ts
- tests/integration/api-dev.integration.test.ts
- tests/integration/api-agent-chat.integration.test.ts
- tests/integration/api-agent-tools.integration.test.ts
- tests/unit/agent-tool-registry.test.ts
- tests/unit/gdelt-provider.test.ts
- tests/unit/geopolitical-ingestion.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts

Checklist coverage added/verified:
1. health endpoint works
2. dependency health endpoint does not expose secrets
3. dev routes blocked in production
4. OpenAI diagnostics hidden in production responses
5. CORS and cookie settings respect env configuration (where testable)
6. confirmation required for expensive refresh tools
7. OpenAI daily/monthly limit behavior (unit coverage)

## Validation Runs Tonight

Focused auth/scoping regression run:
- npx vitest run tests/integration/api-auth.integration.test.ts tests/integration/api-portfolio.integration.test.ts tests/integration/api-watchlists-runtime.integration.test.ts tests/integration/api-agent-chat.integration.test.ts tests/integration/api-agent-tools.integration.test.ts tests/integration/api-ingestion.integration.test.ts
- Result: PASS (6 files, 55 tests)

Focused beta-hardening run:
- npx vitest run tests/integration/api-health.integration.test.ts tests/integration/api-dev.integration.test.ts tests/integration/api-auth.integration.test.ts tests/integration/api-agent-chat.integration.test.ts tests/integration/api-agent-tools.integration.test.ts tests/unit/openai-usage-limits.test.ts tests/unit/agent-chat.service.test.ts tests/unit/openai-agent-client.test.ts
- Result: PASS (8 files, 100 tests)

Full project validation:
- npm run typecheck -> PASS
- npm test -> PASS (54 files, 437 tests)
- npm run build -> PASS

## Security and Secret Hygiene Notes

Verified:
- .env files are ignored by git (.env, .env.local, .env.*.local).
- git ls-files confirms .env variants are not tracked.
- Secret redaction patterns are preserved in provider/OpenAI diagnostic paths.

Action recommended:
- A real OpenAI key exists in local ignored .env state; rotate it before hosted beta if it was shared or exposed outside secret storage.

## Complete File Inventory (Tonight)

Modified tracked files:
- .env.example
- docs/agent/backend-tool-contracts.md
- docs/api.md
- docs/providers.md
- package-lock.json
- package.json
- prisma/schema.prisma
- src/agent/agent-chat.service.ts
- src/agent/agent-chat.types.ts
- src/agent/agent-tool-executor.ts
- src/agent/agent-tool-registry.ts
- src/agent/openai-agent-client.ts
- src/api/errors.ts
- src/api/routes/agent-tools.routes.ts
- src/api/routes/analyst-ingestion.routes.ts
- src/api/routes/geopolitical.routes.ts
- src/api/routes/health.routes.ts
- src/api/routes/holdings.routes.ts
- src/api/routes/index.ts
- src/api/routes/ingestion.routes.ts
- src/api/routes/portfolio-summaries.routes.ts
- src/api/routes/portfolios.routes.ts
- src/api/routes/reports.routes.ts
- src/api/routes/watchlists.routes.ts
- src/api/schemas/agent-tools.schemas.ts
- src/app.ts
- src/config/env.ts
- src/providers/gdelt/gdelt-client.ts
- src/providers/gdelt/gdelt-provider.ts
- src/providers/gdelt/gdelt.types.ts
- src/providers/types.ts
- src/services/geopolitical-ingestion.service.ts
- src/types/services.ts
- tests/integration/api-agent-chat.integration.test.ts
- tests/integration/api-agent-tools.integration.test.ts
- tests/integration/api-dev.integration.test.ts
- tests/integration/api-health.integration.test.ts
- tests/unit/agent-tool-registry.test.ts
- tests/unit/gdelt-provider.test.ts
- tests/unit/geopolitical-ingestion.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts

New files/directories:
- docs/auth.md
- docs/beta-runbook.md
- prisma/migrations/20260611093000_add_google_oauth_sessions/
- src/agent/openai-usage-limits.ts
- src/api/routes/auth.routes.ts
- src/api/schemas/auth.schemas.ts
- src/auth/
- tests/integration/api-auth.integration.test.ts
- tests/unit/gdelt-client.test.ts
- tests/unit/openai-usage-limits.test.ts

## Current State Summary

What is now true:
- GDELT ingestion is more resilient, safer to diagnose, and remains non-blocking where appropriate.
- Google OAuth and server-side session auth are implemented for hosted beta mode.
- Resource access is account-scoped across portfolio/watchlist/holding/report and agent contexts when auth is enabled.
- Existing local/dev flow is preserved when auth is disabled.
- OpenAI usage can be controlled through provider enable flag, per-request tool-call cap, completion token budget, and optional request-limit gating.
- Health/dependency endpoints support deployment checks without exposing secrets.
- Production safety guards are in place for dev routes and diagnostics exposure.

## Remaining Beta Blockers / Follow-Up

1. Frontend wiring still required in frontend repo (Google callback handling and NEXT_PUBLIC env wiring).
2. Google Cloud OAuth app must be configured for hosted frontend/backend domains.
3. Rotate local OpenAI key in .env before beta if exposure risk exists.
4. OpenAI daily/monthly limits are process-local in-memory counters in this pass (acceptable for tiny beta, not final billing-grade enforcement).

## Exact Env Vars Needed For Hosted Beta

Backend required:
- DATABASE_URL
- BACKEND_BASE_URL (or APP_BASE_URL)
- FRONTEND_BASE_URL
- FRONTEND_ORIGIN or CORS_ALLOWED_ORIGINS
- AUTH_ENABLED
- AUTH_SESSION_SECRET
- AUTH_COOKIE_SECURE
- AUTH_COOKIE_SAME_SITE
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- OPENAI_AGENT_PROVIDER_ENABLED
- OPENAI_AGENT_MODEL
- OPENAI_API_KEY (required only when OPENAI_AGENT_PROVIDER_ENABLED=true)
- FMP_API_KEY
- FRED_API_KEY
- PROVIDER_HTTP_TIMEOUT_MS

Backend optional but recommended:
- OPENAI_AGENT_MAX_TOOL_CALLS
- OPENAI_AGENT_MAX_COMPLETION_TOKENS
- OPENAI_DAILY_REQUEST_LIMIT_PER_USER
- OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL

Frontend (frontend repo/deployment):
- NEXT_PUBLIC_API_BASE_URL
- NEXT_PUBLIC_APP_BASE_URL
- NEXT_PUBLIC_AUTH_CALLBACK_PATH

## Files Added In This Context Update

- CONTEXT_LATEST_V30.md

## Suggested Next Prompt

1. Apply equivalent auth callback/session bootstrap updates in the frontend and run a hosted login smoke test.
2. Rotate local OpenAI key and load all hosted secrets through your deployment secret manager.
3. Run one final end-to-end hosted beta checklist from docs/beta-runbook.md.