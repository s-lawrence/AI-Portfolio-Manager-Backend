import { AuthProvider, User } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes } from "node:crypto";

import { badRequest } from "../api/errors";
import { env } from "../config/env";
import { prisma } from "../db/prisma";

const GOOGLE_OAUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_DEMO_EMAIL = "demo@example.com";
const DEFAULT_DEMO_NAME = "Demo User";

export const AUTH_SESSION_COOKIE_NAME = "apm_session";
export const AUTH_OAUTH_STATE_COOKIE_NAME = "apm_oauth_state";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

type GoogleIdentity = {
  googleSub: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
};

export type AuthUserProfile = {
  id: string;
  email: string;
  googleSub: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  authProvider: AuthProvider;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type AuthSessionContext = {
  sessionId: string;
  userId: string;
  user: AuthUserProfile;
};

function resolveAuthSessionSecret(): string {
  return env.AUTH_SESSION_SECRET ?? "dev-local-auth-session-secret";
}

export function isAuthEnabled(): boolean {
  return env.AUTH_ENABLED;
}

export function resolveAuthCookieSecure(): boolean {
  if (typeof env.AUTH_COOKIE_SECURE === "boolean") {
    return env.AUTH_COOKIE_SECURE;
  }

  return env.NODE_ENV === "production";
}

export function resolveAuthCookieSameSite(): "strict" | "lax" | "none" {
  return env.AUTH_COOKIE_SAME_SITE ?? "lax";
}

function requireGoogleOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw badRequest(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
    );
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

function createGoogleOAuthClient(): OAuth2Client {
  const config = requireGoogleOAuthConfig();
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

function hashSessionToken(token: string): string {
  const secret = resolveAuthSessionSecret();
  return createHash("sha256")
    .update(`${token}:${secret}`)
    .digest("hex");
}

export function toAuthUserProfile(user: User): AuthUserProfile {
  return {
    id: user.id,
    email: user.email,
    googleSub: user.googleSub,
    displayName: user.displayName ?? user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
    emailVerified: user.emailVerified,
    authProvider: user.authProvider,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

function setSignedCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  reply.setCookie(name, value, {
    httpOnly: true,
    sameSite: resolveAuthCookieSameSite(),
    secure: resolveAuthCookieSecure(),
    signed: true,
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

function clearSignedCookie(reply: FastifyReply, name: string): void {
  reply.clearCookie(name, {
    httpOnly: true,
    sameSite: resolveAuthCookieSameSite(),
    secure: resolveAuthCookieSecure(),
    signed: true,
    path: "/",
  });
}

function getSignedCookieValue(request: FastifyRequest, cookieName: string): string | null {
  const rawValue = request.cookies[cookieName];
  if (!rawValue) {
    return null;
  }

  const unsigned = request.unsignCookie(rawValue);
  if (!unsigned.valid || !unsigned.value || unsigned.value.trim().length === 0) {
    return null;
  }

  return unsigned.value;
}

export function setOAuthStateCookie(reply: FastifyReply): string {
  const state = randomBytes(24).toString("hex");
  setSignedCookie(reply, AUTH_OAUTH_STATE_COOKIE_NAME, state, OAUTH_STATE_TTL_SECONDS);
  return state;
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  clearSignedCookie(reply, AUTH_OAUTH_STATE_COOKIE_NAME);
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const config = requireGoogleOAuthConfig();

  const url = new URL(GOOGLE_OAUTH_BASE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);

  return url.toString();
}

export function assertOAuthStateOrThrow(request: FastifyRequest, receivedState: string): void {
  const expectedState = getSignedCookieValue(request, AUTH_OAUTH_STATE_COOKIE_NAME);

  if (!expectedState || !receivedState || expectedState !== receivedState) {
    throw badRequest("Invalid OAuth callback state.");
  }
}

export async function verifyGoogleOAuthCode(code: string): Promise<GoogleIdentity> {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    throw badRequest("OAuth callback code is required.");
  }

  const oauthClient = createGoogleOAuthClient();
  const config = requireGoogleOAuthConfig();

  const tokenResponse = await oauthClient.getToken(normalizedCode);
  const idToken = tokenResponse.tokens.id_token;

  if (!idToken) {
    throw badRequest("Google OAuth callback did not include an id_token.");
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: config.clientId,
  });
  const payload = ticket.getPayload();

  if (!payload?.sub) {
    throw badRequest("Google ID token payload is missing subject.");
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) {
    throw badRequest("Google account did not provide an email address.");
  }

  return {
    googleSub: payload.sub,
    email,
    displayName: typeof payload.name === "string" ? payload.name.trim() || null : null,
    avatarUrl: typeof payload.picture === "string" ? payload.picture.trim() || null : null,
    emailVerified: Boolean(payload.email_verified),
  };
}

async function ensureDefaultUserResources(userId: string): Promise<void> {
  const [portfolioCount, watchlistCount] = await Promise.all([
    prisma.portfolio.count({ where: { userId } }),
    prisma.watchlist.count({ where: { userId } }),
  ]);

  if (portfolioCount === 0) {
    await prisma.portfolio.create({
      data: {
        userId,
        name: "My Portfolio",
        description: "Primary portfolio for this account.",
        baseCurrency: "USD",
      },
    });
  }

  if (watchlistCount === 0) {
    await prisma.watchlist.create({
      data: {
        userId,
        name: "My Watchlist",
        description: "Default watchlist.",
        isDefault: true,
      },
    });
  }
}

export async function upsertGoogleUser(identity: GoogleIdentity): Promise<{ user: User; created: boolean }> {
  const now = new Date();

  const existingByGoogleSub = await prisma.user.findUnique({
    where: { googleSub: identity.googleSub },
  });

  const existingByEmail = existingByGoogleSub
    ? null
    : await prisma.user.findUnique({ where: { email: identity.email } });

  const existingUser = existingByGoogleSub ?? existingByEmail;

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        email: identity.email,
        name: identity.displayName ?? existingUser.name,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        emailVerified: identity.emailVerified,
        googleSub: identity.googleSub,
        authProvider: AuthProvider.GOOGLE,
        lastLoginAt: now,
      },
    });

    return {
      user: updatedUser,
      created: false,
    };
  }

  const createdUser = await prisma.user.create({
    data: {
      email: identity.email,
      name: identity.displayName ?? identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      emailVerified: identity.emailVerified,
      googleSub: identity.googleSub,
      authProvider: AuthProvider.GOOGLE,
      lastLoginAt: now,
    },
  });

  await ensureDefaultUserResources(createdUser.id);

  return {
    user: createdUser,
    created: true,
  };
}

