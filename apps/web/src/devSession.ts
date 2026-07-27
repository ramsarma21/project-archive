// Per-tab local test identity, on the browser side.
//
// WHY A HEADER AND sessionStorage, NOT A COOKIE. The session cookie is scoped to
// the ORIGIN and shared by every tab (a different localhost PORT does not isolate
// it — cookies are not port-scoped). `sessionStorage`, by contrast, is per top-level
// tab. So a local development profile binds to THIS tab by keeping the server's
// dev-session handle in `sessionStorage` and sending it in a dedicated header on
// every authenticated call. The API honours that header only outside production and
// lets it outrank the shared cookie, so two tabs can each play a different local
// profile without touching each other.
//
// This never carries the Google session. Google stays a normal HttpOnly cookie
// session that JavaScript cannot read; this handle is a separate, expiring,
// dev-only credential the server minted for a LOCAL profile.

/** The dedicated request header a tab carries its local-dev identity in. */
export const DEV_SESSION_HEADER = "x-pa-dev-session";

/**
 * The URL-fragment key a non-production Google OAuth callback hands this tab its
 * dev handle in. Must match the API's `DEV_SESSION_FRAGMENT_KEY`. A fragment, so it
 * is never sent to a server and never logged; consumed once and scrubbed on bootstrap.
 */
const DEV_SESSION_FRAGMENT_KEY = "pa_dev";

/** Where the tab-scoped handle lives. `sessionStorage`, so it is per tab. */
const STORAGE_KEY = "pa.devSessionHandle";

/**
 * The one-shot query flag a freshly opened "Player 2" tab carries. On bootstrap it
 * clears any copied handle so the new tab does NOT inherit the opener's profile,
 * then removes itself from the address bar.
 */
const FRESH_TAB_FLAG = "p2";

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    // A privacy mode that throws on access is treated as "no per-tab storage".
    return null;
  }
}

export function getDevSessionHandle(): string | null {
  const store = sessionStore();
  if (!store) return null;
  try {
    const value = store.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setDevSessionHandle(handle: string): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, handle);
  } catch {
    /* storage full or blocked: the cookie still works for a single tab */
  }
}

export function clearDevSessionHandle(): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

/**
 * Merge the dev-session header into a header bag, when this tab holds a handle.
 *
 * Pure over its inputs (the handle defaults to the current tab's) so a test can
 * exercise the attach logic without a DOM. Existing headers are preserved; only the
 * dev-session header is added, and only when there is a handle to add.
 */
export function withDevSessionHeader(
  headers: Record<string, string> = {},
  handle: string | null = getDevSessionHandle(),
): Record<string, string> {
  if (!handle) return headers;
  return { ...headers, [DEV_SESSION_HEADER]: handle };
}

/** The dev handle a URL fragment carries, or null. Pure over a `#...` hash string. */
export function readDevSessionFragment(hash: string): string | null {
  try {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const value = new URLSearchParams(raw).get(DEV_SESSION_FRAGMENT_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The same hash with the dev-session key removed. Pure; keeps any other fragment. */
export function stripDevSessionFragment(hash: string): string {
  try {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const params = new URLSearchParams(raw);
    params.delete(DEV_SESSION_FRAGMENT_KEY);
    const rest = params.toString();
    return rest ? `#${rest}` : "";
  } catch {
    return hash;
  }
}

/**
 * Consume a dev handle delivered in the URL fragment by a non-production Google
 * OAuth callback, bind it to THIS tab, and scrub it from the address bar.
 *
 * WHY. A Google sign-in only sets the shared HttpOnly cookie, so a second Google tab
 * (or a Google tab beside a local one that overwrote the cookie) would otherwise fall
 * back to whatever session was written last and read as "your own lobby". The dev
 * callback hands this tab an opaque, expiring handle in the fragment; storing it in
 * `sessionStorage` (per tab) and sending it in the dev header lets this tab outrank
 * the shared cookie and stay its own account.
 *
 * Run ONCE at bootstrap, BEFORE the first `/v1/session` call, so the very first
 * identity read already resolves this tab. The fragment is removed from history
 * immediately, so a reload or a copied link cannot replay the handle. Production
 * never emits the fragment, so this is a no-op there.
 */
export function consumeDevSessionFragment(): void {
  if (typeof window === "undefined") return;
  const handle = readDevSessionFragment(window.location.hash);
  if (!handle) return;
  setDevSessionHandle(handle);
  try {
    const cleaned = stripDevSessionFragment(window.location.hash);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${window.location.search}${cleaned}`,
    );
  } catch {
    /* history is best-effort; the handle is already bound to this tab */
  }
}

/** Whether a search string carries the one-shot fresh-tab flag. Pure. */
export function hasFreshTabFlag(search: string): boolean {
  try {
    return new URLSearchParams(search).get(FRESH_TAB_FLAG) === "1";
  } catch {
    return false;
  }
}

/** The same search string with the one-shot flag removed. Pure. */
export function stripFreshTabFlag(search: string): string {
  try {
    const params = new URLSearchParams(search);
    params.delete(FRESH_TAB_FLAG);
    const rest = params.toString();
    return rest ? `?${rest}` : "";
  } catch {
    return search;
  }
}

/** The same-app URL for a Player 2 tab: current location plus the fresh-tab flag. */
export function playerTwoUrl(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.set(FRESH_TAB_FLAG, "1");
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Open a Player 2 tab with NO inherited local identity.
 *
 * `noopener` severs the opener link (which is also what stops the browser from
 * copying this tab's `sessionStorage` into the new one), and the `?p2=1` flag is a
 * belt-and-suspenders guarantee: even if a handle were copied, the new tab clears
 * it before its first API call. The opener tab is never touched.
 */
export function openPlayerTwoTab(): void {
  if (typeof window === "undefined") return;
  window.open(playerTwoUrl(window.location.href), "_blank", "noopener");
}

/**
 * Begin a Google sign-in from THIS tab.
 *
 * Clears only this tab's previous dev identity before leaving for OAuth, so a tab that
 * was holding a local (or prior Google) handle does not carry it back and shadow the
 * new account: the callback will hand this tab a fresh handle in the URL fragment.
 * Other tabs' `sessionStorage` handles are untouched. Navigation is a full page load,
 * so the returning bootstrap re-reads identity from scratch.
 */
export function beginGoogleSignIn(url: string): void {
  if (typeof window === "undefined") return;
  clearDevSessionHandle();
  window.location.href = url;
}

/**
 * Run ONCE at bootstrap, before any API call.
 *
 * A tab opened as Player 2 clears its (possibly copied) local identity so it does
 * not inherit the opener's profile, then strips the flag from the address bar so a
 * later manual reload is a normal tab. A tab without the flag is left untouched —
 * this never clears the first tab's identity.
 */
export function consumeFreshTabFlag(): void {
  if (typeof window === "undefined") return;
  if (!hasFreshTabFlag(window.location.search)) return;
  clearDevSessionHandle();
  try {
    const cleaned = stripFreshTabFlag(window.location.search);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${cleaned}${window.location.hash}`,
    );
  } catch {
    /* history is best-effort; the identity is already cleared */
  }
}
