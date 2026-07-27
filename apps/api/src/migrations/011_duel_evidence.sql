-- The evidence selection that came with the first boss-duel answer.
--
-- WHY A NEW COLUMN, NOT AN EDIT TO 010. A duel answer is now prose AND the Codex
-- cards the player placed to support it. The first verdict for a {profile, duel,
-- round} is already final (010's unique key), and the cards that first answer placed
-- have to be final with it — a replay, a reconnect, or a second submission must see
-- the SAME selection, and a second submission must not be able to change it. This
-- records exactly the ids the first answer was graded against.
--
-- STILL NO ANSWER TEXT, AND NO RELEVANCE. Card IDS are not the student's words and
-- not the answer: which of these cards were the RIGHT ones is the server's policy and
-- is never stored here. This is the audit of what was placed, alongside the verdict
-- it produced, so the round is deterministic to replay.
--
-- 010 is applied and checksummed, so this is a new migration rather than an edit to
-- it (see migration-shape.test.ts). Defaulted to the empty array so the rows 010 may
-- already hold read back as "no evidence recorded" rather than null.
alter table duel_verdicts
  add column if not exists selected_card_ids text[] not null default '{}';
