import crypto from "node:crypto";
import https from "node:https";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { query, transaction } from "./db.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const processCsrfSecret = crypto.randomBytes(32);

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:5173/v1/auth/google/callback";
}

// Node's https module: avoids the undici "Premature close" bug that gaxios hits
// against Google's token endpoint on newer Node versions.
function httpsPostForm(url: string, form: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(form).toString();
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(data),
          Accept: "application/json",
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (chunks += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: chunks }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function buildGoogleAuthUrl(): Promise<string> {
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const { verifier, challenge } = newPkce();
  await query("delete from oauth_login_attempts where created_at < now() - interval '15 minutes'");
  await query(
    "insert into oauth_login_attempts(state, code_verifier, nonce) values ($1,$2,$3)",
    [state, verifier, nonce],
  );
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    access_type: "online",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleIdentity {
  issuer: string;
  subject: string;
  email?: string;
  name?: string;
}

interface IdTokenVerifier {
  verifyIdToken(options: {
    idToken: string;
    audience: string | undefined;
  }): Promise<{ getPayload(): TokenPayload | undefined }>;
}

export async function verifyGoogleIdentity(
  idToken: string,
  expectedNonce: string,
  verifier: IdTokenVerifier = new OAuth2Client(process.env.GOOGLE_CLIENT_ID),
): Promise<GoogleIdentity> {
  const ticket = await verifier.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.iss || payload.nonce !== expectedNonce) {
    throw new Error("AUTH_CALLBACK_FAILED: bad verified payload");
  }
  return {
    issuer: payload.iss,
    subject: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}

// Exchange the code (with PKCE verifier) and verify the ID token. We never
// store Google access/refresh tokens; identity is issuer + immutable subject.
export async function completeGoogleCallback(code: string, state: string): Promise<GoogleIdentity> {
  const rows = await query<{ code_verifier: string; nonce: string }>(
    `delete from oauth_login_attempts
     where state=$1 and created_at >= now() - interval '15 minutes'
     returning code_verifier, nonce`,
    [state],
  );
  if (rows.rowCount === 0) throw new Error("AUTH_CALLBACK_FAILED: unknown state");
  const verifier = rows.rows[0]!.code_verifier;
  const nonce = rows.rows[0]!.nonce;

  const resp = await httpsPostForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  if (resp.status !== 200) throw new Error(`AUTH_CALLBACK_FAILED: token exchange ${resp.status} ${resp.body}`);
  const tokens = JSON.parse(resp.body) as { id_token?: string };
  if (!tokens.id_token) throw new Error("AUTH_CALLBACK_FAILED: no id_token");
  return verifyGoogleIdentity(tokens.id_token, nonce);
}

function randomSeedHex(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface ProfileRow {
  id: string;
  account_id: string;
  display_name: string;
  variation_root_seed_hex: string;
  onboarding_preferences: unknown | null;
  created_at: string;
}

// Find or create an account by (issuer, subject); ensure one profile exists.
export async function resolveProfile(identity: GoogleIdentity): Promise<ProfileRow> {
  return transaction(async (client) => {
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [`${identity.issuer}\u001f${identity.subject}`],
    );
    const existing = await client.query<{ account_id: string }>(
      "select account_id from external_identities where issuer=$1 and subject=$2",
      [identity.issuer, identity.subject],
    );
    let accountId: string;
    if (existing.rows[0]) {
      accountId = existing.rows[0].account_id;
      await client.query(
        "update external_identities set email=$1 where issuer=$2 and subject=$3",
        [identity.email ?? null, identity.issuer, identity.subject],
      );
    } else {
      const acc = await client.query<{ id: string }>(
        "insert into accounts default values returning id",
      );
      accountId = acc.rows[0]!.id;
      await client.query(
        "insert into external_identities(account_id, issuer, subject, email) values ($1,$2,$3,$4)",
        [accountId, identity.issuer, identity.subject, identity.email ?? null],
      );
    }
    const prof = await client.query<ProfileRow>(
      "select * from profiles where account_id=$1",
      [accountId],
    );
    if (prof.rows[0]) return prof.rows[0];
    const created = await client.query<ProfileRow>(
      "insert into profiles(account_id, display_name, variation_root_seed_hex) values ($1,$2,$3) returning *",
      [accountId, identity.name ?? identity.email ?? "Runner", randomSeedHex()],
    );
    return created.rows[0]!;
  });
}

// ---------------------------------------------------------------------------
// Local development profiles, as REAL server accounts.
//
// WHAT WAS BROKEN. A LOCAL profile lived only in the browser's IndexedDB. It had no
// session cookie, so `useProgression` saw a signed-out runner: M1 was unranked and
// unlimited, and the boss duel's grading route answered 401 and the client fell
// back to granting the full magazine on every answer. A whole class of the game was
// effectively untestable on a local build.
//
// THE FIX, WITHOUT A PRODUCTION BYPASS. A local profile is resolved to a durable
// account through a DEDICATED external identity — issuer `local-dev`, subject the
// browser's own profile UUID — exactly the way a Google identity resolves through
// (issuer, subject). It is the same advisory-locked, first-write-wins path, so the
// FIRST login persists the submitted name and seed and every later login returns
// the stored authority rather than letting a client replace a seed. The route that
// calls this is mounted only outside production (see routes/localSession.ts), so
// production has no anonymous door to a session.
// ---------------------------------------------------------------------------

/** The issuer every local-dev identity resolves under. Never a real OIDC issuer. */
export const LOCAL_DEV_ISSUER = "local-dev";

export interface LocalDevProfileInput {
  /** The browser's stable local profile UUID. Used as the identity subject. */
  readonly localProfileId: string;
  /** Persisted only on first creation; ignored on relogin. */
  readonly displayName: string;
  /** 64 lowercase hex. Persisted only on first creation; ignored on relogin. */
  readonly seedHex: string;
}

/**
 * Find or create the durable account+profile for a local-dev identity.
 *
 * Mirrors `resolveProfile` field for field, and deliberately so: same advisory
 * lock on (issuer, subject), same "one profile per account", same first-write-wins.
 * A relogin returns the stored profile and NEVER writes the submitted name or seed
 * over it — the stored seed is the authority, so a client cannot rotate its own
 * variation by re-posting a different one.
 */
export async function resolveLocalDevProfile(
  input: LocalDevProfileInput,
): Promise<ProfileRow> {
  return transaction(async (client) => {
    const subject = input.localProfileId;
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `${LOCAL_DEV_ISSUER}\u001f${subject}`,
    ]);
    const existing = await client.query<{ account_id: string }>(
      "select account_id from external_identities where issuer=$1 and subject=$2",
      [LOCAL_DEV_ISSUER, subject],
    );
    let accountId: string;
    if (existing.rows[0]) {
      accountId = existing.rows[0].account_id;
    } else {
      const acc = await client.query<{ id: string }>(
        "insert into accounts default values returning id",
      );
      accountId = acc.rows[0]!.id;
      await client.query(
        "insert into external_identities(account_id, issuer, subject, email) values ($1,$2,$3,$4)",
        [accountId, LOCAL_DEV_ISSUER, subject, null],
      );
    }
    const prof = await client.query<ProfileRow>(
      "select * from profiles where account_id=$1",
      [accountId],
    );
    // Stored authority: a profile that already exists is returned as-is. The
    // submitted name and seed are used ONLY to mint a profile that has never
    // existed, exactly like the Google name on first sign-in.
    if (prof.rows[0]) return prof.rows[0];
    // The durable profile takes the browser's own UUID as its id. That keeps ONE
    // identity across the seam: `getSession` returns the same profile id the
    // IndexedDB row already holds, so a reload mirrors the profile in place and
    // preserves its LOCAL source rather than minting a second, server-keyed row.
    const created = await client.query<ProfileRow>(
      "insert into profiles(id, account_id, display_name, variation_root_seed_hex) values ($1,$2,$3,$4) returning *",
      [subject, accountId, input.displayName, input.seedHex],
    );
    return created.rows[0]!;
  });
}

