-- Reconciliation with the assessment engine (packages/assessment), which
-- validates every row it projects against the zod schemas in @pa/contracts.
-- 005 is already applied, so these arrive as their own migration rather than as
-- an edit to it.
--
-- Three things:
--   1. The capstone mixes selected-response and open-ended items, and an item
--      can be left blank. The response row modelled options only, so a blank
--      and an open response were both being stored under sentinel option ids.
--   2. An abandoned attempt was projecting as SUBMITTED with a null score. The
--      rule that a walked-out first attempt does not promote the retry into the
--      reported measure needs an explicit status to rest on.
--   3. Mission ids are chapter-local slugs (M1..M14, and chapter two will mint
--      its own M1), and a concept may be assessed again in a later chapter. Any
--      key that omitted chapter_id was therefore the same overwrite bug as the
--      one already fixed on mastery_reports.

-- ---------------------------------------------------------------------------
-- 1. Open-response and blank answers
-- ---------------------------------------------------------------------------

alter table chapter_assessment_responses
  add column if not exists item_format text not null default 'SELECTED_RESPONSE',
  add column if not exists response_ref text;

alter table chapter_assessment_responses
  alter column item_format drop default;

-- A blank is a null, never a sentinel option id.
alter table chapter_assessment_responses
  alter column selected_option_id drop not null;

alter table chapter_assessment_responses
  drop constraint if exists chapter_assessment_responses_format_check;
alter table chapter_assessment_responses
  add constraint chapter_assessment_responses_format_check check (
    item_format in ('SELECTED_RESPONSE', 'OPEN_RESPONSE')
  );

-- Exactly one answer column is applicable per format, and neither being set is
-- a genuine blank.
alter table chapter_assessment_responses
  drop constraint if exists chapter_assessment_responses_answer_check;
alter table chapter_assessment_responses
  add constraint chapter_assessment_responses_answer_check check (
    (item_format = 'SELECTED_RESPONSE' and response_ref is null)
    or (item_format = 'OPEN_RESPONSE' and selected_option_id is null)
  );

-- A blank answer can never be correct.
alter table chapter_assessment_responses
  drop constraint if exists chapter_assessment_responses_blank_check;
alter table chapter_assessment_responses
  add constraint chapter_assessment_responses_blank_check check (
    selected_option_id is not null or response_ref is not null or correct = false
  );

comment on column chapter_assessment_responses.response_ref is
  'Opaque handle on the encrypted open-response record. Never prose, and never a transform of prose.';

-- ---------------------------------------------------------------------------
-- 2. The abandoned attempt status
-- ---------------------------------------------------------------------------

do $$
declare
  name text;
begin
  -- Named by PostgreSQL in 005, so it is looked up rather than guessed.
  select conname into name from pg_constraint
   where conrelid = 'chapter_assessment_attempts'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%IN_PROGRESS%';
  if name is not null then
    execute format(
      'alter table chapter_assessment_attempts drop constraint %I', name
    );
  end if;
end $$;

alter table chapter_assessment_attempts
  add constraint chapter_assessment_attempts_status_check check (
    status in ('IN_PROGRESS', 'SUBMITTED', 'ABANDONED')
  );

-- An abandoned attempt has ended, so it must not hold a score, and it must not
-- read as passing.
alter table chapter_assessment_attempts
  drop constraint if exists chapter_assessment_attempts_abandoned_check;
alter table chapter_assessment_attempts
  add constraint chapter_assessment_attempts_abandoned_check check (
    status <> 'ABANDONED'
    or (score_numerator is null and score_denominator is null and passed is not true)
  );

alter table progression_ledger
  drop constraint if exists progression_ledger_kind_check;
