import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { z } from "zod";
import { migrate, query } from "./db.js";
import {
  googleConfigured,
  buildGoogleAuthUrl,
  completeGoogleCallback,
  resolveProfile,
  createSession,
  getSessionUser,
  revokeSession,
} from "./auth.js";

const SESSION_COOKIE = "pa_session";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const PORT = Number(process.env.API_PORT ?? 3001);
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

const app = Fastify({ logger: false });

await app.register(cookie);
await app.register(cors, { origin: WEB_ORIGIN, credentials: true });

function setSessionCookie(reply: import("fastify").FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

app.get("/v1/health", async () => ({ ok: true, google: googleConfigured() }));

app.get("/v1/session", async (req) => {
  const sid = req.cookies[SESSION_COOKIE];
  const user = await getSessionUser(sid);
  if (!user) return { authenticated: false, profile: null };
  const rows = await query<{ id: string; account_id: string; display_name: string; created_at: string }>(
    "select id, account_id, display_name, created_at from profiles where id=$1",
    [user.profileId],
  );
  const p = rows.rows[0];
  if (!p) return { authenticated: false, profile: null };
  return {
    authenticated: true,
    profile: { profileId: p.id, accountId: p.account_id, displayName: p.display_name, createdAt: p.created_at },
  };
});

app.get("/v1/auth/google/start", async (_req, reply) => {
  if (!googleConfigured()) {
    return reply.code(503).send({ error: "AUTH_REQUIRED", message: "Google OAuth is not configured on the server." });
  }
  const url = await buildGoogleAuthUrl();
  return reply.redirect(url);
});

const CallbackQuery = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

app.get("/v1/auth/google/callback", async (req, reply) => {
  const q = CallbackQuery.safeParse(req.query);
  if (!q.success || q.data.error || !q.data.code || !q.data.state) {
    console.error(
      "[google callback] rejected before exchange:",
      JSON.stringify({ query: req.query, parseOk: q.success, googleError: q.success ? q.data.error : undefined }),
    );
    return reply.redirect(`${WEB_ORIGIN}/?auth=failed&reason=${encodeURIComponent(q.success && q.data.error ? q.data.error : "no_code")}`);
  }
  try {
    const identity = await completeGoogleCallback(q.data.code, q.data.state);
    const profile = await resolveProfile(identity);
    const sid = await createSession(profile.id, profile.account_id);
    setSessionCookie(reply, sid);
    return reply.redirect(`${WEB_ORIGIN}/`);
  } catch (err) {
    console.error("[google callback] error:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    return reply.redirect(`${WEB_ORIGIN}/?auth=failed`);
  }
});

app.post("/v1/logout", async (req, reply) => {
  await revokeSession(req.cookies[SESSION_COOKIE]);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true };
});

// ---- Saves (auth + ownership enforced) ----
async function requireOwner(req: import("fastify").FastifyRequest, profileId: string) {
  const user = await getSessionUser(req.cookies[SESSION_COOKIE]);
  if (!user) return { error: "AUTH_REQUIRED" as const };
  if (user.profileId !== profileId) return { error: "PROFILE_FORBIDDEN" as const };
  return { user };
}

app.get<{ Params: { profileId: string } }>("/v1/profiles/:profileId/save", async (req, reply) => {
  const guard = await requireOwner(req, req.params.profileId);
  if ("error" in guard) return reply.code(guard.error === "AUTH_REQUIRED" ? 401 : 403).send({ error: guard.error });
  const rows = await query("select * from saves where profile_id=$1", [req.params.profileId]);
  return { save: rows.rows[0] ?? null };
});

const PutSaveBody = z.object({
  baseRevision: z.number().int(),
  record: z.object({
    chapterId: z.string(),
    packageId: z.string(),
    variationRootSeedHex: z.string(),
    committedEvents: z.array(z.any()),
    revision: z.number().int(),
    status: z.enum(["IN_PROGRESS", "COMPLETE"]),
  }),
});

app.put<{ Params: { profileId: string } }>("/v1/profiles/:profileId/save", async (req, reply) => {
  const guard = await requireOwner(req, req.params.profileId);
  if ("error" in guard) return reply.code(guard.error === "AUTH_REQUIRED" ? 401 : 403).send({ error: guard.error });
  const body = PutSaveBody.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "SAVE_INVALID" });
  const { baseRevision, record } = body.data;

  const existing = await query<{ revision: number }>("select revision from saves where profile_id=$1", [req.params.profileId]);
  const current = existing.rows[0]?.revision ?? -1;
  if (current !== baseRevision && current !== -1) {
    // optimistic concurrency: only accept if strictly newer
    if (record.revision <= current) return reply.code(409).send({ error: "SAVE_CONFLICT" });
  }
  await query(
    `insert into saves(profile_id, chapter_id, package_id, variation_root_seed_hex, committed_events, revision, status, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (profile_id) do update set
       chapter_id=excluded.chapter_id, package_id=excluded.package_id,
       committed_events=excluded.committed_events, revision=excluded.revision,
       status=excluded.status, updated_at=now()
     where saves.revision <= excluded.revision`,
    [req.params.profileId, record.chapterId, record.packageId, record.variationRootSeedHex, JSON.stringify(record.committedEvents), record.revision, record.status],
  );
  return { ok: true, revision: record.revision };
});

async function main() {
  await migrate();
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`API listening on http://localhost:${PORT} (google=${googleConfigured()})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
