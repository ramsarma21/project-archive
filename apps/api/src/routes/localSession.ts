// POST /v1/auth/local-session — a server session for a local development profile.
//
// WHY IT EXISTS. A LOCAL profile used to be browser-only, so the game ran signed
// out: unranked, unlimited, and with the boss duel's grading 401ing into a free
// magazine. This route makes a local profile a real session — the same session
// shape and cookie a Google sign-in produces — so `useProgression`, M1 grading,
// progression and PvP all see one durable profile.
//
// WHY IT IS NOT A PRODUCTION BYPASS. It is mounted only when `enabled` is true,
// which defaults to NODE_ENV !== "production"; in production it answers 404 and
// there is no anonymous path to a session. It validates a real UUID, a bounded
// non-blank name and a 64-hex seed, and it resolves the identity through the
// dedicated `local-dev` issuer under an advisory lock (see auth.ts) so the FIRST
// login fixes the name and seed and every later one returns stored authority.
//
// The profile resolver and the session minter are INJECTED so this route is
// testable without a database — the same seam the PvP and duel routes use.

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { OnboardingPreferencesSchema } from "@pa/contracts";
import { csrfTokenForSession, type ProfileRow } from "../auth.js";

const SESSION_COOKIE = "pa_session";

/**
 * What a local login may say, and nothing else. Strict: a client cannot smuggle
 * an accountId or a role in beside the three fields it owns.
 */
export const LocalSessionRequestSchema = z
  .object({
    profileId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(80),
    seedHex: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type LocalSessionRequest = z.infer<typeof LocalSessionRequestSchema>;

export interface LocalSessionDeps {
  /** Resolve or create the durable local-dev account+profile. First write wins. */
  readonly resolveProfile: (input: {
    localProfileId: string;
    displayName: string;
    seedHex: string;
  }) => Promise<ProfileRow>;
  /** Mint the normal session, exactly as the Google callback does. */
  readonly createSession: (profileId: string, accountId: string) => Promise<string>;
  /** Non-production only. Defaults to NODE_ENV !== "production". */
  readonly enabled?: boolean;
  /** Match the app's cookie policy. */
  readonly cookieSecure?: boolean;
  /**
   * Mint a tab-scoped dev-session handle mapped server-side to the freshly minted
   * session id. Returned to the client so it can carry a per-tab identity in a
   * header instead of relying on the shared cookie. Injected so a test can assert
   * the handle is returned without the process-wide store; absent means no handle
   * is issued and the response is exactly the pre-existing cookie-only shape.
   */
  readonly mintDevSession?: (sessionId: string) => string;
}

function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function registerLocalSessionRoute(
  app: FastifyInstance,
  deps: LocalSessionDeps,
): void {
  const enabled = deps.enabled ?? process.env.NODE_ENV !== "production";
  app.post("/v1/auth/local-session", async (request, reply) => {
    if (!enabled) {
      // Unavailable in production. A 404 rather than a 403 so the surface is
      // simply absent rather than advertised.
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    const parsed = LocalSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const profile = await deps.resolveProfile({
      localProfileId: parsed.data.profileId,
      displayName: parsed.data.displayName,
      seedHex: parsed.data.seedHex,
    });
    const sid = await deps.createSession(profile.id, profile.account_id);
    setSessionCookie(reply, sid, deps.cookieSecure ?? false);
    // A tab-scoped handle onto this same session. The web client stores it in
    // sessionStorage (per-tab) and sends it in a dedicated header, so a second tab
    // can hold a DIFFERENT local profile even though the cookie is shared. The
    // handle is a separate random value, never the cookie/session credential.
    const devSession = deps.mintDevSession?.(sid);

    // The normal session shape, so the web client can treat this response exactly
    // like /v1/session.
    const onboarding = OnboardingPreferencesSchema.safeParse(
      profile.onboarding_preferences,
    );
    return {
      authenticated: true,
      csrfToken: csrfTokenForSession(sid),
      ...(devSession ? { devSession } : {}),
      profile: {
        profileId: profile.id,
        accountId: profile.account_id,
        displayName: profile.display_name,
        variationRootSeedHex: profile.variation_root_seed_hex,
        onboarding: onboarding.success ? onboarding.data : null,
        createdAt: profile.created_at,
      },
    };
  });
}
