import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import checksums from "../src/migrations/checksums.json" with { type: "json" };

const migrationRoot = resolve(import.meta.dirname, "../src/migrations");

test("SQL migrations retain immutable checksums without PostgreSQL", () => {
  for (const [file, expected] of Object.entries(checksums)) {
    const sql = readFileSync(join(migrationRoot, file), "utf8");
    assert.equal(
      crypto.createHash("sha256").update(sql).digest("hex"),
      expected,
      `${file} was rewritten; add a new migration instead`,
    );
  }
});

test("open-response migrations contain security and compatibility shape", () => {
  const storage = readFileSync(
    join(migrationRoot, "002_open_responses.sql"),
    "utf8",
  );
  for (const required of [
    "ciphertext bytea not null",
    "wrapped_key bytea not null",
    "key_version text not null",
    "retention_deadline timestamptz not null",
    "educator_profile_access",
    "open_response_audit",
    "unique (profile_id, attempt_id, idempotency_key)",
  ]) {
    assert.match(storage, new RegExp(required.replace(/[()]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(storage, /response_text|raw_text|plaintext/i);

  const compatibility = readFileSync(
    join(migrationRoot, "003_open_response_content_versions.sql"),
    "utf8",
  );
  for (const required of [
    "content_package_id",
    "content_package_version",
    "content_package_hash",
    "classifier_schema_id",
    "classifier_schema_version",
    "LEGACY",
  ]) {
    assert.match(compatibility, new RegExp(required, "i"));
  }
});

