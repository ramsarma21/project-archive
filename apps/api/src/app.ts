import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { OnboardingPreferencesSchema } from "@pa/contracts";
import { migrate, query } from "./db.js";
import {
  buildGoogleAuthUrl,
  cleanupExpiredAuthData,
  completeGoogleCallback,
  createSession,
  csrfTokenForSession,
  getSessionUser,
  googleCallbackErrorReason,
  googleConfigured,
  resolveLocalDevProfile,
  resolveProfile,
  revokeSession,
} from "./auth.js";
import {
  devSessionStore,
  devSessionsEnabled,
  effectiveSessionId,
  googleCallbackSuccessRedirect,
  requestDevSessionHandle,
} from "./devSession.js";
import { reportingService } from "@pa/reporting";
import { registerDuelRoutes } from "./routes/duels.js";
import { registerEncounterRoutes } from "./routes/encounters.js";
import { registerProgressionRoutes } from "./routes/progression.js";
import { registerPvpRoutes } from "./routes/pvp.js";
import { registerReportingRoutes } from "./routes/reporting.js";
import { registerLocalSessionRoute } from "./routes/localSession.js";
import { registerDevResetRoute } from "./routes/devReset.js";
import { createDuelGrading } from "./duels/grading.js";
import { postgresDuelVerdictStore } from "./duels/verdictStore.js";
import { m1DuelId, m1ExpectedDuelItem } from "@pa/mission-m1";
import { createPvpGrading } from "./pvp/grading.js";
import {
  BOSTON_RUNTIME_CHAPTER_ID,
  M1_MISSION_ID,
  M1_MODULE_ID,
  bostonProgressionContent,
} from "./progression/content.js";
import { assessmentPassedFromSnapshot, pvpCardResolver } from "./pvp/cardAccess.js";
import { postgresProgressionStore } from "./progression/postgresStore.js";
import { postgresConceptRetrievalStore } from "./progression/retrievalStore.js";
import { ProgressionService } from "./progression/service.js";

const SESSION_COOKIE = "pa_session";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

/**
 * Response headers a cross-origin browser is allowed to read.
 *
 * `fetch` cannot see a response header that is not listed here, and until it was
 * listed the duel's verdict receipt was unreadable from any origin but the API's
 * own. Development goes through Vite's same-origin proxy, which is why nobody
 * noticed: the header was there, the client could read it, and a deployment that
 * serves the API from an API Gateway domain could not. The receipt is what proves
 * the server minted a verdict, so a client that cannot read it cannot carry it to
 * the commit and the signature stays decoration.
 *
 * The other three are diagnostics: which path graded the round, how long it took,
 * and — when the round was granted without being graded — why. None of them can
 * influence a bullet count; the duel derives that from `kind` alone.
 */
const EXPOSED_HEADERS = [
  "x-pa-verdict-receipt",
  "x-pa-grading-path",
  "x-pa-grading-latency-ms",
  "x-pa-grading-fallback",
  // So the web encounter client can read whether a verdict was the generous
  // infrastructure grant when the app is served cross-origin (dev is same-origin
  // via the Vite proxy, which is why this could ship unreadable otherwise).
  "x-pa-encounter-granted",
  // The boss-duel evidence gate's feedback class (TOO_FEW, INCOMPATIBLE, …). A
  // misconception class only, never which cards were relevant, so the answering
  // player can be told why their evidence fell short without the answer leaking.
  "x-pa-evidence",
];

function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

async function requireOwner(req: FastifyRequest, profileId: string) {
  const user = await getSessionUser(effectiveSessionId(req));
  if (!user) return { error: "AUTH_REQUIRED" as const };
  if (user.profileId !== profileId) return { error: "PROFILE_FORBIDDEN" as const };
  return { user };
}

