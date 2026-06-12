# Authentication Guide (Beta)

## Overview

This backend supports Google OAuth (OpenID Connect) with session-cookie auth for beta testing.

Modes:

- `AUTH_ENABLED=false` (default local/dev compatibility): auth is effectively off for application data routes.
- `AUTH_ENABLED=true` (beta hosted mode): authenticated session and account scoping are enforced.

## Required Environment Variables

- `AUTH_ENABLED`
- `AUTH_SESSION_SECRET`
- `AUTH_COOKIE_SECURE`
- `AUTH_COOKIE_SAME_SITE`
- `BACKEND_BASE_URL` (or `APP_BASE_URL` for compatibility)
- `FRONTEND_BASE_URL`
- `FRONTEND_ORIGIN` (or `CORS_ALLOWED_ORIGINS`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

See `.env.example` for all values.

## Google OAuth Setup

1. Create OAuth credentials in Google Cloud Console.
2. Add your backend callback URL to authorized redirect URIs.
3. Set:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`

Recommended local callback:

- `http://localhost:4000/api/auth/google/callback`

Recommended local frontend base URL:

- `http://localhost:3000`

## Session Strategy

- Backend stores session state in `AuthSession` table.
- Browser stores opaque signed cookie (`apm_session`).
- Session cookie is HTTP-only and `SameSite` is configurable via `AUTH_COOKIE_SAME_SITE`.
- Cookie `secure` flag behavior:
  - Explicit `AUTH_COOKIE_SECURE` value when set.
  - Otherwise defaults to `true` in production and `false` outside production.
- If `AUTH_COOKIE_SAME_SITE=none`, `AUTH_COOKIE_SECURE=true` is required.

## User Identity Fields

Google-authenticated user records store stable identity fields:

- `googleSub`
- `email`
- `displayName`
- `avatarUrl`
- `emailVerified`
- `authProvider`
- `lastLoginAt`
- `createdAt`
- `updatedAt`

Google access tokens are not persisted.

## Default Data on First Login

On first successful Google sign-in:

- user account is created/updated
- one default empty portfolio is created if user has none
- one default watchlist is created if user has none

No fake analytical seed data is created for real Google users.

## API Endpoints

- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/dev-login` (non-production only)

## Dev Login Route

`POST /api/auth/dev-login` is intended for non-production local/test session setup.

- unavailable in production
- requires `AUTH_ENABLED=true`
- creates/uses a local dev user and sets session cookie

## Account Scoping Rules

When `AUTH_ENABLED=true`:

- user-specific routes require session auth.
- portfolio/watchlist/holding/report access is ownership-scoped.
- agent chat/tool route context user identity is derived from session.
- user-supplied IDs that conflict with session user are rejected.

## Security Notes

- Do not expose provider API keys to frontend.
- Use strong `AUTH_SESSION_SECRET` in hosted environments.
- Set `AUTH_COOKIE_SECURE=true` in production.
- Use `AUTH_COOKIE_SAME_SITE=none` only when frontend/backend are on different sites.
- Restrict CORS to trusted frontend origins only.
- Use HTTPS for hosted deployment.
