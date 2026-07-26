-- Progression schema for the new game (Mission-Slate 1.5-1.8).
--
-- Two layers, kept apart on purpose:
--   campaign_progression / codex_cards / concept_mastery / pvp_ability_loadout
--     are DURABLE and span chapters.
--   chapter_progression / chapter_ability_unlocks reset when a chapter begins.
--   mission_attempts is RUN state: exactly one mission attempt.
--
-- Nothing in here is client-writable. Every XP, Level, and Rank value is
-- written by the API from a committed outcome and audited in progression_ledger.

-- Rank, cumulative Levels, and which chapter is active. Rank is stored rather
-- than recomputed on read so it can be enforced monotonic.
create table if not exists campaign_progression (
  profile_id uuid primary key references profiles(id) on delete cascade,
  model_version integer not null default 1,
  rank integer not null default 1 check (rank >= 1),
  cumulative_levels integer not null default 0 check (cumulative_levels >= 0),
  active_chapter_id text not null,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rank must never decrease, and Levels ever earned must never be forgotten:
-- a bug in a route or a hand-edited row cannot demote a player.
create or replace function campaign_progression_monotonic()
returns trigger as $$
begin
  if new.rank < old.rank then
    raise exception 'rank is monotonic: % -> % for profile %',
      old.rank, new.rank, old.profile_id;
  end if;
  if new.cumulative_levels < old.cumulative_levels then
    raise exception 'cumulative_levels is monotonic: % -> % for profile %',
      old.cumulative_levels, new.cumulative_levels, old.profile_id;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace trigger campaign_progression_monotonic_check
  before update on campaign_progression
  for each row execute function campaign_progression_monotonic();

-- Chapter-scoped Level and XP; both reset to zero on a new chapter.
-- levels_at_chapter_start records the carry-in, so cumulative Levels stay
-- reconstructable and partial progress toward the next Rank is auditable.
create table if not exists chapter_progression (
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  level integer not null default 0 check (level >= 0),
  xp integer not null default 0 check (xp >= 0),
  levels_at_chapter_start integer not null default 0
    check (levels_at_chapter_start >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETE')),
  assessment_passed_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, chapter_id)
);

-- The durable per-mission record. attempts_used counts RESOLVED attempts, so
-- a live run never makes its own mission look spent. Three attempts and the
-- mission is finished: cleared, or permanently failed and paying zero forever.
create table if not exists mission_progress (
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  mission_id text not null,
  attempts_used integer not null default 0 check (attempts_used between 0 and 3),
  outcome text not null default 'UNSTARTED' check (
    outcome in ('UNSTARTED', 'IN_PROGRESS', 'CLEARED', 'FAILED_PERMANENT')
  ),
  awarded_xp integer not null default 0 check (awarded_xp >= 0),
  cleared_on_attempt integer check (cleared_on_attempt between 1 and 3),
  cleared_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, mission_id),
  constraint mission_progress_terminal_attempts check (
    outcome <> 'FAILED_PERMANENT' or attempts_used = 3
  )
);

-- The mandatory 3-minute module, recorded per gated attempt. gates_ordinal is
-- the attempt it opens, so a retry needs its own completion row and cannot
-- inherit the first attempt's. concept_ids narrows on an assessment retry.
create table if not exists learning_module_completions (
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  module_id text not null,
  gates_kind text not null check (
    gates_kind in ('MISSION_ATTEMPT', 'ASSESSMENT_ATTEMPT')
  ),
  gates_id text not null,
  gates_ordinal integer not null check (gates_ordinal >= 1),
  required_seconds integer not null default 180 check (required_seconds > 0),
  observed_seconds integer not null check (observed_seconds >= 0),
  concept_ids jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now(),
  primary key (profile_id, gates_kind, gates_id, gates_ordinal)
);

-- Run state: one mission attempt. attempt_ordinal is PERSISTED — the retired
-- seed helper took an attemptStartSequence it never stored, so every retry
-- silently resumed as attempt zero and replayed attempt one's variation.
-- module_completed_at is not null: an attempt cannot exist without its module.
create table if not exists mission_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  mission_id text not null,
  attempt_ordinal integer not null check (attempt_ordinal between 1 and 3),
  attempt_seed_hex text not null check (attempt_seed_hex ~ '^[0-9a-f]{32}$'),
  module_id text not null,
  module_completed_at timestamptz not null,
  status text not null check (
    status in ('IN_PROGRESS', 'CLEARED', 'FAILED', 'ABANDONED')
  ),
  xp_numerator integer not null check (xp_numerator >= 0),
  xp_denominator integer not null check (xp_denominator > 0),
  awarded_xp integer not null default 0 check (awarded_xp >= 0),
  committed_events jsonb not null default '[]'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  run_state jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (profile_id, mission_id, attempt_ordinal),
  foreign key (profile_id, mission_id)
    references mission_progress(profile_id, mission_id)
    on delete cascade
);

-- At most one live run per mission, enforced by the database rather than by
-- route ordering.
create unique index if not exists mission_attempts_one_live_idx
  on mission_attempts(profile_id, mission_id)
  where status = 'IN_PROGRESS';

