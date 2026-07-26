-- Dropping the retired game's tables.
--
-- WHY THIS IS A MIGRATION AND NOT AN EDIT. 001, 002 and 003 are applied and
-- checksummed: `migrate()` throws on a checksum mismatch, so rewriting the file
-- that created a table would take every existing database out of service rather
-- than removing the table from it. The only way to un-create something is to
-- create a new migration that drops it, which is also the only way that leaves a
-- record of when it happened.
--
-- WHAT IS BEING DROPPED, AND WHY EACH ONE IS SAFE. All three belong to the game
-- that was deleted. Nothing in `apps/api/src` names any of them — the save/resume
-- flow, the materialised mastery report and the encrypted open-response store were
-- all removed with their routes — and their replacements exist and are in use:
--
--   saves            -> mission_attempts.committed_events (005), which is
--                       attempt-scoped rather than one row per profile.
--   mastery_reports  -> concept_mastery (005) plus @pa/reporting, which derives a
--                       report on read instead of materialising one. 005 went to
--                       the trouble of re-keying this table per chapter and then
--                       nothing ever read it again.
--   open_responses   -> nothing yet, deliberately. The capstone's open answers are
--                       graded by @pa/grading and referenced by an opaque
--                       `chapter_assessment_responses.response_ref`; the encrypted
--                       retention store that would sit behind that handle has not
--                       been rebuilt. Dropping this does not remove a capability
--                       that exists; it removes the shell of one that does not.
--                       Migration 003 exists only to add columns to this table, so
--                       it goes with it.
--
-- ONE THING THAT WOULD BE DESTRUCTIVE IF IT HELD ROWS, said plainly rather than
-- assumed away: `open_responses` held student prose, encrypted. Any row still
-- there is already unrecoverable — the envelope-encryption module that could
-- decrypt it was deleted, and `GRADING_ENCRYPTION_KEY_BASE64` is no longer
-- injected because nothing read it — so this drop destroys ciphertext nobody can
-- turn back into text. The counts are RAISED before the drop so the operation is
-- not silent about how much it removed, and the deployed database keeps a 7-day
-- backup window and a deletion snapshot.
--
-- WHAT IS DELIBERATELY LEFT ALONE.
--
--   open_response_audit  — an audit table. Its foreign key has to come off before
--                          its subject can be dropped, and that is done below, but
--                          the table stays: destroying an audit trail unattended is
--                          not a cleanup even when it is empty, and if the
--                          open-response path returns this is the record it should
--                          keep appending to.
--   assessment_attempts  — the retired game's attempt table, and the parent
--                          `open_responses` pointed at. It is now orphaned and read
--                          by nothing, but a table called `assessment_attempts`
--                          sitting one letter away from the live
--                          `chapter_assessment_attempts` wants the owner's eyes on
--                          it rather than a passing agent's.
--   account_roles, educator_profile_access — also from 002, and both LIVE:
--                          `routes/reporting.ts` reads them to resolve an
--                          educator's grant.

do $$
declare
  saves_rows bigint;
  reports_rows bigint;
  responses_rows bigint;
begin
  select count(*) into saves_rows from saves;
  select count(*) into reports_rows from mastery_reports;
  select count(*) into responses_rows from open_responses;
  raise notice
    'dropping retired tables: saves(% rows), mastery_reports(% rows), open_responses(% rows)',
    saves_rows, reports_rows, responses_rows;
end $$;

-- The referencing constraint, by lookup rather than by guessing the name
-- PostgreSQL assigned it — the same approach 006 takes for the constraints 005
-- left unnamed. Explicit rather than `drop table ... cascade`, so this migration
-- says out loud that it is modifying a table it is not dropping.
do $$
declare
  name text;
begin
  select conname into name from pg_constraint
   where conrelid = 'open_response_audit'::regclass
     and contype = 'f'
     and confrelid = 'open_responses'::regclass;
  if name is not null then
    execute format('alter table open_response_audit drop constraint %I', name);
  end if;
end $$;

comment on column open_response_audit.response_id is
  'Formerly a foreign key onto open_responses, which migration 009 dropped. Retained unconstrained so the audit trail survives; repoint it if the encrypted open-response store is rebuilt.';

drop table if exists open_responses;
drop table if exists mastery_reports;
drop table if exists saves;
