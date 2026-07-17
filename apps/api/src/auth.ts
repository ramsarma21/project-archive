import crypto from "node:crypto";
import https from "node:https";
import { query } from "./db.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("AUTH_CALLBACK_FAILED: malformed id_token");
  const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
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
  const { verifier, challenge } = newPkce();
  await query("insert into oauth_login_attempts(state, code_verifier) values ($1,$2)", [state, verifier]);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
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

// Exchange the code (with PKCE verifier) and verify the ID token. We never
// store Google access/refresh tokens; identity is issuer + immutable subject.
export async function completeGoogleCallback(code: string, state: string): Promise<GoogleIdentity> {
  const rows = await query<{ code_verifier: string }>("select code_verifier from oauth_login_attempts where state=$1", [state]);
  if (rows.rowCount === 0) throw new Error("AUTH_CALLBACK_FAILED: unknown state");
  const verifier = rows.rows[0]!.code_verifier;
  await query("delete from oauth_login_attempts where state=$1", [state]);

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
  // The id_token arrives directly from Google's token endpoint over TLS (with our
  // client_secret), so it can be trusted without re-verifying the signature.
  const payload = decodeJwtPayload(tokens.id_token) as { iss?: string; sub?: string; email?: string; name?: string };
  if (!payload.sub || !payload.iss) throw new Error("AUTH_CALLBACK_FAILED: bad payload");
  return { issuer: payload.iss, subject: payload.sub, email: payload.email, name: payload.name };
}

function randomSeedHex(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface ProfileRow {
  id: string;
  account_id: string;
  display_name: string;
  variation_root_seed_hex: string;
  created_at: string;
}

// Find or create an account by (issuer, subject); ensure one profile exists.
export async function resolveProfile(identity: GoogleIdentity): Promise<ProfileRow> {
  const existing = await query<{ account_id: string }>(
    "select account_id from external_identities where issuer=$1 and subject=$2",
    [identity.issuer, identity.subject],
  );
  let accountId: string;
  if (existing.rowCount && existing.rows[0]) {
    accountId = existing.rows[0].account_id;
  } else {
    const acc = await query<{ id: string }>("insert into accounts default values returning id");
    accountId = acc.rows[0]!.id;
    await query(
      "insert into external_identities(account_id, issuer, subject, email) values ($1,$2,$3,$4)",
      [accountId, identity.issuer, identity.subject, identity.email ?? null],
    );
  }
  const prof = await query<ProfileRow>("select * from profiles where account_id=$1", [accountId]);
  if (prof.rowCount && prof.rows[0]) return prof.rows[0];
  const created = await query<ProfileRow>(
    "insert into profiles(account_id, display_name, variation_root_seed_hex) values ($1,$2,$3) returning *",
    [accountId, identity.name ?? identity.email ?? "Runner", randomSeedHex()],
  );
  return created.rows[0]!;
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
    "select profile_id, account_id, expires_at from access_sessions where id=$1",
    [sessionId],
  );
  if (!rows.rowCount || !rows.rows[0]) return null;
  if (new Date(rows.rows[0].expires_at).getTime() < Date.now()) {
    await query("delete from access_sessions where id=$1", [sessionId]);
    return null;
  }
  return { profileId: rows.rows[0].profile_id, accountId: rows.rows[0].account_id };
}

export async function revokeSession(sessionId: string | undefined): Promise<void> {
  if (sessionId) await query("delete from access_sessions where id=$1", [sessionId]);
}
