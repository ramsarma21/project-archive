import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import {
  OnboardingPreferencesSchema,
  PutSaveRequestSchema,
  type MasteryReport,
  type PresenterEvent,
} from "@pa/contracts";
import {
  buildMasteryReport,
  createChapterSession,
  type ChapterDefinition,
} from "@pa/runtime";
import { CHAPTERS } from "./chapters.js";
import { migrate, query, transaction } from "./db.js";
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
import {
  expireRetainedResponses,
  registerAssessmentRoutes,
} from "./routes/assessments.js";

const SESSION_COOKIE = "pa_session";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

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

// Server-side replay validation through the chapter registry: rebuild the
// session from seed + committed events for the SAVE'S chapter and derive the
// authoritative mastery report from it.
function masteryFromEvents(
  chapter: ChapterDefinition,
  profileId: string,
  variationRootSeedHex: string,
  events: PresenterEvent[],
): { report: MasteryReport; done: boolean } {
  const session = createChapterSession(chapter, {
    variationRootSeedHex,
    priorEvents: events,
    assessmentMode: "PRODUCTION",
  });
  if (session.committedEvents.length !== events.length) {
    throw new Error("SAVE_INVALID: events continue after completion");
  }
  return {
    done: session.isDone,
    report: buildMasteryReport(
      session.ctx.learner,
      {
        profileId,
        packageId: chapter.packageId,
        chapterId: chapter.chapterId,
        variationRootSeedHex,
        committedEventCount: events.length,
        generatedAt: new Date().toISOString(),
      },
      session.ctx.checkpoint,
      undefined,
      chapter.report,
    ),
  };
}