alter table progression_ledger
  add constraint progression_ledger_kind_check check (
    kind in (
      'CHAPTER_STARTED',
      'CHAPTER_COMPLETED',
      'MODULE_COMPLETED',
      'MISSION_ATTEMPT_OPENED',
      'MISSION_XP_AWARDED',
      'MISSION_FAILED_PERMANENT',
      'LEVEL_GAINED',
      'RANK_GAINED',
      'ABILITY_UNLOCKED',
      'CODEX_CARD_LEARNED',
      'CODEX_CARD_PVP_LEGAL',
      'CONCEPT_MASTERED',
      'ASSESSMENT_ATTEMPT_OPENED',
      'ASSESSMENT_SUBMITTED',
      'ASSESSMENT_ATTEMPT_ABANDONED'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Key everything that can hold a chapter-local id by chapter as well
-- ---------------------------------------------------------------------------

-- The child's foreign key has to come off before the parent can be re-keyed.
do $$
declare
  name text;
begin
  select conname into name from pg_constraint
   where conrelid = 'mission_attempts'::regclass
     and contype = 'f'
     and confrelid = 'mission_progress'::regclass;
  if name is not null then
    execute format('alter table mission_attempts drop constraint %I', name);
  end if;
end $$;

do $$
begin
  if (
    select cardinality(conkey) from pg_constraint
     where conrelid = 'mission_progress'::regclass and contype = 'p'
  ) = 2 then
    alter table mission_progress drop constraint mission_progress_pkey;
    alter table mission_progress
      add constraint mission_progress_pkey
      primary key (profile_id, chapter_id, mission_id);
  end if;
end $$;

do $$
declare
  name text;
begin
  select conname into name from pg_constraint
   where conrelid = 'mission_attempts'::regclass and contype = 'u';
  if name is not null then
    execute format('alter table mission_attempts drop constraint %I', name);
  end if;
end $$;

alter table mission_attempts
  add constraint mission_attempts_ordinal_key
  unique (profile_id, chapter_id, mission_id, attempt_ordinal);

alter table mission_attempts
  add constraint mission_attempts_mission_fkey
  foreign key (profile_id, chapter_id, mission_id)
  references mission_progress(profile_id, chapter_id, mission_id)
  on delete cascade;

drop index if exists mission_attempts_one_live_idx;
create unique index if not exists mission_attempts_one_live_idx
  on mission_attempts(profile_id, chapter_id, mission_id)
  where status = 'IN_PROGRESS';

-- gates_id is a mission id for a mission attempt, so the module ledger carries
-- the same collision.
do $$
begin
  if (
    select cardinality(conkey) from pg_constraint
     where conrelid = 'learning_module_completions'::regclass and contype = 'p'
  ) = 4 then
    alter table learning_module_completions
      drop constraint learning_module_completions_pkey;
    alter table learning_module_completions
      add constraint learning_module_completions_pkey
      primary key (profile_id, chapter_id, gates_kind, gates_id, gates_ordinal);
  end if;
end $$;

-- A concept assessed again in a later chapter is a second row, not a rewrite of
-- the first: the assessment engine projects one mastery row per chapter.
do $$
begin
  if (
    select cardinality(conkey) from pg_constraint
     where conrelid = 'concept_mastery'::regclass and contype = 'p'
  ) = 2 then
    alter table concept_mastery drop constraint concept_mastery_pkey;
    alter table concept_mastery
      add constraint concept_mastery_pkey
      primary key (profile_id, chapter_id, concept_id);
  end if;
end $$;

do $$
declare
  name text;
begin
  select conname into name from pg_constraint
   where conrelid = 'chapter_assessment_attempts'::regclass and contype = 'u';
  if name is not null then
    execute format(
      'alter table chapter_assessment_attempts drop constraint %I', name
    );
  end if;
end $$;

alter table chapter_assessment_attempts
  add constraint chapter_assessment_attempts_ordinal_key
  unique (profile_id, chapter_id, assessment_id, attempt_ordinal);

drop index if exists chapter_assessment_attempts_one_live_idx;
create unique index if not exists chapter_assessment_attempts_one_live_idx
  on chapter_assessment_attempts(profile_id, chapter_id, assessment_id)
  where status = 'IN_PROGRESS';

alter table assessment_item_exposures
  add column if not exists chapter_id text;
update assessment_item_exposures exposure
   set chapter_id = attempt.chapter_id
  from chapter_assessment_attempts attempt
 where attempt.id = exposure.attempt_id
   and exposure.chapter_id is null;
delete from assessment_item_exposures where chapter_id is null;
alter table assessment_item_exposures alter column chapter_id set not null;

do $$
begin
  if (
    select cardinality(conkey) from pg_constraint
     where conrelid = 'assessment_item_exposures'::regclass and contype = 'p'
  ) = 3 then
    alter table assessment_item_exposures
      drop constraint assessment_item_exposures_pkey;
    alter table assessment_item_exposures
      add constraint assessment_item_exposures_pkey
      primary key (profile_id, chapter_id, assessment_id, item_id);
  end if;
end $$;

drop index if exists assessment_item_exposures_concept_idx;
create index if not exists assessment_item_exposures_concept_idx
  on assessment_item_exposures(profile_id, chapter_id, assessment_id, concept_id);