-- The Codex, keyed by profile and card only: it carries across chapters
-- permanently. The two states are deliberately separate columns —
-- learned_at is single-player possession, pvp_legal_at is minted only at 100%
-- concept mastery on the chapter assessment. Never collapse them to a boolean.
create table if not exists codex_cards (
  profile_id uuid not null references profiles(id) on delete cascade,
  card_id text not null,
  concept_id text not null,
  learned_chapter_id text not null,
  learned_at timestamptz not null default now(),
  pvp_legal_at timestamptz,
  pvp_legal_attempt_id uuid,
  updated_at timestamptz not null default now(),
  primary key (profile_id, card_id)
);
create index if not exists codex_cards_concept_idx
  on codex_cards(profile_id, concept_id);
create index if not exists codex_cards_pvp_legal_idx
  on codex_cards(profile_id)
  where pvp_legal_at is not null;

-- PvE ability availability. Chapter-scoped by key, so a new chapter starts
-- with none and re-earns them from Level 0.
create table if not exists chapter_ability_unlocks (
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  ability_id text not null,
  unlocked_at_level integer not null check (unlocked_at_level >= 0),
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, chapter_id, ability_id)
);

-- The permanent PvP loadout: every ability ever unlocked, once, forever.
create table if not exists pvp_ability_loadout (
  profile_id uuid not null references profiles(id) on delete cascade,
  ability_id text not null,
  first_unlocked_chapter_id text not null,
  first_unlocked_at_level integer not null check (first_unlocked_at_level >= 0),
  first_unlocked_at timestamptz not null default now(),
  primary key (profile_id, ability_id)
);

-- Per-concept mastery, durable across chapters. mastered_at is set only at
-- 100% on a form; first_attempt_* preserves the reported measure even after a
-- retry drives the concept to mastery.
create table if not exists concept_mastery (
  profile_id uuid not null references profiles(id) on delete cascade,
  concept_id text not null,
  chapter_id text not null,
  items_served integer not null default 0 check (items_served >= 0),
  items_correct integer not null default 0 check (items_correct >= 0),
  first_attempt_served integer not null default 0
    check (first_attempt_served >= 0),
  first_attempt_correct integer not null default 0
    check (first_attempt_correct >= 0),
  mastered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, concept_id)
);
create index if not exists concept_mastery_chapter_idx
  on concept_mastery(profile_id, chapter_id);

-- The chapter capstone. Attempt 1 covers every chapter concept and is the
-- reported measure; retries shrink to scoped_concept_ids (the unmastered set)
-- and must draw fresh items.
create table if not exists chapter_assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  assessment_id text not null,
  attempt_ordinal integer not null check (attempt_ordinal >= 1),
  scoped_concept_ids jsonb not null,
  form jsonb not null,
  status text not null check (status in ('IN_PROGRESS', 'SUBMITTED')),
  passed boolean,
  score_numerator integer check (score_numerator >= 0),
  score_denominator integer check (score_denominator > 0),
  is_reported_measure boolean not null default false,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (profile_id, assessment_id, attempt_ordinal)
);
create unique index if not exists chapter_assessment_attempts_one_live_idx
  on chapter_assessment_attempts(profile_id, assessment_id)
  where status = 'IN_PROGRESS';

-- Graded answers. `correct` is written by the server only; the client submits
-- an option id and nothing else.
create table if not exists chapter_assessment_responses (
  attempt_id uuid not null
    references chapter_assessment_attempts(id) on delete cascade,
  item_id text not null,
  concept_id text not null,
  selected_option_id text not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, item_id)
);

-- The per-concept ledger of every item id this profile has already been
-- served. A shrinking retry subtracts this from the authored reserve so it
-- draws FRESH items rather than the ones already seen.
create table if not exists assessment_item_exposures (
  profile_id uuid not null references profiles(id) on delete cascade,
  assessment_id text not null,
  concept_id text not null,
  item_id text not null,
  attempt_id uuid not null
    references chapter_assessment_attempts(id) on delete cascade,
  attempt_ordinal integer not null check (attempt_ordinal >= 1),
  served_at timestamptz not null default now(),
  primary key (profile_id, assessment_id, item_id)
);
create index if not exists assessment_item_exposures_concept_idx
  on assessment_item_exposures(profile_id, assessment_id, concept_id);

-- Append-only audit of every progression change and its cause. Nothing moves
-- XP, Level, or Rank without a row here.
create table if not exists progression_ledger (
  id bigserial primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  kind text not null check (
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
      'ASSESSMENT_SUBMITTED'
    )
  ),
  mission_id text,
  attempt_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists progression_ledger_profile_created_idx
  on progression_ledger(profile_id, created_at desc);

-- mastery_reports was keyed on profile_id alone, so a second chapter's report
-- overwrote the first. Re-key it per chapter.
do $$
declare
  key_columns integer;
begin
  select cardinality(conkey) into key_columns
  from pg_constraint
  where conrelid = 'mastery_reports'::regclass and contype = 'p';
  if key_columns = 1 then
    alter table mastery_reports drop constraint mastery_reports_pkey;
    alter table mastery_reports
      add constraint mastery_reports_pkey primary key (profile_id, chapter_id);
  end if;
end $$;
