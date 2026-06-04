# Backend Context (Latest v8)

## Handoff Snapshot

Date:
- 2026-06-03

Repository:
- AI-Portfolio-Manager-Backend (backend only)

Current branch and baseline:
- Branch: main
- HEAD baseline in this session: 933b6bd
- Working tree: dirty (multiple milestone updates are present and not yet committed in this snapshot)

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
- External LLM calls for report generation

## Milestone Summary (Completed)

1. Foundation milestones (already complete before this update)
- Prisma schema + migrations stable.
- Repository/service/API architecture stable.
- Demo context + demo market-data seeding endpoints available.

2. Real FMP market-data ingestion (complete)
- Provider/client foundation and FMP quote/profile/historical ingestion are implemented.
- Ticker + portfolio market-data ingestion API is in place.

3. Real FMP fundamentals ingestion (complete)
- Provider + service orchestration implemented.
- Snapshot persistence is idempotent with same-day protection.

4. Report/prediction idempotency and prediction payload completeness (complete)
- Same-day report upsert behavior added.
- Same-day open predictions reused/updated by day+stock+holding+horizon.
- Prediction payloads include stock metadata and computed dueDate.

5. Real FMP earnings ingestion (complete)
- Upcoming + historical earnings ingestion implemented.
- Event matching supports update-vs-create behavior.

6. Real FMP company news ingestion (complete)
- New FMP news provider implemented and wired.
- News ingestion routes/services for ticker and portfolio added.
- News upsert remains URL-idempotent.
- Deterministic sentiment/materiality fallback added.
- Report news summary now prefers real news over demo news and includes top headlines.

## Key Changes In This Latest Update

### A) New FMP News Provider

Added file:
- src/providers/fmp/fmp-news.provider.ts

Wired in:
- src/providers/fmp/index.ts
- src/providers/fmp/fmp.types.ts
- src/providers/types.ts

Behavior:
- Fetches /news/stock with symbol/date/limit options.
- Maps provider payload to internal ProviderNewsArticle.
- Deduplicates by URL and sorts newest-first.
- Handles 404 as no-data.
- Maps 401/403 to ProviderConfigurationError.
- Maps 429 to ProviderRateLimitError.

### B) News Persistence and Classification Enhancements

Updated:
- src/repositories/news-articles.repository.ts
- src/services/news.service.ts

New capability:
- getNewsArticleByUrl(url) helper for created/updated counting.

New deterministic helper functions:
- classifyNewsSentiment(headline, summary)
- estimateMateriality(headline, summary)
- isDemoNewsArticle(article)

### C) Real Data Ingestion Service Expansion

Updated:
- src/services/real-data-ingestion.service.ts
- src/types/services.ts

New service functions:
- ingestTickerNews(ticker, options?)
- ingestPortfolioNews(portfolioId, options?)

Behavior:
- Ensures stock exists.
- Pulls company news from FMP news provider.
- Upserts by URL.
- Tracks articlesCreated, articlesUpdated, articlesSkipped, warnings.
- Applies fallback sentiment/materiality when provider values are missing.

### D) New News Ingestion API Endpoints

Updated:
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

Added endpoints:
- POST /api/ingestion/fmp/ticker/:ticker/news
- POST /api/ingestion/fmp/portfolio/:portfolioId/news

Request body support:
- ticker route: { limit?: number }
- portfolio route: { limitPerTicker?: number }

### E) AI Report News Summary Improvements

Updated:
- src/services/ai-reports.service.ts

Behavior changes:
- Real news is preferred when both real and demo news exist.
- Demo-only news is explicitly called out in newsSummary.
- Top 1-3 headlines are included in summary text.
- Existing report scoring approach remains otherwise unchanged.

## Tests Added/Updated

Added:
- tests/unit/fmp-news-provider.test.ts

Updated:
- tests/unit/news.service.test.ts
  - sentiment classifier coverage
  - materiality estimator coverage
  - demo-news detector coverage
- tests/unit/real-data-ingestion.service.test.ts
  - ticker news ingestion flow
  - portfolio news partial-failure continuation
- tests/integration/api-ingestion.integration.test.ts
  - ticker news endpoint success envelope
  - portfolio news endpoint success envelope
- tests/unit/ai-reports.service.test.ts
  - real-news summary preference
  - demo-only fallback summary

## Documentation Updated

Updated:
- docs/providers.md
- docs/api.md

Added docs include:
- FMP /news/stock support notes
- News ingestion cURL examples
- News ingestion response fields (articlesCreated/articlesUpdated/articlesSkipped/warnings)
- Idempotency + fallback classification behavior notes

## Validation Status (Latest Known-Good)

Verified successfully after this latest news milestone:
- npm run typecheck
- npm test
  - 25 test files passed
  - 118 tests passed
- npm run build

## Runtime Notes

- npm run dev can fail with EADDRINUSE when port 4000 is occupied.
- This is an environment port conflict, not a compile or test failure.

## Most Relevant Files Next Session

Core news implementation:
- src/providers/fmp/fmp-news.provider.ts
- src/providers/fmp/index.ts
- src/providers/fmp/fmp.types.ts
- src/providers/types.ts
- src/services/real-data-ingestion.service.ts
- src/services/news.service.ts
- src/services/ai-reports.service.ts
- src/repositories/news-articles.repository.ts
- src/types/services.ts
- src/api/schemas/ingestion.schemas.ts
- src/api/routes/ingestion.routes.ts

Tests:
- tests/unit/fmp-news-provider.test.ts
- tests/unit/news.service.test.ts
- tests/unit/real-data-ingestion.service.test.ts
- tests/unit/ai-reports.service.test.ts
- tests/integration/api-ingestion.integration.test.ts

Docs:
- docs/providers.md
- docs/api.md

## Resume Checklist

1. Ensure local Postgres is up.
2. Run npm run typecheck.
3. Run npm test.
4. Run npm run build.
5. Start API and validate:
- POST /api/ingestion/fmp/ticker/AAPL/news
- POST /api/ingestion/fmp/portfolio/<PORTFOLIO_CUID>/news
6. Generate a ticker report and verify:
- real headlines appear when available
- demo-only fallback text appears when only demo articles exist
