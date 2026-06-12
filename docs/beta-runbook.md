# Beta Runbook (Small Hosted Trial)

## Goal

Run a safe hosted beta for two users (you + one friend) with:

- Google OAuth login
- Account-scoped portfolios/watchlists
- Confirmation-gated expensive refresh actions
- Cost-bounded OpenAI usage

## 1) Environment Variables

Backend required:

- DATABASE_URL
- BACKEND_BASE_URL (or APP_BASE_URL)
- FRONTEND_BASE_URL
- FRONTEND_ORIGIN (or CORS_ALLOWED_ORIGINS)
- AUTH_ENABLED
- AUTH_SESSION_SECRET
- AUTH_COOKIE_SECURE
- AUTH_COOKIE_SAME_SITE
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- OPENAI_API_KEY
- OPENAI_AGENT_PROVIDER_ENABLED
- OPENAI_AGENT_MODEL
- OPENAI_REPORT_MODEL
- FMP_API_KEY
- FRED_API_KEY
- PROVIDER_HTTP_TIMEOUT_MS

Backend optional cost controls:

- OPENAI_AGENT_MAX_TOOL_CALLS
- OPENAI_AGENT_MAX_COMPLETION_TOKENS
- OPENAI_DAILY_REQUEST_LIMIT_PER_USER
- OPENAI_MONTHLY_REQUEST_LIMIT_GLOBAL

Frontend env (in frontend deployment, not this backend repo):

- NEXT_PUBLIC_API_BASE_URL
- NEXT_PUBLIC_APP_BASE_URL
- NEXT_PUBLIC_AUTH_CALLBACK_PATH

Notes:

- Keep real secrets only in deployment secret managers.
- Never commit populated .env files.
- Rotate any key that was accidentally exposed.

## 2) Database Migration

Run in backend project:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

For hosted production environments, use your production migration workflow and backup policy before applying migrations.

## 3) Seed Data Policy

Local/dev only:

```bash
npm run prisma:seed
```

Hosted beta:

- Do not run demo seed in production.
- Let each real user create their own portfolio/watchlist context.

## 4) Google OAuth Setup

In Google Cloud Console:

1. Create OAuth client credentials (Web application).
2. Add authorized redirect URI:
   - https://<backend-domain>/api/auth/google/callback
3. Add authorized JavaScript origins for the frontend domain.

Set backend env:

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI

Set frontend callback/base env so auth redirect handling returns users to the app.

## 5) Start Services

Backend:

```bash
npm run build
npm start
```

Frontend (in frontend repo):

- Configure NEXT_PUBLIC_* vars
- Start using the frontend's production/start script

## 6) First Login Smoke Test

1. Open frontend.
2. Start Google sign-in.
3. Complete OAuth consent.
4. Verify /api/auth/me returns authenticated=true.
5. Verify session persists on refresh.

## 7) Portfolio/Watchlist Smoke Test

1. Create portfolio.
2. Add holdings.
3. Create/use watchlist.
4. Verify user A cannot access user B resources.

## 8) Refresh/Agent Smoke Test

1. Trigger assistant request that proposes refresh.
2. Confirm expensive actions require confirmation before execution.
3. Run with dryRun=true once to validate planned action output.
4. Execute confirmed refresh.
5. Verify partial provider failures are warnings/non-blocking where expected.

## 9) Report Generation Smoke Test

1. Call `POST /api/reports/<TICKER>/generate` with `useOpenAi=true`.
2. Verify response includes `reportMode`, `fallbackUsed`, `warnings`, and `dataGaps`.
3. Validate deterministic fallback behavior by temporarily disabling OpenAI (`OPENAI_API_KEY` unset or invalid in non-production), then re-running generation.
4. Confirm report still persists successfully with `reportMode=DETERMINISTIC_FALLBACK`.
5. If using agent tools, validate `generateTickerReport` is confirmation-gated and dry-run returns planned context only.

## 10) Known Limitations (Current Beta)

- OpenAI daily/monthly request limits are process-local in-memory counters.
  - They reset on process restart.
  - Suitable for small beta but not final production billing enforcement.
- No autonomous/background OpenAI execution loops.
- Some provider refresh operations can be slow under upstream latency.

## 11) Rollback Notes

If rollout issues occur:

1. Disable auth quickly by setting AUTH_ENABLED=false (temporary fallback mode).
2. Disable OpenAI quickly by setting OPENAI_AGENT_PROVIDER_ENABLED=false.
3. Redeploy previous backend image/version.
4. Restore DB from latest backup if schema/data rollback is required.
5. Rotate secrets if any leak is suspected.

## 12) Safe Hosting Checklist

- HTTPS enabled for frontend and backend.
- AUTH_COOKIE_SECURE=true in production.
- AUTH_COOKIE_SAME_SITE aligned with domain setup.
- CORS restricted to trusted frontend origins only.
- /api/dev/* unavailable in production.
- Route-map debug unavailable in production.
- No secret values exposed by health/dependency endpoints.
