import type { FastifyInstance } from "fastify";

import {
  assertOAuthStateOrThrow,
  buildGoogleAuthorizationUrl,
  clearAuthSession,
  clearOAuthStateCookie,
  createAuthSession,
  getOrCreateDevAuthUser,
  isAuthEnabled,
  optionalAuth,
  setOAuthStateCookie,
  toAuthRedirectUrl,
  toAuthUserProfile,
  upsertGoogleUser,
  verifyGoogleOAuthCode,
} from "../../auth";
import { badRequest, notFound, runService } from "../errors";
import { ok } from "../response";
import {
  authDevLoginBodySchema,
  authGoogleCallbackQuerySchema,
} from "../schemas/auth.schemas";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/google/start", async (_request, reply) => {
    if (!isAuthEnabled()) {
      throw notFound("Authentication is disabled.");
    }

    const state = setOAuthStateCookie(reply);
    const authUrl = buildGoogleAuthorizationUrl(state);
    return reply.redirect(authUrl);
  });

  app.get("/google/callback", async (request, reply) => {
    if (!isAuthEnabled()) {
      throw notFound("Authentication is disabled.");
    }

    const query = authGoogleCallbackQuerySchema.parse(request.query ?? {});

    if (query.error) {
      clearOAuthStateCookie(reply);
      return reply.redirect(toAuthRedirectUrl({ success: false, reason: query.error }));
    }

    if (!query.code || !query.state) {
      throw badRequest("Google OAuth callback is missing required code/state parameters.");
    }

    try {
      assertOAuthStateOrThrow(request, query.state);
      clearOAuthStateCookie(reply);

      const identity = await verifyGoogleOAuthCode(query.code);
      const { user } = await upsertGoogleUser(identity);
      await createAuthSession(reply, user.id);

      return reply.redirect(toAuthRedirectUrl({ success: true }));
    } catch (error) {
      clearOAuthStateCookie(reply);
      request.log.error(error, "google oauth callback failed");
      return reply.redirect(toAuthRedirectUrl({ success: false, reason: "oauth_callback_failed" }));
    }
  });

  app.post("/logout", async (request, reply) => {
    if (!isAuthEnabled()) {
      reply.send(
        ok({
          authEnabled: false,
          authenticated: false,
          loggedOut: true,
          user: null,
        }),
      );
      return;
    }

    await runService(() => clearAuthSession(request, reply));

    reply.send(
      ok({
        authEnabled: true,
        authenticated: false,
        loggedOut: true,
        user: null,
      }),
    );
  });

  app.get("/me", async (request, reply) => {
    if (!isAuthEnabled()) {
      reply.send(
        ok({
          authEnabled: false,
          authenticated: false,
          user: null,
        }),
      );
      return;
    }

    const session = await runService(() => optionalAuth(request));

    if (!session) {
      reply.send(
        ok({
          authEnabled: true,
          authenticated: false,
          user: null,
        }),
      );
      return;
    }

    reply.send(
      ok({
        authEnabled: true,
        authenticated: true,
        user: session.user,
      }),
    );
  });

  app.post("/dev-login", async (request, reply) => {
    if (process.env.NODE_ENV === "production") {
      throw notFound("dev-login is unavailable in production.");
    }

    if (!isAuthEnabled()) {
      throw badRequest("AUTH_ENABLED must be true to use /api/auth/dev-login.");
    }

    const body = authDevLoginBodySchema.parse(
      typeof request.body === "object" && request.body != null ? request.body : {},
    );

    const user = await runService(() =>
      getOrCreateDevAuthUser({
        email: body.email,
        displayName: body.displayName,
      }),
    );

    await runService(() => createAuthSession(reply, user.id));

    reply.send(
      ok({
        authEnabled: true,
        authenticated: true,
        devLogin: true,
        user: toAuthUserProfile(user),
      }),
    );
  });
}