export async function getOrCreateDevAuthUser(input?: {
  email?: string;
  displayName?: string;
}): Promise<User> {
  const email = input?.email?.trim().toLowerCase() || DEFAULT_DEMO_EMAIL;
  const displayName = input?.displayName?.trim() || DEFAULT_DEMO_NAME;
  const now = new Date();

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: displayName,
        displayName,
        emailVerified: true,
        authProvider: AuthProvider.DEV,
        lastLoginAt: now,
      },
    });

    await ensureDefaultUserResources(updated.id);
    return updated;
  }

  const created = await prisma.user.create({
    data: {
      email,
      name: displayName,
      displayName,
      emailVerified: true,
      authProvider: AuthProvider.DEV,
      lastLoginAt: now,
    },
  });

  await ensureDefaultUserResources(created.id);
  return created;
}

export async function createAuthSession(reply: FastifyReply, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      lastUsedAt: new Date(),
    },
  });

  setSignedCookie(reply, AUTH_SESSION_COOKIE_NAME, token, SESSION_TTL_SECONDS);
}

async function getSessionTokenFromRequest(request: FastifyRequest): Promise<string | null> {
  return getSignedCookieValue(request, AUTH_SESSION_COOKIE_NAME);
}

export async function getAuthSessionContextFromRequest(
  request: FastifyRequest,
): Promise<AuthSessionContext | null> {
  const sessionToken = await getSessionTokenFromRequest(request);
  if (!sessionToken) {
    return null;
  }

  const tokenHash = hashSessionToken(sessionToken);
  const session = await prisma.authSession.findUnique({
    where: {
      tokenHash,
    },
    include: {
      user: true,
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const now = new Date();
  await prisma.authSession.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now,
    },
  });

  return {
    sessionId: session.id,
    userId: session.userId,
    user: toAuthUserProfile(session.user),
  };
}

export async function clearAuthSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionToken = await getSessionTokenFromRequest(request);

  if (sessionToken) {
    const tokenHash = hashSessionToken(sessionToken);
    await prisma.authSession.deleteMany({
      where: {
        tokenHash,
      },
    });
  }

  clearSignedCookie(reply, AUTH_SESSION_COOKIE_NAME);
}

export function toAuthRedirectUrl(input: {
  success: boolean;
  reason?: string;
}): string {
  const target = new URL(env.FRONTEND_BASE_URL);
  target.searchParams.set("auth", input.success ? "success" : "error");

  if (input.reason) {
    target.searchParams.set("reason", input.reason);
  }

  return target.toString();
}
