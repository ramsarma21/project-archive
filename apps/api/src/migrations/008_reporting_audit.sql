-- The educator reporting surface's schema prerequisites.
--
-- ORDER MATTERS AND THIS MIGRATION IS THE FIRST HALF OF IT. `routes/reporting.ts`
-- has existed unmounted, and that was correct: three of its endpoints read a
-- minor's academic record, one of them on behalf of somebody who is not the
-- student, and `report_access_audit` — the table that records who read whose
-- record — did not exist. Mounting the routes first would have opened an
-- unaudited read path over children's grades. So the table lands here and the
-- registration in app.ts lands with it, in that order.
--
-- Two things, and they answer different questions:
--
--   1. report_access_audit — WHO READ WHAT. Written on every authorised or
--      refused read of a record that is not the reader's own. The route's
--      fallback until now was an application log line, which is a record nobody
--      can query and nobody retains.
--
--   2. Three disclosure columns and two form fields — HOW GOOD THE EVIDENCE IS.
--      @pa/reporting rebuilds its reports from these projections because the
--      capstone event log is not persisted, and it deliberately reports `null`
--      rather than a reassuring `false` for anything the columns cannot answer.
--      `null` is the honest answer and it is also useless to a district. Every
--      capstone attempt run before this lands is permanently undocumented, which
--      is why the columns arrive now rather than with the reader that consumes
--      them.

-- ---------------------------------------------------------------------------
-- 1. Who read whose record
-- ---------------------------------------------------------------------------

-- Shape is @pa/reporting's own request (packages/reporting/README.md §3), so the
-- route's INSERT and the package's `AccessAuditRecord` agree by construction.
--
-- actor_account_id is nullable and ON DELETE SET NULL: an audit row outliving the
-- account that caused it is the point of an audit row. actor_kind and the subject
-- list are kept even then, so a deleted educator's reads remain attributable to a
-- kind and a set of subjects.
create table if not exists report_access_audit (
  id bigserial primary key,
  actor_account_id uuid references accounts(id) on delete set null,
  actor_kind text not null check (
    actor_kind in ('STUDENT', 'EDUCATOR', 'ANONYMOUS')
  ),
  action text not null check (
    action in ('STUDENT_REPORT_READ', 'ROSTER_READ', 'DISTRICT_EXPORT')
  ),
  -- A jsonb array of profile ids rather than a join table. The audited fact is
  -- "this set was read in one request", and a join table would let half of it be
  -- deleted while the other half still claimed to be the whole read.
  subject_profile_ids jsonb not null,
  outcome text not null check (outcome in ('ALLOWED', 'REFUSED')),
  refusal text,
  created_at timestamptz not null default now()
);

create index if not exists report_access_audit_actor_idx
  on report_access_audit(actor_account_id, created_at desc);
-- The other question this table gets asked: everything ever read about ONE
-- student, which is a parent or district request and must not be a table scan.
create index if not exists report_access_audit_subjects_idx
  on report_access_audit using gin (subject_profile_ids);

comment on table report_access_audit is
  'Append-only record of reads of a student report, roster or district export. Written before the report is rendered, including for refusals.';

-- ---------------------------------------------------------------------------
-- 2. How good the evidence behind a mastered concept is
-- ---------------------------------------------------------------------------

-- Both nullable with no default, and that is deliberate rather than lazy. NULL
-- means "not recorded", which is exactly what is true of every row written
-- before this migration; defaulting mastered_with_recycled_items to false would
-- assert, of attempts already in the database, that mastery was demonstrated on
-- questions the student had never seen. @pa/reporting goes to some trouble to
-- report that distinction and a DEFAULT here would erase it.
alter table concept_mastery
  add column if not exists mastered_on_attempt integer,
  add column if not exists mastered_with_recycled_items boolean;

alter table concept_mastery
  drop constraint if exists concept_mastery_mastered_on_attempt_check;
alter table concept_mastery
  add constraint concept_mastery_mastered_on_attempt_check check (
    mastered_on_attempt is null or mastered_on_attempt >= 1
  );

-- A concept that is not mastered has no mastering form, so neither column may
-- claim one. This is the constraint that stops the columns drifting into
-- "whatever the last write happened to say".
alter table concept_mastery
  drop constraint if exists concept_mastery_disclosure_check;
alter table concept_mastery
  add constraint concept_mastery_disclosure_check check (
    mastered_at is not null
    or (mastered_on_attempt is null and mastered_with_recycled_items is null)
  );

comment on column concept_mastery.mastered_on_attempt is
  'Attempt ordinal whose form reached 100% for this concept. NULL means not mastered, or mastered before this column existed.';
comment on column concept_mastery.mastered_with_recycled_items is
  'Whether the mastering form repeated an item the student had already been served. NULL means not recorded and is never to be read as false.';

-- Whether a verdict belongs in front of a human: an open response granted
-- without grading, or graded at low confidence. NOT NULL DEFAULT false is safe
-- here where it is not safe above, because the claim it makes about an old row is
-- "no review was flagged", and no review was in fact ever flagged — nothing has
-- ever written one. The flag is the grader's, not the reader's.
alter table chapter_assessment_responses
  add column if not exists verdict_needs_review boolean not null default false;

comment on column chapter_assessment_responses.verdict_needs_review is
  'Set by the grading authority when this verdict wants a human: a generous fallback grant, or a low-confidence classification.';

-- The attempt row's `form` jsonb gains two fields per concept — `freshness` and
-- `openResponseItemIds` — written by apps/api/src/progression/postgresStore.ts.
-- No DDL: `form` is jsonb and the fields are additive, and backfilling them for
-- existing rows is impossible for the same reason the columns above are NULL.
comment on column chapter_assessment_attempts.form is
  'Per-concept served form: conceptId, itemIds, and (from migration 008) freshness and openResponseItemIds. Rows written before 008 carry the first two only.';