export async function buildApp(options: { runMigrations?: boolean } = {}): Promise<FastifyInstance> {
  if (options.runMigrations !== false) await migrate();

  const app = Fastify({
    logger: process.env.NODE_ENV === "production",
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(cors, { origin: WEB_ORIGIN, credentials: true });
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
  await registerAssessmentRoutes(app);

  const cleanupTimer = setInterval(() => {
    void Promise.all([
      cleanupExpiredAuthData(),
      expireRetainedResponses(),
    ]).catch(() => {
      app.log.error("scheduled retention cleanup failed");
    });
  }, 15 * 60 * 1000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  app.get("/v1/health", async (_req, reply) => {
    try {
      await query("select 1");
      return { ok: true, google: googleConfigured(), database: true };
    } catch {
      return reply.code(503).send({ ok: false, google: googleConfigured(), database: false });
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

  app.get<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/save",
    async (req, reply) => {
      const guard = await requireOwner(req, req.params.profileId);
      if ("error" in guard) {
        return reply
          .code(guard.error === "AUTH_REQUIRED" ? 401 : 403)
          .send({ error: guard.error });
      }
      const rows = await query<{
        profile_id: string;
        chapter_id: string;
        package_id: string;
        variation_root_seed_hex: string;
        flow_version: number;
        committed_events: PresenterEvent[];
        revision: number;
        status: "IN_PROGRESS" | "COMPLETE";
        updated_at: string;
        presenter_spatial: unknown | null;
      }>("select * from saves where profile_id=$1", [req.params.profileId]);
      const save = rows.rows[0];
      return {
        save: save
          ? {
              profileId: save.profile_id,
              chapterId: save.chapter_id,
              packageId: save.package_id,
              variationRootSeedHex: save.variation_root_seed_hex,
              flowVersion: save.flow_version,
              committedEvents: save.committed_events,
              revision: save.revision,
              status: save.status,
              updatedAt: save.updated_at,
              presenterSpatial: save.presenter_spatial ?? undefined,
            }
          : null,
      };
    },
  );

  app.get<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/mastery",
    async (req, reply) => {
      const guard = await requireOwner(req, req.params.profileId);
      if ("error" in guard) {
        return reply
          .code(guard.error === "AUTH_REQUIRED" ? 401 : 403)
          .send({ error: guard.error });
      }
      const rows = await query<{ report: MasteryReport; save_revision: number }>(
        "select report, save_revision from mastery_reports where profile_id=$1",
        [req.params.profileId],
      );
      const row = rows.rows[0];
      return { mastery: row?.report ?? null, saveRevision: row?.save_revision ?? null };
    },
  );

  app.put<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/save",
    async (req, reply) => {
      const guard = await requireOwner(req, req.params.profileId);
      if ("error" in guard) {
        return reply
          .code(guard.error === "AUTH_REQUIRED" ? 401 : 403)
          .send({ error: guard.error });
      }
      const parsed = PutSaveRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "SAVE_INVALID" });
      const { baseRevision, record } = parsed.data;
      // Chapter registry lookup by the save's own chapterId. An unknown
      // chapter is a clean 400 — the API refuses what it cannot replay.
      const chapter = CHAPTERS.get(record.chapterId);
      if (!chapter) {
        return reply.code(400).send({
          error: "SAVE_INVALID",
          message: `unknown chapterId ${record.chapterId}`,
        });
      }
      if (
        record.profileId !== req.params.profileId ||
        record.saveId !== req.params.profileId ||
        record.packageId !== chapter.packageId ||
        record.revision !== record.committedEvents.length
      ) {
        return reply.code(400).send({ error: "SAVE_INVALID" });
      }

      try {
        const result = await transaction(async (client) => {
          const profiles = await client.query<{ variation_root_seed_hex: string }>(
            "select variation_root_seed_hex from profiles where id=$1 for update",
            [req.params.profileId],
          );
          const seed = profiles.rows[0]?.variation_root_seed_hex;
          if (!seed || seed !== record.variationRootSeedHex) {
            return { kind: "invalid" as const };
          }
          const existing = await client.query<{ revision: number }>(
            "select revision from saves where profile_id=$1",
            [req.params.profileId],
          );
          const current = existing.rows[0]?.revision ?? 0;
          if (baseRevision !== current || record.revision <= current) {
            return { kind: "conflict" as const };
          }

          const { report, done } = masteryFromEvents(
            chapter,
            req.params.profileId,
            seed,
            record.committedEvents as PresenterEvent[],
          );
          if ((record.status === "COMPLETE") !== done) {
            return { kind: "invalid" as const };
          }
          const saved = await client.query<{ updated_at: string }>(
            `insert into saves(
               profile_id, chapter_id, package_id, variation_root_seed_hex,
               flow_version, committed_events, revision, status, updated_at,
               presenter_spatial
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
             on conflict (profile_id) do update set
               chapter_id=excluded.chapter_id,
               package_id=excluded.package_id,
               variation_root_seed_hex=excluded.variation_root_seed_hex,
               flow_version=excluded.flow_version,
               committed_events=excluded.committed_events,
               revision=excluded.revision,
               status=excluded.status,
               updated_at=now(),
               presenter_spatial=excluded.presenter_spatial
             returning updated_at`,
            [
              req.params.profileId,
              record.chapterId,
              record.packageId,
              seed,
              record.flowVersion ?? 1,
              JSON.stringify(record.committedEvents),
              record.revision,
              record.status,
              record.presenterSpatial
                ? JSON.stringify(record.presenterSpatial)
                : null,
            ],
          );
          await client.query(
            `insert into mastery_reports(
               profile_id, chapter_id, package_id, save_revision, report, generated_at, updated_at
             ) values ($1,$2,$3,$4,$5,$6,now())
             on conflict (profile_id) do update set
               chapter_id=excluded.chapter_id,
               package_id=excluded.package_id,
               save_revision=excluded.save_revision,
               report=excluded.report,
               generated_at=excluded.generated_at,
               updated_at=now()`,
            [
              req.params.profileId,
              record.chapterId,
              record.packageId,
              record.revision,
              JSON.stringify(report),
              report.generatedAt,
            ],
          );
          return {
            kind: "ok" as const,
            revision: record.revision,
            updatedAt: saved.rows[0]!.updated_at,
            mastery: report,
          };
        });

        if (result.kind === "conflict") {
          return reply.code(409).send({ error: "SAVE_CONFLICT" });
        }
        if (result.kind === "invalid") {
          return reply.code(400).send({ error: "SAVE_INVALID" });
        }
        return {
          ok: true,
          revision: result.revision,
          updatedAt: result.updatedAt,
          mastery: result.mastery,
        };
      } catch (cause) {
        req.log.warn(cause, "save replay validation failed");
        return reply.code(400).send({ error: "SAVE_INVALID" });
      }
    },
  );

  return app;
}
