// Per-tab local test identity, for two-player/PvP testing in one browser.
//
// THE PROBLEM. Auth cookies are scoped to an ORIGIN, not to a tab, and a cookie is
// not port-scoped either — so a different port on the same `localhost` hostname
// shares the same cookie jar. Two tabs on the dev origin therefore share one
// session cookie, and a second tab cannot "be" a different account by cookie alone.
//
// THE SEAM. A local development profile already mints a real server session (see
// routes/localSession.ts) that is mounted ONLY outside production. This adds a
// tab-scoped handle onto exactly that seam: the local-session route mints a
// cryptographically random, expiring handle mapped SERVER-SIDE to the freshly
// minted session id, returns it in the response body, and the web client keeps it
// in `sessionStorage` (which IS per-tab) and sends it in a dedicated header. This
// resolver honours that header ONLY in non-production and ONLY when it resolves to
// a live mapping, and it lets the header take precedence over the shared cookie so
// two tabs can each choose their own local profile.
//
// WHAT IT DELIBERATELY IS NOT. The handle is NOT the session cookie value and is
// never a substitute for it: the HttpOnly Google cookie session is untouched and
// never exposed to JavaScript. In production the header is ignored outright — there
// is no dev-session store to resolve against and `devSessionsEnabled()` is false —
// so normal cookie auth is the only path and nothing here can weaken it.

import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";

/** The dedicated request header a tab carries its local-dev identity in. */
export const DEV_SESSION_HEADER = "x-pa-dev-session";

/**
 * The URL-fragment key a non-production Google OAuth callback delivers a tab handle
 * in. A FRAGMENT and not a query so it is never sent to a server and never lands in
 * an access log; the web client consumes it before its first `/v1/session` call and
 * scrubs it from history immediately. Production never emits this.
 */
export const DEV_SESSION_FRAGMENT_KEY = "pa_dev";

const SESSION_COOKIE = "pa_session";

/**
 * How long a minted handle stays valid. Dev-only and deliberately bounded: long
 * enough to survive a testing session across reloads, short enough that a leaked
 * handle is not a lasting credential. The mapped session cookie has its own
 * (longer) expiry; this is the tighter of the two.
 */
export const DEV_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface DevSessionStore {
  /** Map a fresh handle to a session id and return the handle. */
  mint(sessionId: string): string;
  /** The session id a live handle maps to, or undefined when absent/expired. */
  resolve(handle: string): string | undefined;
  /** Drop a handle so a tab's sign-out cannot be replayed. */
  revoke(handle: string): void;
}

/**
 * An in-memory handle→session map.
 *
 * In-memory rather than a table because it is dev-only, single-process, and
 * ephemeral by design — the same posture the PvP lobbies take. A restart drops it,
 * and the web client simply re-establishes its local session (which re-mints a
 * handle) on its next bootstrap, so nothing is stranded.
 */
export function createDevSessionStore(
  now: () => number = Date.now,
  ttlMs: number = DEV_SESSION_TTL_MS,
): DevSessionStore {
  const byHandle = new Map<string, { sessionId: string; expiresAt: number }>();
  const sweep = (): void => {
    const t = now();
    for (const [handle, row] of byHandle) {
      if (row.expiresAt <= t) byHandle.delete(handle);
    }
  };
  return {
    mint(sessionId) {
      sweep();
      const handle = crypto.randomBytes(32).toString("base64url");
      byHandle.set(handle, { sessionId, expiresAt: now() + ttlMs });
      return handle;
    },
    resolve(handle) {
      const row = byHandle.get(handle);
      if (!row) return undefined;
      if (row.expiresAt <= now()) {
        byHandle.delete(handle);
        return undefined;
      }
      return row.sessionId;
    },
    revoke(handle) {
      byHandle.delete(handle);
    },
  };
}

/** The process-wide dev-session store. Empty and unreachable in production. */
export const devSessionStore = createDevSessionStore();

/**
 * Whether the tab-scoped dev-session header is honoured at all. False in
 * production, where the header must be ignored and normal cookie auth is the only
 * path. This is the same gate the local-session route defaults to.
 */
export function devSessionsEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

function firstHeaderValue(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(raw)) return firstHeaderValue(raw[0]);
  return undefined;
}

export interface EffectiveSessionInput {
  readonly cookieSessionId: string | undefined;
  readonly devHeader: string | string[] | undefined;
  readonly enabled: boolean;
  readonly resolveHandle: (handle: string) => string | undefined;
}

/**
 * The session id a request is authenticated under.
 *
 * Header identity takes precedence over the shared cookie, but ONLY when dev
 * sessions are enabled (non-production) AND the handle resolves to a live mapping.
 * A missing, malformed or expired handle is never accepted as another profile — it
 * simply falls through to the cookie, so a tab with no valid handle keeps its own
 * cookie identity (or none). In production `enabled` is false and the cookie is the
 * only thing ever consulted.
 *
 * Pure and injectable so the precedence and the production lock-out can be tested
 * without Fastify or a database.
 */
export function resolveEffectiveSessionId(input: EffectiveSessionInput): string | undefined {
  if (input.enabled) {
    const handle = firstHeaderValue(input.devHeader);
    if (handle) {
      const resolved = input.resolveHandle(handle);
      if (resolved) return resolved;
    }
  }
  return input.cookieSessionId;
}

/** The Fastify-bound resolver every route uses in place of the raw cookie read. */
export function effectiveSessionId(request: FastifyRequest): string | undefined {
  return resolveEffectiveSessionId({
    cookieSessionId: request.cookies[SESSION_COOKIE],
    devHeader: request.headers[DEV_SESSION_HEADER],
    enabled: devSessionsEnabled(),
    resolveHandle: (handle) => devSessionStore.resolve(handle),
  });
}

/** The handle a request carries, when dev sessions are enabled. For revocation. */
export function requestDevSessionHandle(request: FastifyRequest): string | undefined {
  if (!devSessionsEnabled()) return undefined;
  return firstHeaderValue(request.headers[DEV_SESSION_HEADER]);
}

/**
 * The success redirect a Google OAuth callback sends the browser to.
 *
 * WHY THIS IS THE FIX. The session cookie is shared by every same-origin tab, so a
 * SECOND Google tab (or a Google tab beside a local one that just overwrote the
 * cookie) has no way to be a different account by cookie alone — both tabs resolve
 * to whichever session was written last, and the server correctly reports "your own
 * lobby". Outside production the callback therefore ALSO mints the opaque, expiring
 * dev-session handle mapped to the just-created Google session and hands it back in
 * the URL FRAGMENT. The callback tab consumes it into `sessionStorage` (which is per
 * tab) and carries it in the dev header, so it outranks the shared cookie and stays
 * its own account.
 *
 * WHAT IT IS NOT. The fragment carries the opaque handle, NEVER the session id or the
 * cookie value, and a fragment is not sent to the server or written to a log. In
 * production `mintDevSession` is undefined: this returns exactly the cookie-only
 * `<webOrigin>/?auth=success` that has always shipped, mints nothing, and exposes no
 * handle. Pure over its inputs so the dev/prod split is testable without Fastify.
 */
export function googleCallbackSuccessRedirect(input: {
  readonly webOrigin: string;
  readonly sessionId: string;
  /** Non-production only. Absent means cookie-only, exactly as production stays. */
  readonly mintDevSession?: (sessionId: string) => string;
}): string {
  const base = `${input.webOrigin}/?auth=success`;
  if (!input.mintDevSession) return base;
  const handle = input.mintDevSession(input.sessionId);
  return `${base}#${DEV_SESSION_FRAGMENT_KEY}=${encodeURIComponent(handle)}`;
}
