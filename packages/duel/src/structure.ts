// The round shape of a duel, and nothing else.
//
// WHY THIS IS ITS OWN FILE, WITH NO IMPORTS AT ALL.
//
// These two numbers are not only simulation tuning: they are a CONTRACT between
// the machine and everything that talks to it, including the grading service,
// which has to decide whether a submitted `roundIndex` could belong to a duel.
// A service that grades an answer must not have to load a physics engine to
// answer that question, so the constants live in a leaf module and are exported
// from the package as `@pa/duel/structure`.
//
// The rest of tuning.ts reaches for FIELD_TICK_HZ and therefore drags
// @pa/engine-world's collision, motion and clock modules behind it. That is
// correct for a simulation and wrong for an HTTP route, and the split here is
// what lets both be true.
//
// A DUEL IS NO LONGER SIX ROUNDS. It runs until one side's health reaches zero,
// in PvE and PvP alike. The round survives as the loop — a question, then ~20
// seconds of play — but the count is open.
//
// ---- TWO SETTLED DECISIONS ABOUT THE SHAPE, BOTH ARRIVED AT THE HARD WAY -----
//
// A QUESTION OPENS EVERY ROUND. Not every other one. This was proposed and
// rejected, and the proposal was good enough on its own terms that it will be made
// again, so the reason it lost is recorded here rather than in a chat log.
//
// The case for alternating was a measurement: typing is about 47% of a duel's wall
// clock at any round count, and the longest unbroken stretch of play is 20 seconds
// however long the fight runs, because both scale with rounds exactly as play does.
// Asking on rounds 1, 3, 5 would have cut typing to ~30% and doubled the unbroken
// play window to ~41 seconds. That is a real improvement to the rhythm and it is not
// why the mode exists.
//
// It loses on the mechanism. ASKING EVERY ROUND IS WHAT KEEPS EACH ROUND'S BULLETS
// EARNED BY THAT ROUND'S QUESTION. Under alternating, half of every fight is fought
// on ammunition earned by an answer given a minute earlier, which loosens the exact
// coupling the design is built to create — that knowing this thing RIGHT NOW buys
// firepower RIGHT NOW. And two questions deciding a four-round fight is a weaker
// claim about knowledge than four questions deciding it, however much better it
// reads on a stopwatch. The 47% is a true measurement of a deliberate choice, not a
// defect: a knowledgeable student's duel is about 165 seconds with about 76 of them
// spent reasoning with evidence, and the question is untimed on purpose so that it
// can be reasoning rather than racing.
//
// The corollary, for anyone implementing anything nearby: a round and a question are
// 1:1, so a verdict exists for every round the machine reaches, and no round is ever
// fought on a grant it did not earn.
//
// FOUR ROUNDS IS THE CEILING FOR A CORRECT-ANSWER FIGHT, AND IT IS ARITHMETIC RATHER
// THAN TASTE. This is the other thing that should not have to be rediscovered. The
// exchange model rearranges to
//
//   correct rounds  <=  roundsForBossToWin / (ratio x wrong-answer margin)
//
// with the ratio at 2 and the margin floored at REQUIRED_WRONG_PATH_MARGIN
// (1.15), so the ceiling lands between 4.0 and 4.7 rounds across the shipped tiers. SIX
// IS IMPOSSIBLE at any boss health: six rounds implies a wrong-answer margin of about
// 0.9, which is a boss the wrong-answer player loses to, and that is the design's one
// non-negotiable. Boss health cannot buy past the line either — it cancels out of the
// ceiling entirely, and so does the wrong-answer grant, which is why the ceiling did
// not move while the ratio was briefly 1.56. `correctPathRoundCeiling` and
// `marginImpliedByCorrectPathRounds` in boss.ts compute both directions, and
// `boss.test.ts` asserts them, so the constraint is executable rather than folklore.
//
// That single change deletes the old winnability model root and branch. The whole
// of it was `BOSS_HEALTH_CEILING = (rounds - 1) x PLAYER_SHOT_DAMAGE`: with a
// fixed six-shot budget you could ask "can six shots kill him?" and answer it with
// arithmetic. With no round budget that question is meaningless — a persistent
// player always kills him eventually — so the tension moves to WHOSE HEALTH RUNS
// OUT FIRST, and the model has to be a damage exchange rate instead of a shot
// count. See "the exchange model" in tuning.ts.

