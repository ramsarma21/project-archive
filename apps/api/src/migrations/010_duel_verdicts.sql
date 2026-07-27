-- The first-answer ledger for boss duel verdicts.
--
-- WHY THIS TABLE EXISTS. The boss duel route minted a fresh verdict on every POST
-- for a {profile, duel, round}, so a student could resubmit an answer until the
-- server said CORRECT and the last one won. This row makes the FIRST minted verdict
-- the only verdict that key ever has: a repeat submission returns exactly what is
-- stored here and never re-grades. The unique key IS the authority across instances
-- and restarts — two API tasks racing the same round both insert, one wins on the
-- primary key, and the loser reads back the winner.
--
-- VERDICT LABELS ONLY. No answer text, no length, no hash — the same rule that keeps
-- pvp_match_verdict (007) a record of what was decided rather than of what was
-- written. `response_ref` is an opaque pointer, not a transform of anyone's words;
-- it is null today because the encrypted-response columns a real ref needs are not
-- wired for duels yet.
create table if not exists duel_verdicts (
  profile_id uuid not null references profiles(id) on delete cascade,
  -- The canonical duel id the verdict was minted for, e.g. the mission level id
  -- suffixed `#duel@<ordinal>`. Part of the receipt's signed binding.
  duel_id text not null,
  round_index integer not null check (round_index >= 1),
  -- The five verdict-envelope fields. `item_id` is the SERVER-SELECTED item the
  -- round actually asked, never the client's claim.
  kind text not null check (kind in ('CORRECT', 'WRONG')),
  item_id text not null,
  item_version text not null,
  source text not null,
  response_ref text,
  -- The HMAC proof the first mint produced, so a repeat carries the same receipt
  -- the commit path verifies. Bounded like every other receipt.
  receipt text not null,
  -- Provenance the response headers report. None of it can move a bullet count;
  -- the duel derives that from `kind` alone.
  grading_path text not null,
  grading_latency_ms integer not null check (grading_latency_ms >= 0),
  fallback_diagnosis text,
  minted_at timestamptz not null default now(),
  primary key (profile_id, duel_id, round_index)
);

create index if not exists duel_verdicts_profile_idx on duel_verdicts (profile_id);