export async function buildApp(options: { runMigrations?: boolean } = {}): Promise<FastifyInstance> {
  if (options.runMigrations !== false) await migrate();

  const app = Fastify({
    logger: process.env.NODE_ENV === "production",
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: WEB_ORIGIN,
    credentials: true,
    exposedHeaders: EXPOSED_HEADERS,
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("cross-origin-resource-policy", "same-site");
    if (COOKIE_SECURE) {
      reply.header(
        "strict-transport-security",
        "max-age=31536000; includeSubDomains",
      );
    }
    return payload;
  });
  // Boston's authored pack: the XP curve, the mission award ramp and the
  // ability unlock schedule all come from @pa/abilities, and the module decks
  // gate every attempt. The capstone's item bank is still unauthored, so an
  // assessment mutation continues to report PACKAGE_MISSING.
  const progressionContent = bostonProgressionContent();
  const progression = new ProgressionService(
    postgresProgressionStore(),
    progressionContent,
  );
  // The nine M1 Codex cards, from the API's own card map rather than a hand-list.
  // These are what the PLAYTEST_ALL access policy grants every PvP caller today.
  const m1CardIds = progressionContent.codexCardsForModule(M1_MODULE_ID);
  // The boss duel's grading authority. Without it the client's 1.5-second cap
  // fires on every round and grants the maximum, which looks exactly like
  // working grading.
  //
  // Built here rather than inside the duel routes because two route tables need
  // it: the duel MINTS a verdict receipt and progression VERIFIES one at the
  // commit, and the two must be holding the same signing key for the check to
  // mean anything. Sharing the instance is what makes that true by construction
  // instead of by two files agreeing about an environment variable.
  const duelGrading = createDuelGrading(app.log);
  // The formative retrieval ledger, shared by the duel and encounter routes (which
  // WRITE it at grade time) and the dev-reset (which clears it). It moves no gate:
  // nothing here writes concept_mastery or touches PvP card legality. See
  // progression/retrievalStore.ts.
  const retrieval = postgresConceptRetrievalStore();
  await registerProgressionRoutes(app, progression, {
    verifyVerdictReceipt: duelGrading.verifyReceipt,
  });
  // The boss duel is bound to the authenticated profile's OWN open attempt. The
  // route no longer trusts a client-supplied duelId/itemId: it resolves the open
  // progression attempt, requires the request's duel id to be that attempt's
  // canonical one, and grades the item the round actually asks — computed from the
  // stored attempt seed and ordinal by the same @pa/mission-m1 algorithm the client
  // runs. The verdict store makes the first minted verdict per {profile, duel,
  // round} final, so a changed second answer cannot re-grade the round.
  await registerDuelRoutes(app, {
    grading: duelGrading,
    resolveAttempt: async (profileId) => {
      try {
        const snapshot = await progression.snapshot(profileId);
        const open = snapshot.openAttempt;
        if (!open) return null;
        return {
          attemptId: open.attemptId,
          attemptOrdinal: open.attemptOrdinal,
          attemptSeedHex: open.attemptSeedHex,
          missionId: open.missionId,
          chapterId: open.chapterId,
        };
      } catch (cause) {
        app.log.warn({ cause, profileId }, "duel: open attempt unreadable; refusing");
        return null;
      }
    },
    questionAuthority: {
      duelId: (attempt) => m1DuelId(attempt.attemptOrdinal),
      expectedItemId: (attempt, round) =>
        m1ExpectedDuelItem({
          attemptSeedHex: attempt.attemptSeedHex,
          attemptOrdinal: attempt.attemptOrdinal,
          round,
        }).item.itemId,
      // The repeat marker for the retrieval ledger: the same seeded selection the
      // client and grader use already reports whether this round recycles an item.
      roundAppearance: (attempt, round) => {
        const asked = m1ExpectedDuelItem({
          attemptSeedHex: attempt.attemptSeedHex,
          attemptOrdinal: attempt.attemptOrdinal,
          round,
        });
        return { recycled: asked.recycled, appearance: asked.appearance };
      },
    },
    verdictStore: postgresDuelVerdictStore(),
    retrieval,
    // The boss is the mission capstone: a player who reaches it holds the whole M1
    // deck, and the evidence hand is drawn from exactly these nine. Server-derived
    // from the card map, never hand-listed.
    evidenceAuthorizedCardIds: m1CardIds,
  });
  // The forced perspective encounters share the duel's authority machinery: the
  // same open-attempt resolver, signed grading over the encounter bank, and the
  // same durable first-verdict store — the encounter's canonical id namespaces
  // its verdict rows inside `duel_verdicts`, so there is no new migration. The
  // route grades the item the stop asks (recomputed from the stored attempt),
  // never the client's claim, and a wrong answer still resolves so a stop cannot
  // soft-lock the route.
  await registerEncounterRoutes(app, {
    // Shares the DUEL's grading signal, so encounter rounds fold into the same
    // rolling fallback rate `/v1/health` reads. The encounter route builds its own
    // grading (its bank differs), and without this its signal stayed private — so a
    // real encounter-grading outage read as healthy on the one endpoint meant to
    // report it. Passing the shared signal closes that blind spot; nothing here ever
    // changes the health status code.
    signal: duelGrading.signal,
    resolveAttempt: async (profileId) => {
      try {
        const snapshot = await progression.snapshot(profileId);
        const open = snapshot.openAttempt;
        if (!open) return null;
        return {
          attemptId: open.attemptId,
          attemptOrdinal: open.attemptOrdinal,
          attemptSeedHex: open.attemptSeedHex,
          missionId: open.missionId,
          chapterId: open.chapterId,
        };
      } catch (cause) {
        app.log.warn({ cause, profileId }, "encounter: open attempt unreadable; refusing");
        return null;
      }
    },
    verdictStore: postgresDuelVerdictStore(),
    retrieval,
  });
  // PvP holds its lobbies and live matches in memory, so a restart loses a code and
  // at most one fight. Standing is durable in pvp_standing (migration 007): a
  // leaderboard that evaporates is the one loss a playtest cannot absorb.
  await registerPvpRoutes(app, {
    // Built with the DUEL's grading signal, so PvP rounds record into the same rolling
    // fallback rate the boss duel does and `/v1/health.grading` reflects both modes.
    // Health semantics stay shared: one signal, one status word, one alarm.
    ...createPvpGrading(app.log, { signal: duelGrading.signal }),
    // The capstone-sharing guard's one input. A profile whose progression cannot
    // be read is treated as having mastered nothing, which WITHHOLDS the shared
    // capstone items rather than leaking a gate question into a duel — the pool
    // clears the round ceiling without them, so failing closed costs nothing.
    masteredConcepts: async (profileId) => {
      try {
        const snapshot = await progression.snapshot(profileId);
        return snapshot.conceptMastery
          .filter((concept) => concept.masteredAt !== null)
          .map((concept) => concept.conceptId);
      } catch (cause) {
        app.log.warn({ cause, profileId }, "pvp: mastery unreadable; withholding capstone items");
        return [];
      }
    },
    // The server-side card resolver. Today's policy (M1_PVP_CARD_ACCESS) is
    // PLAYTEST_ALL, so this hands every caller the nine M1 cards without reading the
    // snapshot. Flip that one value to ASSESSMENT_PASSED and this grants the cards
    // only once the caller's chapter assessment has passed — the snapshot read below
    // is what makes that authoritative rather than trusting the client.
    resolvePvpCardIds: pvpCardResolver({
      m1CardIds,
      log: app.log,
      assessmentPassed: async (profileId) =>
        assessmentPassedFromSnapshot(await progression.snapshot(profileId)),
    }),
  });
  // The educator surface: three reads, no writes.
  //
  // MOUNTED ONLY BECAUSE `report_access_audit` NOW EXISTS. Two of the three serve
  // a minor's academic record to somebody who is not that minor, and until
  // migration 008 there was no table to record that in — so registering them
  // earlier would have opened an unaudited read path over children's grades whose
  // only trace was a log line. `migrate()` above has already run, so the table is
  // there before the first request can arrive, and the route refuses an authorised
  // read it cannot audit rather than serving it unrecorded.
  //
  // This is also the one line where `reportingService()` is checked against the
  // route's `ReportingPort`, which is the point of the port being structural.
  await registerReportingRoutes(app, reportingService());

  const cleanupTimer = setInterval(() => {
    void cleanupExpiredAuthData().catch(() => {
      app.log.error("scheduled retention cleanup failed");
    });
  }, 15 * 60 * 1000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  // GRADING STATE IS REPORTED HERE AND NEVER CHANGES THE STATUS CODE.
  //
  // The ECS task health check and the load balancer both read this endpoint, so a
  // 503 on a grading outage would kill the task and end the lesson — over a
  // condition the design deliberately degrades gracefully by granting the maximum.
  // Grading being down must never take the API down.
  //
  // But "the API is up" was the ONLY thing this said, and that is how an
  // unreachable classifier became indistinguishable from a class of geniuses: 200
  // OK, every answer correct, a full magazine each, and one line in a review log
  // nobody reads during a lesson. So the rate rides along in the body, where a
  // person or an uptime check can watch it without a session and without being
  // able to take the service down by looking. `status` is the one word:
  // OK / DEGRADED / UNGRADED.
  app.get("/v1/health", async (_req, reply) => {
    const grading = duelGrading.signal.snapshot();
    try {
      await query("select 1");
      return { ok: true, google: googleConfigured(), database: true, grading };
    } catch {
      return reply
        .code(503)
        .send({ ok: false, google: googleConfigured(), database: false, grading });
    }
  });

  app.get("/v1/session", async (req) => {
    // In non-production a tab's dev-session header takes precedence over the shared
    // cookie, so two tabs can report two different local profiles from one browser.
    const sid = effectiveSessionId(req);
    const user = await getSessionUser(sid);
    if (!user) return { authenticated: false, profile: null };
    const rows = await query<{
      id: string;
      account_id: string;
      display_name: string;
      variation_root_seed_hex: string;
      onboarding_preferences: unknown | null;
      created_at: string;
    }>(
      "select id, account_id, display_name, variation_root_seed_hex, onboarding_preferences, created_at from profiles where id=$1",
      [user.profileId],
    );
    const profile = rows.rows[0];
    if (!profile) return { authenticated: false, profile: null };
    const onboarding = OnboardingPreferencesSchema.safeParse(profile.onboarding_preferences);
    return {
      authenticated: true,
      csrfToken: sid ? csrfTokenForSession(sid) : undefined,
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

  app.get("/v1/auth/google/start", async (_req, reply) => {
    if (!googleConfigured()) {
      return reply.code(503).send({
        error: "AUTH_REQUIRED",
        message: "Google OAuth is not configured on the server.",
      });
    }
    return reply.redirect(await buildGoogleAuthUrl());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/v1/auth/google/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error || !code || !state) {
        return reply.redirect(
          `${WEB_ORIGIN}/?auth=failed&reason=${encodeURIComponent(error ?? "no_code")}`,
        );
      }
      // Which stage is running, so a failure names the exact one rather than a bare
      // "auth=failed". Every value here is non-secret.
      let stage: "token_callback" | "resolve_profile" | "create_session" | "redirect" =
        "token_callback";
      try {
        const identity = await completeGoogleCallback(code, state);
        stage = "resolve_profile";
        const profile = await resolveProfile(identity);
        stage = "create_session";
        const sid = await createSession(profile.id, profile.account_id);
        setSessionCookie(reply, sid);
        // Outside production the callback also mints a tab-scoped handle and hands it
        // back in the URL fragment, so a SECOND Google tab (or a Google tab beside a
        // local one) is not aliased to the shared cookie the most recent sign-in
        // overwrote. In production this is exactly cookie-only: no handle, no fragment.
        stage = "redirect";
        return reply.redirect(
          googleCallbackSuccessRedirect({
            webOrigin: WEB_ORIGIN,
            sessionId: sid,
            mintDevSession: devSessionsEnabled()
              ? (s) => devSessionStore.mint(s)
              : undefined,
          }),
        );
      } catch (cause) {
        // The stage a token/verify failure reports comes from the tagged error; the
        // later stages name themselves, since a DB or redirect failure has no tag.
        const reason =
          stage === "token_callback"
            ? googleCallbackErrorReason(cause)
            : stage === "resolve_profile"
              ? "profile_resolve"
              : stage === "create_session"
                ? "session_create"
                : "redirect_build";
        req.log.error(cause, "google callback failed");
        // The dev logger is off, so a real diagnostic needs its own line. NON-SECRET:
        // the reason code plus the error MESSAGE (a failed token exchange carries only
        // Google's error JSON, never an access/id token; a success path never reaches
        // here). Gated to non-production, exactly like the reason surfaced below.
        if (devSessionsEnabled()) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          console.error(`[auth/callback] failed stage=${stage} reason=${reason} :: ${detail}`);
        }
        // In development the browser lands on a SPECIFIC, non-secret reason so the next
        // failure is diagnosable rather than a bare auth=failed. Production stays bare,
        // so nothing about the internal stage is ever disclosed on a deployed task.
        const suffix = devSessionsEnabled() ? `&reason=${encodeURIComponent(reason)}` : "";
        return reply.redirect(`${WEB_ORIGIN}/?auth=failed${suffix}`);
      }
    },
  );

  // A server session for a local development profile. Mounted only outside
  // production (404 there), so the local build is ranked and gradable without
  // opening an anonymous session door on a deployed task.
  registerLocalSessionRoute(app, {
    resolveProfile: resolveLocalDevProfile,
    createSession,
    cookieSecure: COOKIE_SECURE,
    // Non-production only: the route answers 404 in production, so this is never
    // reached there and no tab credential is ever minted on a deployed task.
    mintDevSession: (sid) => devSessionStore.mint(sid),
  });

  // A dev-only reset of the CALLER'S OWN mission attempts, for the testing loop.
  // 404 in production (the gate is read per request), session-scoped to the
  // caller's own profile, CSRF-protected, and it preserves the module gate so the
  // duel can still grade the fresh attempt. See routes/devReset.ts.
  registerDevResetRoute(app, {
    service: progression,
    // A reset clears the mission's formative retrieval ledger and stale duel
    // verdicts too, so the replay re-grades from a clean slate.
    retrieval,
    defaultChapterId: BOSTON_RUNTIME_CHAPTER_ID,
    defaultMissionId: M1_MISSION_ID,
    allowedOrigin: WEB_ORIGIN,
  });

  app.post("/v1/logout", async (req, reply) => {
    // Tab-scoped first: a dev-session tab drops only its OWN handle, so signing out
    // of one local test tab cannot reach into another tab's identity. This is a
    // no-op in production (no handle is ever honoured there).
    const handle = requestDevSessionHandle(req);
    if (handle) devSessionStore.revoke(handle);
    // The shared HttpOnly cookie session is still revoked and cleared, which is the
    // honest browser-wide semantics a Google sign-out needs — the cookie is not
    // tab-scoped and this endpoint does not pretend it is.
    await revokeSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.put<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/preferences",
    async (req, reply) => {
      const guard = await requireOwner(req, req.params.profileId);
      if ("error" in guard) {
        return reply
          .code(guard.error === "AUTH_REQUIRED" ? 401 : 403)
          .send({ error: guard.error });
      }
      const preferences = OnboardingPreferencesSchema.safeParse(req.body);
      if (!preferences.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      await query("update profiles set onboarding_preferences=$1::jsonb where id=$2", [
        JSON.stringify(preferences.data),
        req.params.profileId,
      ]);
      return { ok: true, onboarding: preferences.data };
    },
  );

  return app;
}