/**
 * How long a duel typically lasts, in rounds. DERIVED AND DESCRIPTIVE, NEVER A
 * LIMIT — nothing in the machine reads it to decide anything.
 *
 * It is exported under the old name because `@pa/abilities` and the web overlay
 * both import it, and it is kept honest rather than frozen at 6: it is the round
 * count a mid-tier duel actually runs on the wrong-answer path, and
 * `winnability.test.ts` fails if the simulation drifts more than a round away from
 * it. Consumers that want the hard backstop want DUEL_ROUND_CEILING.
 *
 * THAT SENTENCE WAS FALSE UNTIL THE SIMULATION CAUGHT UP WITH IT, WHICH IS WORTH
 * KNOWING BEFORE YOU TRUST THE NEXT ONE LIKE IT. No test enforced the claim, and for
 * a while the number was simply wrong: the fun audit measured M1's boss at 2.1 to 4.5
 * rounds and called for the name to be cut as misleading, correctly. Boss health going
 * flat at 450 to stop knowledge deleting the climax made 6 true rather than
 * aspirational, and raising the wrong-answer grant to 9 to fill the dead air in that
 * path pulled it back down: the wrong-answer path now measures 5.1 to 6.5 across the
 * tiers, mid-tier 5.3, so 6 is still descriptive but is now the top of the range rather
 * than the middle of it. `winnability.test.ts` allows a round of drift either way; if
 * the floor rises again this becomes 5 and the consumers listed above want re-reading.
 *
 * IT IS NOT A VALIDATION BOUND, AND ANY CODE THAT USES IT AS ONE IS A BUG. The
 * grading service shipped for a day with its own `DUEL_ROUNDS = 6` and refused
 * every verdict from round 7 on, which is to say it stopped grading exactly when a
 * duel got interesting. Bound a round index with DUEL_ROUND_CEILING.
 */
export const DUEL_ROUNDS = 6;

/**
 * The hard backstop, and NOT the design's answer to a stalled duel.
 *
 * A loop with no exit is a hang, and the PvP authority, the test harness and the
 * netcode agent's replay all drive this machine in a `while (!resolved)`. So the
 * machine guarantees termination structurally at a ceiling generous enough that
 * reaching it means something went wrong rather than something went long — roughly
 * four times the typical duel.
 *
 * A duel that reaches it resolves on health difference, exactly as the old
 * rounds-exhausted path did. The real anti-stall proposal is in the report and is
 * deliberately NOT implemented here; the owner asked for a recommendation first.
 *
 * THIS IS THE ONLY HONEST BOUND ON A ROUND INDEX. A round index is valid iff it is
 * an integer in `0 .. DUEL_ROUND_CEILING - 1`, because that is precisely the set of
 * rounds the machine can reach.
 */
export const DUEL_ROUND_CEILING = 24;

/**
 * Whether `roundIndex` could name a round of a duel. The one bound, in one place.
 *
 * ZERO-BASED, AND THE MACHINE'S OWN `round` IS NOT. `DuelState.round` counts from 1
 * — round 0 is the face-off, which asks no question — and the last round the
 * machine can open is `DUEL_ROUND_CEILING` itself, so a one-based wire wants
 * `1 .. DUEL_ROUND_CEILING` and must not pass its number through here. Feeding a
 * one-based round to this helper refuses the final round of the longest duels,
 * which is the same off-by-one it exists to prevent, one index over. Use it for a
 * field called `roundIndex`; bound a field called `round` against the ceiling
 * directly.
 */
export function isLegalRoundIndex(roundIndex: number): boolean {
  return (
    Number.isInteger(roundIndex) &&
    roundIndex >= 0 &&
    roundIndex < DUEL_ROUND_CEILING
  );
}
