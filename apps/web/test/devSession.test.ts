// The browser side of per-tab local identity: attaching the header, and the
// one-shot fresh-tab flag a Player 2 tab uses to shed any inherited identity.
//
// These exercise the PURE helpers, so they run in Node without a DOM. The storage
// wrappers are deliberately guarded to no-op when `sessionStorage` is absent, which
// is exactly the environment here — `withDevSessionHeader()` with no handle argument
// therefore attaches nothing, and passing an explicit handle proves the attach.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEV_SESSION_HEADER,
  withDevSessionHeader,
  hasFreshTabFlag,
  stripFreshTabFlag,
  playerTwoUrl,
  getDevSessionHandle,
  setDevSessionHandle,
  readDevSessionFragment,
  stripDevSessionFragment,
  consumeDevSessionFragment,
  beginGoogleSignIn,
} from "../src/devSession.js";

test("withDevSessionHeader attaches the handle when this tab holds one", () => {
  const headers = withDevSessionHeader({ "content-type": "application/json" }, "handle-A");
  assert.equal(headers["content-type"], "application/json", "existing headers are preserved");
  assert.equal(headers[DEV_SESSION_HEADER], "handle-A");
});

test("withDevSessionHeader adds nothing when there is no handle", () => {
  const headers = withDevSessionHeader({ "content-type": "application/json" }, null);
  assert.deepEqual(headers, { "content-type": "application/json" });
  assert.equal(DEV_SESSION_HEADER in headers, false, "no empty header is sent");
});

test("without per-tab storage the current-tab handle is null (no header attached)", () => {
  // In Node there is no sessionStorage, so the default lookup yields null.
  assert.equal(getDevSessionHandle(), null);
  assert.deepEqual(withDevSessionHeader(), {});
});

test("the fresh-tab flag is detected and stripped", () => {
  assert.equal(hasFreshTabFlag("?p2=1"), true);
  assert.equal(hasFreshTabFlag("?p2=1&hub=1"), true);
  assert.equal(hasFreshTabFlag("?hub=1"), false);
  assert.equal(hasFreshTabFlag(""), false);

  assert.equal(stripFreshTabFlag("?p2=1"), "", "the sole flag leaves an empty search");
  assert.equal(stripFreshTabFlag("?p2=1&hub=1"), "?hub=1", "other params are kept");
  assert.equal(stripFreshTabFlag("?hub=1"), "?hub=1");
});

test("playerTwoUrl appends the one-shot flag to the current location", () => {
  const url = playerTwoUrl("http://localhost:5173/?hub=1");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("p2"), "1", "the new tab is marked fresh");
  assert.equal(parsed.searchParams.get("hub"), "1", "existing params survive");
});

test("the header name matches the API contract", () => {
  assert.equal(DEV_SESSION_HEADER, "x-pa-dev-session");
});

// ---- the Google callback handle in the URL fragment ------------------------

test("readDevSessionFragment extracts the dev handle, and only it", () => {
  assert.equal(readDevSessionFragment("#pa_dev=abc-_123"), "abc-_123");
  assert.equal(readDevSessionFragment("#foo=1&pa_dev=abc"), "abc", "other fragment params ignored");
  assert.equal(readDevSessionFragment("#foo=1"), null, "no handle present");
  assert.equal(readDevSessionFragment(""), null);
  assert.equal(readDevSessionFragment("#"), null);
  assert.equal(readDevSessionFragment("#pa_dev="), null, "an empty handle is not accepted");
});

test("stripDevSessionFragment removes the handle and keeps any other fragment", () => {
  assert.equal(stripDevSessionFragment("#pa_dev=abc"), "", "the sole key leaves no fragment");
  assert.equal(stripDevSessionFragment("#foo=1&pa_dev=abc"), "#foo=1", "other keys survive");
  assert.equal(stripDevSessionFragment("#foo=1"), "#foo=1");
  assert.equal(stripDevSessionFragment(""), "");
});

// A minimal window + sessionStorage so the DOM-bound consumer can be exercised under
// `node --test`. Restored after each case so the pure tests above stay DOM-free.
function withStubbedDom(hash: string, run: () => void): void {
  const store = new Map<string, string>();
  const replaced: { url: string }[] = [];
  const location = {
    hash,
    search: "?auth=success",
    pathname: "/",
  };
  const g = globalThis as unknown as {
    window?: unknown;
    sessionStorage?: unknown;
  };
  const priorWindow = g.window;
  const priorStorage = g.sessionStorage;
  g.sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  g.window = {
    location,
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        replaced.push({ url });
        // Mirror a real browser: the fragment is gone from the address bar.
        const hashAt = url.indexOf("#");
        location.hash = hashAt >= 0 ? url.slice(hashAt) : "";
      },
    },
  };
  try {
    run();
  } finally {
    if (priorWindow === undefined) delete g.window;
    else g.window = priorWindow;
    if (priorStorage === undefined) delete g.sessionStorage;
    else g.sessionStorage = priorStorage;
  }
}

test("consumeDevSessionFragment binds the handle to this tab and scrubs the fragment", () => {
  withStubbedDom("#pa_dev=google-handle-xyz", () => {
    consumeDevSessionFragment();
    // Bound to THIS tab, so the very first /v1/session read carries it in the header.
    assert.equal(getDevSessionHandle(), "google-handle-xyz");
    assert.equal(withDevSessionHeader()[DEV_SESSION_HEADER], "google-handle-xyz");
    // And scrubbed from the visible URL, so a reload cannot replay it.
    const w = (globalThis as unknown as { window: { location: { hash: string } } }).window;
    assert.equal(w.location.hash, "", "the fragment is removed from history");
  });
});

test("consumeDevSessionFragment is a no-op without a handle (production callback)", () => {
  withStubbedDom("", () => {
    consumeDevSessionFragment();
    assert.equal(getDevSessionHandle(), null, "nothing minted, nothing stored");
  });
});

test("beginGoogleSignIn clears this tab's prior identity before leaving for OAuth", () => {
  withStubbedDom("", () => {
    // This tab was holding a local (or prior Google) handle.
    setDevSessionHandle("stale-local-handle");
    assert.equal(getDevSessionHandle(), "stale-local-handle");

    const w = (globalThis as unknown as {
      window: { location: { href?: string } };
    }).window;
    beginGoogleSignIn("/v1/auth/google/start");

    // The tab's own handle is dropped so the returning callback's fresh handle wins,
    // and the browser is sent to the OAuth start.
    assert.equal(getDevSessionHandle(), null, "the stale per-tab handle was cleared");
    assert.equal(w.location.href, "/v1/auth/google/start", "navigation was initiated");
  });
});