export async function createSession(profileId: string, accountId: string): Promise<string> {
  const id = b64url(crypto.randomBytes(32));
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await query("insert into access_sessions(id, profile_id, account_id, expires_at) values ($1,$2,$3,$4)", [id, profileId, accountId, expires]);
  return id;
}

export interface SessionUser {
  profileId: string;
  accountId: string;
}

export async function getSessionUser(sessionId: string | undefined): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const rows = await query<{ profile_id: string; account_id: string; expires_at: string }>(
    "select profile_id, account_id, expires_at from access_sessions where id=$1 and expires_at > now()",
    [sessionId],
  );
  if (!rows.rows[0]) {
    await query("delete from access_sessions where id=$1 and expires_at <= now()", [sessionId]);
    return null;
  }
  return { profileId: rows.rows[0].profile_id, accountId: rows.rows[0].account_id };
}

function csrfSecret(): Buffer {
  const configured = process.env.CSRF_SECRET?.trim();
  return configured
    ? crypto.createHash("sha256").update(configured).digest()
    : processCsrfSecret;
}

export function csrfTokenForSession(sessionId: string): string {
  return crypto
    .createHmac("sha256", csrfSecret())
    .update(`project-archive:${sessionId}`)
    .digest("base64url");
}

export function validCsrfToken(
  sessionId: string | undefined,
  candidate: string | undefined,
): boolean {
  if (!sessionId || !candidate) return false;
  const expected = csrfTokenForSession(sessionId);
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function revokeSession(sessionId: string | undefined): Promise<void> {
  if (sessionId) await query("delete from access_sessions where id=$1", [sessionId]);
}

export async function cleanupExpiredAuthData(): Promise<void> {
  await query("delete from oauth_login_attempts where created_at < now() - interval '15 minutes'");
  await query("delete from access_sessions where expires_at <= now()");
}

/**
 * A stable, NON-SECRET reason code for a failed Google sign-in, safe to put in a
 * development redirect (`?auth=failed&reason=…`) and a development log.
 *
 * It names only which STAGE failed — and, for a token exchange, the HTTP status —
 * never a token, an authorization code, a cookie, an id_token or the client secret.
 * `completeGoogleCallback` throws stage-tagged messages; anything unrecognised (a DB
 * error, a network error) collapses to `server_error` so nothing internal leaks even
 * in development. Pure, so the mapping is unit-testable without a live callback.
 */
export function googleCallbackErrorReason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("unknown state")) return "oauth_state_missing";
  const exchange = message.match(/token exchange (\d{3})/);
  if (exchange) return `token_exchange_${exchange[1]}`;
  if (message.includes("no id_token")) return "no_id_token";
  if (message.includes("bad verified payload")) return "id_token_invalid";
  return "server_error";
}
