import assert from "node:assert/strict";
import test from "node:test";
import type { TokenPayload } from "google-auth-library";
import { googleCallbackErrorReason, verifyGoogleIdentity } from "../src/auth.js";

function verifier(payload: Partial<TokenPayload>) {
  return {
    async verifyIdToken() {
      return {
        getPayload: () => payload as TokenPayload,
      };
    },
  };
}

test("verified Google identity requires issuer, subject, and matching nonce", async () => {
  const identity = await verifyGoogleIdentity(
    "signed-token",
    "expected-nonce",
    verifier({
      iss: "https://accounts.google.com",
      sub: "google-subject",
      nonce: "expected-nonce",
      email: "runner@example.com",
      name: "Runner",
    }),
  );
  assert.deepEqual(identity, {
    issuer: "https://accounts.google.com",
    subject: "google-subject",
    email: "runner@example.com",
    name: "Runner",
  });

  await assert.rejects(
    verifyGoogleIdentity(
      "signed-token",
      "expected-nonce",
      verifier({
        iss: "https://accounts.google.com",
        sub: "google-subject",
        nonce: "replayed-nonce",
      }),
    ),
    /bad verified payload/,
  );
});

// A failed Google callback must land the dev browser on a SPECIFIC, non-secret reason
// so the next failure is diagnosable rather than a bare auth=failed. The classifier
// names the stage (and, for a token exchange, the HTTP status) and never echoes a
// token, code, cookie or secret.
test("googleCallbackErrorReason maps each callback stage to a non-secret code", () => {
  assert.equal(
    googleCallbackErrorReason(new Error("AUTH_CALLBACK_FAILED: unknown state")),
    "oauth_state_missing",
  );
  assert.equal(
    googleCallbackErrorReason(
      new Error('AUTH_CALLBACK_FAILED: token exchange 401 {"error":"invalid_client"}'),
    ),
    "token_exchange_401",
  );
  assert.equal(
    googleCallbackErrorReason(
      new Error('AUTH_CALLBACK_FAILED: token exchange 400 {"error":"invalid_grant"}'),
    ),
    "token_exchange_400",
  );
  assert.equal(
    googleCallbackErrorReason(new Error("AUTH_CALLBACK_FAILED: no id_token")),
    "no_id_token",
  );
  assert.equal(
    googleCallbackErrorReason(new Error("AUTH_CALLBACK_FAILED: bad verified payload")),
    "id_token_invalid",
  );
  // Anything unrecognised (a DB or network error) collapses to a generic code, so no
  // internal detail leaks even in development.
  assert.equal(googleCallbackErrorReason(new Error("connect ECONNREFUSED 127.0.0.1:55432")), "server_error");
  assert.equal(googleCallbackErrorReason("not-an-error"), "server_error");

  // The token-exchange code never carries the exchange BODY, so a secret echoed in an
  // error response can never reach the reason surfaced in the URL.
  const reason = googleCallbackErrorReason(
    new Error('AUTH_CALLBACK_FAILED: token exchange 400 {"error":"invalid_grant","secret":"leak"}'),
  );
  assert.equal(reason.includes("leak"), false);
});
