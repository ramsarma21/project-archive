// Home must not claim a Google sign-in for a local session.
//
// A LOCAL profile now establishes a real server session, so `getSession` reports it
// authenticated exactly like a Google one. App used to set the Google-only UI (the
// "Signed in with Google" name and the active-Google marker) for EVERY authenticated
// session, so a local-dev session made Home present a Google sign-in that never
// happened. These pin the seam App branches on: infer source first, and set the
// Google UI only when the source is actually GOOGLE.

import test from "node:test";
import assert from "node:assert/strict";

import { googleSignInUi, mirroredProfileSource } from "../src/sessionIdentity.js";

test("a known local profile keeps its LOCAL source through mirroring", () => {
  assert.equal(mirroredProfileSource({ source: "LOCAL" }), "LOCAL");
});

test("a profile the device has never seen is a fresh Google sign-in", () => {
  assert.equal(mirroredProfileSource(undefined), "GOOGLE");
  assert.equal(mirroredProfileSource({ source: "GOOGLE" }), "GOOGLE");
});

test("the Google sign-in UI is set only for a GOOGLE session", () => {
  const profile = { profileId: "p-google", displayName: "Ada" };
  assert.deepEqual(googleSignInUi("GOOGLE", profile), {
    googleName: "Ada",
    activeGoogleProfileId: "p-google",
  });
});

test("a LOCAL session shows no Google sign-in claim", () => {
  const profile = { profileId: "p-local", displayName: "Local Ada" };
  assert.deepEqual(googleSignInUi("LOCAL", profile), {
    googleName: null,
    activeGoogleProfileId: null,
  });
});
