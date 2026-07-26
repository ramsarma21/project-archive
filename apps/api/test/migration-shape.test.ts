import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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

test("every SQL migration is checksummed", () => {
  const files = readdirSync(migrationRoot).filter((file) => file.endsWith(".sql"));
  for (const file of files) {
    assert.ok(
      Object.hasOwn(checksums, file),
      `${file} is missing from checksums.json`,
    );
  }
});

test("the progression migration separates campaign, chapter and run state", () => {
  const progression = readFileSync(join(migrationRoot, "005_progression.sql"), "utf8");
  for (const required of [
    // Durable campaign state, with Rank held monotonic by the database.
    "create table if not exists campaign_progression",
    "rank integer not null default 1 check (rank >= 1)",
    "campaign_progression_monotonic",
    // Chapter-scoped Level and XP, and the carry-in that survives the reset.
    "create table if not exists chapter_progression",
    "levels_at_chapter_start",
    // Attempts: the ordinal is persisted and capped at three.
    "attempt_ordinal integer not null check (attempt_ordinal between 1 and 3)",
    "attempts_used integer not null default 0 check (attempts_used between 0 and 3)",
    "FAILED_PERMANENT",
    "mission_attempts_one_live_idx",
    // The module gate, per gated attempt.
    "create table if not exists learning_module_completions",
    "gates_ordinal integer not null check (gates_ordinal >= 1)",
    // Codex: learned and PvP-legal are separate columns, never one boolean.
    "create table if not exists codex_cards",
    "learned_at timestamptz not null default now()",
    "pvp_legal_at timestamptz",
    // Abilities: chapter-scoped in PvE, permanent in the PvP loadout.
    "create table if not exists chapter_ability_unlocks",
    "create table if not exists pvp_ability_loadout",
    // Assessment mastery and the per-concept fresh-item ledger.
    "create table if not exists concept_mastery",
    "create table if not exists assessment_item_exposures",
    "is_reported_measure",
    // The server-minted audit trail.
    "create table if not exists progression_ledger",
  ]) {
    assert.match(
      progression,
      new RegExp(required.replace(/[()>=]/g, "\\$&"), "i"),
      `005_progression.sql is missing: ${required}`,
    );
  }
  // mastery_reports must be keyed per chapter so a second chapter cannot
  // overwrite the first.
  assert.match(progression, /primary key \(profile_id, chapter_id\)/i);
});

