-- The formative retrieval ledger: what a profile was asked, per concept, and how
-- it went.
--
-- WHY THIS TABLE EXISTS. `concept_mastery` (005) records the SUMMATIVE claim — a
-- concept mastered at 100% on the chapter capstone — and nothing else. Every
-- FORMATIVE retrieval was recorded nowhere: the mission's encounter verdicts and
-- each boss-duel round are graded server-side against a known concept and stored in
-- `duel_verdicts` (010/011), but which concepts a player was asked, whether they
-- got them right, and how often was not folded into any per-concept record. The
-- owner's framing is that the duel now carries the chapter's retrieval breadth, so
-- those per-round verdicts are the primary learning evidence in the product. This
-- is where that evidence lands.
--
-- SERVER-MINTED ONLY. A row is written at grade time in the duel and encounter
-- routes, from the SERVER-SELECTED item's concept and the SERVER-minted verdict.
-- The wire already strips `correct`/`verdict`/`kind` from a client submission
-- (`parseDuelVerdictRequest`), so nothing a client sends can assert what it learned.
--
-- SEPARATE FROM MASTERY, DELIBERATELY. Extending `concept_mastery` would conflate
-- "mastered on the capstone" with "got it right in a gunfight" — two different
-- claims about a student. Mastery still gates PvP card legality (ASSESSMENT_PASSED);
-- formative retrieval does NOT move it, so a player cannot unlock cards by fighting.
-- "Whether mastery has been reached" is answered by JOINING `concept_mastery`, not
-- by duplicating it here.
--
-- 1:1 WITH duel_verdicts. The primary key `(profile_id, duel_id, round_index)`
-- mirrors `duel_verdicts` exactly: one retrieval row per graded question, and the
-- dedup is the same "first answer is final" the verdict store already guarantees —
-- a repeat submission re-grades nothing and records nothing new. It also lets a
-- dev-reset find and clear the mission's graded verdicts through these rows.
--
-- SPACING. `seen_at` is recorded per retrieval, and `attempt_id` groups a run's
-- asks, so "asked five times inside one match" reads differently from the same
-- spread across three attempts. Sessions/days are not yet distinguished (see the
-- store's docs) — but recording WHEN is cheap and makes the record meaningful later.
--
-- REPEATS ARE MARKED, NOT HIDDEN. When the duel bank is exhausted it recycles items
-- openly (`@pa/duel`'s `askQuestion` returns `recycled`/`appearance`), so the same
-- item can appear several times in one match. `recycled` and `appearance` carry that
-- marker through, so a report is not fooled into reading one match's reuse as five
-- sessions' worth of independent evidence — the same disclosure `@pa/reporting`
-- makes for a recycled assessment item, one layer down.
create table if not exists concept_retrieval (
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  -- The mission whose attempt served this question, so a dev-reset can scope its
  -- clear to one mission without joining the attempt rows it is about to delete.
  mission_id text not null,
  attempt_id uuid not null,
  concept_id text not null,
  -- The server-selected item id (never the client's claim). An id, never answer
  -- text — the same rule `duel_verdicts` keeps. Lets a report count distinct items
  -- and name what a student consistently misses.
  item_id text not null,
  source text not null check (source in ('DUEL', 'ENCOUNTER')),
  -- The canonical verdict id and round this row mirrors in `duel_verdicts`. A duel
  -- round's is `<levelId>#duel@<ordinal>` at round 1..N; an encounter's is
  -- `<attemptId>#enc@<encounterId>` at round 0.
  duel_id text not null,
  round_index integer not null check (round_index >= 0),
  -- The server-minted verdict for this question. Meaningful only when `graded`.
  correct boolean not null,
  -- False when the verdict was the generous infrastructure grant (source
  -- GRADING_TIMEOUT), which is not evidence of retrieval. A reader counts
  -- correctness over graded rows only, so a grading outage cannot inflate a report.
  graded boolean not null,
  -- The duel lane's repeat marker, consumed verbatim. `recycled` is true when the
  -- item was already asked earlier in the SAME match; `appearance` is the 1-based
  -- count of how many times it has been asked in that match. An encounter is asked
  -- once per attempt, so it is always fresh (false / 1).
  recycled boolean not null default false,
  appearance integer not null default 1 check (appearance >= 1),
  seen_at timestamptz not null default now(),
  primary key (profile_id, duel_id, round_index)
);

-- The educator/report read: everything a profile was asked in one chapter.
create index if not exists concept_retrieval_scope_idx
  on concept_retrieval (profile_id, chapter_id, concept_id);
-- The dev-reset read: one mission's rows, to clear on replay.
create index if not exists concept_retrieval_mission_idx
  on concept_retrieval (profile_id, chapter_id, mission_id);
