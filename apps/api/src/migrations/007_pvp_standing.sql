-- PvP durability: the leaderboard, and the record of the matches that moved it.
--
-- WHAT IS HERE AND WHAT IS DELIBERATELY NOT. Lobbies and live matches stay in the API
-- process. Losing a lobby to a restart costs somebody a six-character code; losing a
-- leaderboard costs a class its standing, and a standing that evaporates is worse than
-- no standing at all because students believed it. So the durable objects are the ones
-- that outlive a fight: a profile's standing, and the decided match that changed it.
--
-- The schema is the one written out at the bottom of routes/pvp.ts, with two
-- corrections. The profile table in this database is `profiles` and its key is a uuid,
-- so every reference here is `profiles(id)` and every profile column is uuid rather
-- than text. And both match references cascade on delete, matching 005: a profile
-- deletion must not be blocked by a duel it happened to play.
--
-- The intent log that comment listed as "optional but recommended" is NOT created. It
-- would make a disputed result re-derivable, which is genuinely worth having, but the
-- authority holds only the LATEST accepted intent per side — it never retains the
-- stream — so the table would have nothing to write to it. An empty table that looks
-- like an audit trail is worse than a named absence. Making a match re-derivable is a
-- change to what the authority keeps, and it belongs with that change.

-- The leaderboard's own row. Standing points are PvP's own quantity: Rank comes from
-- mission XP and never decreases, so ordering a duelling board by it would make it a
-- single-player board with extra steps.
create table if not exists pvp_standing (
  profile_id uuid primary key references profiles(id) on delete cascade,
  -- The only identity a board carries. Generated from authored word lists by
  -- @pa/pvp's `generateHandle` and never accepted from a client, so the unique
  -- constraint here is what stops two profiles sharing a public name.
  handle text not null unique,
  rank integer not null default 1 check (rank >= 1),
  -- Floored in the database as well as in the code that computes it. Thirteen-year-
  -- olds do not need a negative number next to their name in front of the class, and
  -- a floor that lives in one place is a floor a bug can move.
  points integer not null default 100 check (points >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The board's own ordering: points, then wins, then handle for a total order. Same
-- three keys @pa/pvp's `leaderboard` sorts by, so the read is an index scan and the
-- two cannot disagree about ties.
create index if not exists pvp_standing_board_idx
  on pvp_standing (points desc, wins desc, handle asc);

-- One row per DECIDED match, and the thing that makes banking a result idempotent.
--
-- `settle` runs on every read and every intent post, and both clients keep polling a
-- finished match to discover the result — so without a unique key on the outcome the
-- winner banks the delta once per poll and the loser floors at zero inside a second.
-- An in-memory guard fixed that; this row is the version of the guard that survives a
-- restart, and it is why the standing update and this insert share one transaction.
create table if not exists pvp_match (
  match_id text primary key,
  code text not null,
  seed bigint not null,
  profile_a uuid not null references profiles(id) on delete cascade,
  profile_b uuid not null references profiles(id) on delete cascade,
  -- Null for a draw, which the duel's own rule says moves no points.
  winner_side text check (winner_side in ('A', 'B')),
  reason text not null,
  tiebreak text not null,
  health_a integer not null,
  health_b integer not null,
  -- A true draw changes nothing and is flagged, so telemetry can say whether draws
  -- happen often enough to justify building a decider.
  needs_review boolean not null default false,
  started_at timestamptz not null,
  resolved_at timestamptz not null default now()
);

create index if not exists pvp_match_profile_a_idx on pvp_match (profile_a);
create index if not exists pvp_match_profile_b_idx on pvp_match (profile_b);

-- The committed verdicts, which are the only inputs that changed the bullet economy.
--
-- VERDICT LABELS ONLY. No answer text, no length, no hash — by the duel's commit-log
-- rule and by the privacy boundary the whole mode is built around. `response_ref` is
-- an opaque pointer to the separately encrypted response record; it is not a
-- transform of what anybody wrote.
create table if not exists pvp_match_verdict (
  match_id text not null references pvp_match(match_id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  round_index integer not null check (round_index >= 0),
  item_id text not null,
  item_version text not null,
  kind text not null check (kind in ('CORRECT', 'WRONG')),
  source text not null,
  response_ref text,
  primary key (match_id, side, round_index)
);