test("the assessment reconciliation keys by chapter and models open responses", () => {
  const sql = readFileSync(
    join(migrationRoot, "006_assessment_open_response.sql"),
    "utf8",
  );
  for (const required of [
    // An open response's handle, and a blank that is a null rather than a
    // sentinel option id.
    "add column if not exists item_format",
    "add column if not exists response_ref",
    "alter column selected_option_id drop not null",
    "chapter_assessment_responses_answer_check",
    "chapter_assessment_responses_blank_check",
    // The abandoned attempt state the no-promotion rule rests on.
    "'IN_PROGRESS', 'SUBMITTED', 'ABANDONED'",
    "chapter_assessment_attempts_abandoned_check",
    "ASSESSMENT_ATTEMPT_ABANDONED",
    // Mission ids are chapter-local slugs, so every key carries the chapter.
    "primary key (profile_id, chapter_id, mission_id)",
    "primary key (profile_id, chapter_id, gates_kind, gates_id, gates_ordinal)",
    "primary key (profile_id, chapter_id, concept_id)",
    "unique (profile_id, chapter_id, mission_id, attempt_ordinal)",
    "unique (profile_id, chapter_id, assessment_id, attempt_ordinal)",
  ]) {
    assert.match(
      sql,
      new RegExp(required.replace(/[()']/g, "\\$&"), "i"),
      `006_assessment_open_response.sql is missing: ${required}`,
    );
  }
  // 005 is applied, so the reconciliation is a new migration rather than an
  // edit to it. The checksum test above is what actually enforces that.
  assert.ok(Object.hasOwn(checksums, "005_progression.sql"));
});

test("the PvP migration makes the leaderboard durable and the result bankable once", () => {
  const sql = readFileSync(join(migrationRoot, "007_pvp_standing.sql"), "utf8");
  for (const required of [
    // The one table that has to outlive a restart, keyed per profile.
    "create table if not exists pvp_standing",
    "profile_id uuid primary key references profiles(id) on delete cascade",
    // A public handle is unique, or two students share a name on a board.
    "handle text not null unique",
    // The floor lives in the database as well as in the code that computes it.
    "points integer not null default 100 check (points >= 0)",
    // The decided match is the idempotence key: settle() runs on every poll.
    "create table if not exists pvp_match",
    "match_id text primary key",
    "winner_side text check (winner_side in ('A', 'B'))",
    // Verdict labels only. No answer text crosses this boundary.
    "create table if not exists pvp_match_verdict",
    "kind text not null check (kind in ('CORRECT', 'WRONG'))",
    "primary key (match_id, side, round_index)",
  ]) {
    assert.match(
      sql,
      new RegExp(required.replace(/[()>=']/g, "\\$&"), "i"),
      `007_pvp_standing.sql is missing: ${required}`,
    );
  }
  // The profile table in this database is `profiles`, not `profile`: the schema
  // sketched in routes/pvp.ts named a table that does not exist.
  assert.doesNotMatch(sql, /references\s+profile\s*\(/i);
  // Answer text never reaches a durable PvP row, in any spelling.
  assert.doesNotMatch(sql, /answer_text|response_text|answer_hash|answer_length/i);
});

test("the reporting migration audits access and records evidence quality", () => {
  const sql = readFileSync(join(migrationRoot, "008_reporting_audit.sql"), "utf8");
  for (const required of [
    // The table the educator routes were withheld for. Without it, a read of a
    // minor's record by another account has no durable trace at all.
    "create table if not exists report_access_audit",
    "actor_kind in ('STUDENT', 'EDUCATOR', 'ANONYMOUS')",
    "action in ('STUDENT_REPORT_READ', 'ROSTER_READ', 'DISTRICT_EXPORT')",
    "outcome text not null check (outcome in ('ALLOWED', 'REFUSED'))",
    // An audit row must outlive the account that caused it.
    "actor_account_id uuid references accounts(id) on delete set null",
    // "everything ever read about this one student" is a parent request.
    "report_access_audit_subjects_idx",
    // Evidence quality, which @pa/reporting reports as null rather than inventing.
    "add column if not exists mastered_on_attempt integer",
    "add column if not exists mastered_with_recycled_items boolean",
    "add column if not exists verdict_needs_review boolean not null default false",
    // A concept that is not mastered has no mastering form to describe.
    "concept_mastery_disclosure_check",
  ]) {
    assert.match(
      sql,
      new RegExp(required.replace(/[()']/g, "\\$&"), "i"),
      `008_reporting_audit.sql is missing: ${required}`,
    );
  }
  // The two disclosure columns must be NULLABLE WITH NO DEFAULT. `false` on
  // mastered_with_recycled_items is a claim — that mastery was shown on questions
  // the student had never seen — and a DEFAULT would make it retroactively, about
  // rows nobody recorded it for.
  assert.doesNotMatch(sql, /mastered_with_recycled_items boolean\s+not null/i);
  assert.doesNotMatch(sql, /mastered_with_recycled_items boolean\s+default/i);
  assert.doesNotMatch(sql, /mastered_on_attempt integer\s+(not null|default)/i);
});

test("the retired game's tables are dropped by a new migration, not by an edit", () => {
  const sql = readFileSync(join(migrationRoot, "009_drop_retired_tables.sql"), "utf8");
  for (const table of ["open_responses", "mastery_reports", "saves"]) {
    assert.match(
      sql,
      new RegExp(`drop table if exists ${table}\\s*;`, "i"),
      `009 does not drop ${table}`,
    );
  }
  // The referencing constraint comes off by lookup, and NOT by blanket cascade: a
  // migration that drops a table should name what else it changes. Asserted
  // against the statements rather than the file, because the file argues the point
  // in a comment that quotes the thing it is arguing against.
  const statements = sql.replace(/^\s*--.*$/gm, "");
  assert.match(statements, /alter table open_response_audit drop constraint/i);
  assert.doesNotMatch(statements, /drop table[^;]*cascade/i);
  // The audit table itself survives. Destroying an audit trail unattended is not a
  // cleanup, even when it is empty.
  assert.doesNotMatch(sql, /drop table if exists open_response_audit/i);
  // Both of these are LIVE — routes/reporting.ts resolves an educator's grant from
  // them — and they arrived in the same migration as the tables being dropped.
  for (const live of ["account_roles", "educator_profile_access", "concept_mastery"]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`drop table if exists ${live}`, "i"),
      `009 must not drop ${live}`,
    );
  }
  // 001 and 002 created them and are applied and checksummed, so the only way to
  // remove a table is a new migration. The checksum test above enforces it; this
  // states the reason.
  assert.ok(Object.hasOwn(checksums, "001_initial.sql"));
  assert.ok(Object.hasOwn(checksums, "002_open_responses.sql"));
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

