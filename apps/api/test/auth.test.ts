import assert from "node:assert/strict";
import test from "node:test";
import type { TokenPayload } from "google-auth-library";
import { verifyGoogleIdentity } from "../src/auth.js";

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
