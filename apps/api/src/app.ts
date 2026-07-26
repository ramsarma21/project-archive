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
  googleConfigured,
  resolveProfile,
  revokeSession,
} from "./auth.js";
import { reportingService } from "@pa/reporting";
import { registerDuelRoutes } from "./routes/duels.js";
import { registerProgressionRoutes } from "./routes/progression.js";
import { registerPvpRoutes } from "./routes/pvp.js";
import { registerReportingRoutes } from "./routes/reporting.js";
import { createDuelGrading } from "./duels/grading.js";
import { createPvpGrading } from "./pvp/grading.js";
import { bostonProgressionContent } from "./progression/content.js";
import { postgresProgressionStore } from "./progression/postgresStore.js";
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
 * The other two are diagnostics: which path graded the round and how long it took.
 * Neither can influence a bullet count — the duel derives that from `kind` alone.
 */
const EXPOSED_HEADERS = [
  "x-pa-verdict-receipt",
  "x-pa-grading-path",
  "x-pa-grading-latency-ms",
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
  const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
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
  const progression = new ProgressionService(
    postgresProgressionStore(),
    bostonProgressionContent(),
  );
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
  await registerProgressionRoutes(app, progression, {
    verifyVerdictReceipt: duelGrading.verifyReceipt,
  });
  await registerDuelRoutes(app, { grading: duelGrading });
  // PvP holds its lobbies and live matches in memory, so a restart loses a code and
  // at most one fight. Standing is durable in pvp_standing (migration 007): a
  // leaderboard that evaporates is the one loss a playtest cannot absorb.
  await registerPvpRoutes(app, {
    ...createPvpGrading(app.log),
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
    const sid = req.cookies[SESSION_COOKIE];
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
      try {
        const identity = await completeGoogleCallback(code, state);
        const profile = await resolveProfile(identity);
        const sid = await createSession(profile.id, profile.account_id);
        setSessionCookie(reply, sid);
        return reply.redirect(`${WEB_ORIGIN}/?auth=success`);
      } catch (cause) {
        req.log.error(cause, "google callback failed");
        return reply.redirect(`${WEB_ORIGIN}/?auth=failed`);
      }
    },
  );

  app.post("/v1/logout", async (req, reply) => {
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
