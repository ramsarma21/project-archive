// Every tuning number the duel has, in one file, named.
//
// Nothing here is a physics constant: gravity, capsule size, walk/run/crouch
// speed, acceleration and the substep all belong to @pa/engine-world and are
// consumed through engine.ts. What lives here is combat and structure — round
// shape, ballistics, damage, and the two decisions the design brief left open.

import { FIELD_TICK_HZ } from "./engine.js";

const ticks = (seconds: number): number => Math.round(seconds * FIELD_TICK_HZ);

// ---- structure -------------------------------------------------------------
//
// The round count and the termination backstop live in ./structure.ts, which has
// no imports, so a consumer that only needs to know what a legal round index is —
// the grading service, at the wire — can read them without loading the engine.
// They are re-exported here because this is where a reader looks for a tuning
// number, and there must be exactly one definition of each.

export {
  DUEL_ROUNDS,
  DUEL_ROUND_CEILING,
  isLegalRoundIndex,
} from "./structure.js";

export const FACE_OFF_SECONDS = 10;
export const ENGAGEMENT_SECONDS = 20;
/** PvP: once every verdict has landed, a 3-second countdown resumes play. */
export const RESUME_COUNTDOWN_SECONDS = 3;
/** The boss breaks line of sight to reload; a flintlock takes about this long. */
export const LINE_OF_SIGHT_BREAK_SECONDS = 1.5;

export const FACE_OFF_TICKS = ticks(FACE_OFF_SECONDS);
export const ENGAGEMENT_TICKS = ticks(ENGAGEMENT_SECONDS);
export const RESUME_COUNTDOWN_TICKS = ticks(RESUME_COUNTDOWN_SECONDS);
export const LINE_OF_SIGHT_BREAK_TICKS = ticks(LINE_OF_SIGHT_BREAK_SECONDS);

// ---- the bullet economy ----------------------------------------------------
//
// 14 for a correct answer, 7 for a wrong one.
//
// THE TRAP THIS PAIR OF NUMBERS OPENS, AND THE GUARD THAT CLOSES IT.
//
// With 3 and 1 the grant was obviously spendable: nobody had to ask whether a
// player could fire three balls in twenty seconds. Fourteen is a different
// question. A magazine larger than the round can physically discharge is not a
// magazine, it is a number on a HUD — every ball above the ceiling expires unfired,
// 14 and 7 collapse into the same round, and the entire knowledge-to-power link
// disappears while every test in this package still passes. That is the worst
// available failure here, because it is silent.
//
// So the ceiling is computed, not assumed: MAX_SPENDABLE_SHOTS_PER_ROUND below is
// derived from the round length and the reload, and `assertGrantIsSpendable`
// refuses to let the package load if the correct-answer grant exceeds it. Changing
// the reload without changing the grant now fails loudly at the boundary instead of
// quietly at the design level.
//
// THE RATIO ALSO WEAKENED, AND THAT CHANGES WHAT THE ECONOMY MEANS. It was 3:1 and
// it is now 2:1, while the floor rose from 1 ball to 7. One ball meant a wrong
// answer lost you the exchange outright. Seven can win a round. So knowledge no
// longer decides a round, it decides a MATCH: the correct-answer player deals twice
// the damage per round and therefore reaches zero-health-opponent in about half the
// rounds. That is a cumulative-attrition coupling rather than a decisive-per-round
// one — kinder to a student who blanks once, and sound only if the advantage still
// reliably picks the winner. `winnability.test.ts` simulates exactly that, and
// measures 8/8 to the knowledgeable player head to head.
//
// THE RATIO IS AN OUTPUT, NOT AN INPUT, which is the thing to understand before
// moving either number, and it is why the ratio being exactly 2 right now means
// nothing. 14 is set by what a round can physically discharge, and 7 by how much of
// a round the loser's magazine has to fill (see KNOWLEDGE_ADVANTAGE_RATIO below).
// The ratio is whatever those two decisions leave behind, and it landed on a round
// number by coincidence. It was 2 for a long time for a much worse reason — a HUD
// test required the correct grant to be exactly twice the wrong one — and that
// assertion is gone. Nothing requires the ratio to be 2 now, and nothing should be
// allowed to require it again.

export const BULLETS_FOR_CORRECT = 14;
export const BULLETS_FOR_WRONG = 7;

/**
 * WHY THE WRONG-ANSWER FLOOR IS 7, WHY 9 WAS TRIED, AND WHY IT CAME BACK.
 *
 * 7 IS THE SHIPPED FLOOR AND IT IS NOT AN ENDORSEMENT. It has one known cost, recorded
 * below, and it stays at 7 until the owner has played the boss fight themselves. That
 * is the whole reason, and it is a good one: every number in this file is a projection
 * or a simulation, and the question 9 was trying to answer — "is a wrong-answer round
 * boring?" — is the one question no simulation can answer. Do not raise it again on the
 * strength of the measurements below. They were taken, they are real, and they were
 * still not enough.
 *
 * WHAT 7 COSTS, AND IT IS THE REASON TO REVISIT IT. The wrong-answer round is
 * two-thirds empty. Measured at tier 1: 47% dead air against the correct path's 31%,
 * and the player holds a ball for only 34% of the round against 67%, because 7 balls at
 * a 1.0s reload fill 35% of a 20-ball round where 14 fill 70%. At tier 5 the dead air
 * is 64%. The real second-order punishment for answering wrong is not more rounds but
 * emptier ones, and that is the struggling student's whole experience of the boss fight.
 *
 * 7 IS NOT PINNED BY ANYTHING ANY MORE, WHICH IS THE PART WORTH KEEPING. It used to be
 * held by a presentation test: `duelPresentation.test.ts` asserted that a correct answer
 * is "exactly two rows of a wrong one", which is only satisfiable while
 * BULLETS_FOR_CORRECT is EXACTLY twice BULLETS_FOR_WRONG — a magazine layout
 * constraining game balance, which is the wrong way round. That assertion is gone. The
 * HUD derives a row width from whatever the economy is, and the test asserts that the
 * magazine READS. So 7 is now a balance decision that happens to sit at a 2:1 ratio,
 * rather than a ratio wearing a balance decision's clothes. Do not let a layout pin
 * these numbers again.
 *
 * WHAT 9 BOUGHT, MEASURED RATHER THAN PROJECTED (`scripts/sweep.mts`): dead air on the
 * wrong-answer path falls from 47% to 31% at tier 1 — exactly the figure the CORRECT
 * path gets — and from 64% to 53% at tier 5. Time holding a ball rises from 34% to 44%,
 * and round fullness from 35% to 45%. The wrong-answer path shortens from 6.1 rounds to
 * 5.1 at tier 1 and from 7.0 to 6.1 at tier 5, so the weaker student stops getting the
 * longest fight in the game as well as the hardest one. `assertGrantIsSpendable` is
 * indifferent either way: it bounds the CORRECT grant, which does not move.
 *
 * THE WRONG-ANSWER MARGIN DOES NOT MOVE AT ALL BETWEEN THE TWO, AND THE CANCELLATION IS
 * EXACT RATHER THAN APPROXIMATE. The boss's `magazinePerRound` IS BULLETS_FOR_WRONG, so
 * with W as the grant, k as the boss's accuracy-times-damage and p as the player's:
 *
 *   roundsForBossToWin   = playerHealth / (W x k)
 *   roundsForPlayerToWin = bossHealth   / (W x p)
 *   margin               = playerHealth x p / (k x bossHealth)      <- W cancels
 *
 * So no gate in this package can see the difference: `assertBossWinnableOnWrongAnswers`
 * reports 1.68 / 1.61 / 1.54 / 1.48 / 1.42 across tiers 1-5 at either grant, to four
 * decimal places, and `playerHitsOfSlack` is likewise identical at 3.7 / 3.3 / 2.9 /
 * 2.6 / 2.3. `correctPathRoundCeiling` is invariant for the same reason. Verified at 7,
 * 8, 9, 10 and 14 rather than argued.
 *
 * AND THAT SAME IDENTITY IS WHY 9 IS NOT FREE, WHICH IS WHAT SENT IT BACK. The boss's
 * magazine tracking the grant is what makes the margin cancel, and it is also a 29%
 * RISE IN BOSS DAMAGE PER ROUND on every path — including the correct one, where the
 * player gets no compensating grant, because 14 does not move. The projection shows it
 * where the margin hides it: correct-path slack falls from 6.4 clean hits to 5.6 at
 * tier 1 and from 5.0 to 4.2 at tier 5. Simulated against the FALLIBLE student rather
 * than the near-untouchable reference one, over 64 seeds:
 *
 *   tier 5, knows every answer     56/64 wins -> 46/64, finishing on 38 health not 68
 *   tier 5, knows none of them     21/64      -> 12/64
 *   tier 3, knows none of them     61/64      -> 53/64
 *
 * A student who knows every answer losing ten more runs in sixty-four is a real
 * difficulty increase, and it arrived as a side effect of a fix aimed at pacing. The
 * arguments FOR shipping it anyway are all still true — every guard passes, the gap
 * between knowing and not knowing does not narrow (it widens at tier 3), and this file
 * argues at length that both paths winning comfortably is the defect rather than the
 * goal. They are just not the owner's to concede on a spreadsheet.
 *
 * IF THE DEAD AIR IS THE THING TO FIX, THE LEVER IS TO DECOUPLE THE BOSS'S MAGAZINE,
 * and it is a design decision rather than a tuning one. Giving the boss its own authored
 * magazine at 7 would let the player's floor rise without handing the boss the damage —
 * but then the grant STOPS cancelling: the margin rises to about 2.16 at tier 1 and 1.83
 * at tier 5, the wrong-answer path becomes comfortably winnable again (the exact thing
 * BOSS_BASE_HEALTH was raised to 450 to stop), and `correctPathRoundCeiling` climbs past
 * 6, which fails "SIX ROUNDS IS ARITHMETICALLY IMPOSSIBLE" in `boss.test.ts`. It also
 * contradicts the argument in `boss.ts` that a boss shoots like a player who knew
 * nothing, always. Read all four before reaching for it; the owner picks.
 */
export const KNOWLEDGE_ADVANTAGE_RATIO = BULLETS_FOR_CORRECT / BULLETS_FOR_WRONG;

/**
 * THE EXPIRY RULE, AS ONE NAMED PARAMETER. This is the value to change; nothing
 * downstream assumes expiry, and no reducer restates it.
 *
 * `applyCarryPolicy` in bullets.ts is the single place unspent balls are resolved,
 * `grantRoundBullets` is its only caller, and both take the policy as an argument
 * with this constant as the default — so switching the whole game to carry is
 * editing this line, and switching one duel is passing `carryPolicy` to
 * `createDuel`. The owner asked to be able to trade expiry against fire rate
 * without the economy being rewritten; that trade is this constant and
 * FIRE_INTERVAL_SECONDS, and `assertGrantIsSpendable` keeps the pair honest.
 *
 * EXPIRE is the shipped choice, for two reasons that survived the change from
 * 3/1 to 14/7.
 *
 * Carrying amplifies rather than rewards. Read it from the losing side: only a
 * magazine with something left over can bank, and the player with the most left
 * over is the player who was already granted the most. Carry therefore compounds
 * the knowledge advantage round over round, and with the count now unbounded it
 * compounds without limit — the exact direction the design forbids, since
 * knowledge must be an advantage and not a runaway.
 *
 * Expiry also has the better fiction, and it is the same fiction as the round
 * boundary: the boss breaks line of sight to reload. A ball you did not fire while
 * he was exposed is an opportunity that has passed, not inventory.
 *
 * CARRY is implemented and tested so playtest can flip one constant, and it takes
 * a cap precisely because uncapped carry is the degenerate case.
 */
export type BulletCarryPolicy =
  | { readonly kind: "EXPIRE" }
  | { readonly kind: "CARRY"; readonly cap: number };

export const BULLET_CARRY_POLICY: BulletCarryPolicy = { kind: "EXPIRE" };

/** A cap worth trying first if playtest wants carry: one round of slack. */
export const SUGGESTED_CARRY_CAP = BULLETS_FOR_CORRECT;

// ---- ballistics ------------------------------------------------------------

/**
 * DELIBERATE, OWNER-APPROVED DEPARTURE FROM REALISM. Do not "fix" this toward
 * historical accuracy.
 *
 * A real flintlock ball leaves the muzzle at roughly 300 m/s and crosses this
 * arena in under a tenth of a second — faster than a human reacts, which makes
 * dodging decorative. The entire round is built on dodging being real, so here the
 * physics yields to the mechanic: the ball travels at a readable ~0.9s across a
 * 20m arena.
 *
 * This is the one place the duel knowingly breaks with the project's
 * historical-accuracy rule, and the boundary is narrow: the world, the events, the
 * documents and every historical claim stay accurate. Only the ball's speed is
 * licensed, for the same reason the runner's abilities are.
 */
export const BULLET_SPEED_MPS = 22;
export const BULLET_LIFETIME_SECONDS = 2;
export const BULLET_LIFETIME_TICKS = ticks(BULLET_LIFETIME_SECONDS);
/** Muzzle stand-off so a fighter never spawns a ball inside their own capsule. */
export const MUZZLE_OFFSET_M = 0.45;
/** Shots below this or above this are clamped; keeps a ball out of the floor. */
export const MIN_BULLET_HEIGHT_M = 0.35;
export const MAX_BULLET_HEIGHT_M = 2.2;

/**
 * The reload, for everyone.
 *
 * 0.55s was sized for a three-ball magazine and is wrong for a fourteen-ball one
 * in both directions. It empties a correct-answer magazine in 7.2 seconds of a
 * 20-second round, which is a trigger dump rather than a gunfight, and it makes
 * every ball cheap enough that aiming stops mattering.
 *
 * 1.0s is chosen against the round, not against a feel target. Fourteen balls at
 * one second span thirteen seconds of the twenty, so the magazine paces the round
 * instead of front-loading it, and MAX_SPENDABLE_SHOTS_PER_ROUND lands at 20 —
 * six balls of slack over the correct-answer grant, which is the margin a player
 * needs to spend a full magazine after opening the round behind cover.
 *
 * Do not raise this without re-reading `assertGrantIsSpendable`. At 1.53s the
 * ceiling touches 14 and the correct answer starts silently losing balls; the
 * assertion fires first, but the number to keep an eye on is the slack, not the
 * hard limit.
 */
export const FIRE_INTERVAL_SECONDS = 1.0;
export const FIRE_INTERVAL_TICKS = ticks(FIRE_INTERVAL_SECONDS);

/**
 * The most balls a fighter can physically discharge in one engagement window.
 *
 * The first shot is free — a round opens with the reload already elapsed, because
 * `clearFieldForBoundary` zeroes `fireReadyAtTick` — and each one after it costs a
 * full interval. `combat.test.ts` measures this against the real machine rather
 * than trusting the arithmetic, because it is the number the whole economy rests
 * on and an off-by-one here is a silent design failure.
 */
export const MAX_SPENDABLE_SHOTS_PER_ROUND =
  1 + Math.floor((ENGAGEMENT_TICKS - 1) / FIRE_INTERVAL_TICKS);

/** Balls of a correct-answer magazine that cannot be fired before the round ends. */
export const UNSPENDABLE_CORRECT_BULLETS = Math.max(
  0,
  BULLETS_FOR_CORRECT - MAX_SPENDABLE_SHOTS_PER_ROUND,
);

/**
 * Refuses a magazine the round cannot discharge.
 *
 * This is the guard on the one failure mode that would not show up as a failing
 * test: if the grant exceeds what the reload allows, 14 and 7 become the same
 * round and knowledge stops converting into power, silently. Called at module load
 * from index.ts, so the package will not import in that state.
 */
export function assertGrantIsSpendable(): void {
  if (UNSPENDABLE_CORRECT_BULLETS > 0) {
    throw new Error(
      `a correct answer grants ${BULLETS_FOR_CORRECT} balls but a ` +
        `${ENGAGEMENT_SECONDS}s round at a ${FIRE_INTERVAL_SECONDS}s reload can ` +
        `only discharge ${MAX_SPENDABLE_SHOTS_PER_ROUND}. ` +
        `${UNSPENDABLE_CORRECT_BULLETS} would expire unfired every round and the ` +
        `correct answer would be worth the same as a wrong one. Lower ` +
        `FIRE_INTERVAL_SECONDS or lower BULLETS_FOR_CORRECT.`,
    );
  }
}

// ---- dodge -----------------------------------------------------------------
//
// A dodge IS the engine's burst: its direction, speed and duration are
// DASH_SPEED_SCALE and DASH_DURATION_MS in playerMotion.ts, shared with the parkour
// dash, and the duel has no say in any of them. What is left here is the pair of
// numbers only a gunfight has an opinion about — how long the roll is immune, and
// how often you may roll — and the immunity is deliberately much shorter than the
// burst, so a dodge is mostly about physically leaving the ball's path.

export const DODGE_IFRAME_SECONDS = 0.14;

/**
 * How often a dodge may be taken. RAISED FROM 1.1s, and this is the most
 * consequential single number changed in this pass.
 *
 * At 1.1s a dodge was not a decision. Balls arrived far enough apart that the roll
 * was always available, so the correct play was to dodge every ball that would
 * connect, and there was never a reason not to. Measured in a PvP mirror of two
 * maximally attentive players, that produced a fight in which neither side could
 * land anything at all: 336 shots for 1 hit and 168 for 2, no knockout, the match
 * running to the round ceiling and being decided by a 5% health difference that was
 * noise. Under an unbounded format that is not a curiosity, it is the stall.
 *
 * At 2.0s the same mirror resolves by knockout in 6 rounds and the player who
 * answered correctly wins all 8 seeds, finishing on 80% health. Nothing else changed.
 * Evasion stops being free, so volume eventually finds a target, and the interesting
 * question becomes WHICH ball to spend the roll on rather than whether to roll.
 *
 * IT ALSO SETS A FLOOR UNDER EVERY RELOAD IN THE GAME, WHICH IS NOT OBVIOUS. A
 * shooter whose balls arrive further apart than 2.0s can be dodged indefinitely,
 * because the cooldown is back before the next ball is. That is the constraint that
 * stops the boss's fire interval being slowed to spread its magazine across more of
 * the round: at every tier it is already under two seconds, and it has to stay
 * there or the stall comes back one fighter at a time.
 *
 * It is also the anti-stall mechanism, arrived at from the other direction — see
 * the report. A timer or a sudden-death threshold terminates a stalled duel; this
 * removes the reason it stalls, which is that perfect evasion beats perfect aim.
 * One constant, and 1.1 is a one-line revert if playtest disagrees.
 */
export const DODGE_COOLDOWN_SECONDS = 2.0;
export const DODGE_IFRAME_TICKS = ticks(DODGE_IFRAME_SECONDS);
export const DODGE_COOLDOWN_TICKS = ticks(DODGE_COOLDOWN_SECONDS);
/** Shooting mid-dodge is refused: committing to the roll costs you the shot. */
export const FIRE_WHILE_DODGING = false;

// ---- health and damage -----------------------------------------------------

/**
 * TUNING DECISION 2 — THE EXCHANGE MODEL, which replaces the round budget.
 *
 * The old model asked one arithmetic question — "can six shots kill him?" — and
 * capped boss health at the answer. With the round count unbounded that question
 * has no meaning: a player who keeps turning up always lands the last ball
 * eventually. What decides an unbounded duel is which health pool empties first,
 * so the model is now a rate comparison and health is the primary lever on how
 * long a match runs.
 *
 *   player damage per round  =  bullets granted  x  accuracy  x  shot damage
 *   rounds for the player    =  boss health   /  player damage per round
 *   rounds for the boss      =  player health /  boss damage per round
 *   the player wins iff the first number is smaller than the second
 *
 * Everything below is derived from four targets.
 *
 * A MID-TIER DUEL ON WRONG ANSWERS SHOULD RUN FIVE OR SIX ROUNDS. Seven balls at the
 * reference player's measured accuracy is 70 damage a round, so a boss of 450 health
 * takes six and a half projected and measures 6.1 at tier 1. That deliberately
 * preserves the length the six-round format used to impose, so the mode still feels
 * like the mode — but it is at the top of the intended band rather than the middle of
 * it, and nearly half of those rounds is dead air. See KNOWLEDGE_ADVANTAGE_RATIO for
 * what raising the floor would buy and what it would cost.
 *
 * A CORRECT ANSWER SHOULD SHORTEN THE DUEL BY ABOUT A THIRD. Fourteen balls is twice
 * the damage rate, so the same boss falls in about half the rounds projected and 4.3
 * measured. This is the whole of the economy expressed in the only currency an
 * unbounded fight has — rounds survived. It is weaker than the 3:1 it started as, and
 * it is cumulative rather than decisive: no single round is won by knowing the answer,
 * but a player who knows them reaches the kill sooner and takes less return fire
 * doing it.
 *
 * THE BOSS MUST BE ABLE TO WIN, AND THAT TARGET WAS MISSING. Every number here was
 * derived from the player's side of the exchange and none from the boss's, so the
 * model was never asked the second question it prints above. It answered 39.7
 * rounds for a tier 1 boss to empty a player, and the simulation — against a
 * player who did nothing at all — agreed at 23.9 rounds, which is to say the first
 * boss a student ever meets could not finish a fight inside the termination
 * backstop. Under the six-round format that was invisible: a boss who could not win
 * simply lost on round six and the fight ended on schedule. With health-based
 * termination, a boss that cannot win produces a fight that cannot end. The boss's
 * side of the exchange is now a target like any other, held between eight and
 * eleven rounds across the tiers, and `sweep.mts` measures it.
 *
 * A HIT SHOULD BE ABOUT A TENTH OF A BAR. Health fell from 400 to 200 for this.
 * At 400 against a tier 1 boss's shot the duel HUD opened its "hits left" readout
 * at 34 and ticked it down over a minute, which reads as context rather than as a
 * countdown — the presentation agent's judgement was that eight to ten would feel
 * like the fight closing in. That is the same number as the target above, seen from
 * the other end: hits-to-fall is rounds-for-the-boss-to-win multiplied by the balls
 * it throws each round, so a boss that needs eleven rounds to kill you IS a bar
 * that opens at ten hits. One change satisfies both, and the readout now opens at
 * 10 against tier 1 and 8 against tier 5.
 *
 * AND THE FIRST FOUR TARGETS TOGETHER INVERTED THE POINT OF THE MODE, WHICH IS THE
 * FIFTH. Every one of them is written from the boss's side or the round's side, and
 * none asked what the player who KNOWS THE ANSWERS actually gets. The answer was: a
 * shorter fight and nothing else. Against the tier 1 boss a student answering
 * everything correctly finished in 2.6 rounds — measured 2.1 for a fallible one, two
 * rounds and twenty-nine seconds of shooting — while a student answering everything
 * wrong got 4.5 rounds and won anyway, on 89% health. So knowledge bought no
 * outcome, because both paths won comfortably; it bought only the deletion of the
 * climax. The better a student did in the learning module, the less boss fight they
 * were given, and "the reward for learning is less game" is the exact opposite of
 * what the mode is for.
 *
 * IT WAS A CONSEQUENCE OF THE MODEL, NOT A MISSED NUMBER, AND THE ARITHMETIC BOUNDS
 * THE FIX TIGHTLY. Rearranging the four lines above:
 *
 *   correct-path rounds  =  rounds-for-the-boss-to-win / (ratio x wrong-path margin)
 *
 * The ratio is 2 and the margin may not fall below REQUIRED_WRONG_PATH_MARGIN, so a
 * correct-answer fight can never project longer than `roundsForBossToWin / 2.3`. And
 * `roundsForBossToWin` cannot simply be raised to buy room: it is how long the boss
 * needs to empty a player, so raising it is a boss that finishes a passive one more
 * slowly, against the bound `winnability.test.ts` puts on termination. It runs 9.2 to
 * 10.8 across the shipped tiers, which puts the projected ceiling at 4.0 rounds at
 * tier 5 and 4.7 at tier 1.
 *
 * THOSE CEILING NUMBERS DID NOT MOVE WHEN THE RATIO DID, and the reason is worth
 * knowing before using this formula to price a change. `roundsForBossToWin` is
 * inversely proportional to the wrong-answer grant and so is the ratio, so the grant
 * cancels here exactly as it does in the margin — the ceiling is
 * `playerHealth / (bossAccuracy x bossDamage x BULLETS_FOR_CORRECT x margin)` once
 * reduced, and only the CORRECT grant appears in it. Raising the wrong-answer floor
 * buys no room on the correct path and costs none either.
 *
 * A ROUND IS AN INTEGER AND THE LAST ONE IS PARTIAL, so the simulation lands about
 * one round above the projection — the shipped 3.2 projects into a measured 4.3. Read
 * the ceiling in either currency and the answer is the same: SIX ROUNDS IS
 * ARITHMETICALLY IMPOSSIBLE, because six of them need a wrong-answer margin of 0.9
 * projected or 1.06 measured, and both are boss profiles the wrong-answer player
 * cannot beat. The owner's instinct was four to six. The model's answer is four, and
 * it is a ceiling rather than a preference.
 *
 * The same rearrangement prices the fix, and the price is the point. Health at the
 * kill is exactly `1 - 1/margin` of the bar, so a longer fight is a closer one by
 * construction: the wrong-answer path now ends at a third of the bar where it used to
 * end at two thirds. That is the intended half of this change rather than a side
 * effect — a wrong-answer path that a skilled player finishes on 89% health is not a
 * fight anybody could lose, and "knowledge decides the match" is empty while both
 * paths win easily.
 *
 * 450 is where four rounds lands, and it is set against the SIMULATION rather than the
 * ceiling above, which is why it is not 550. Measured at tier 1: 4.3 rounds on the
 * correct path against 6.1 on the wrong one, margin 1.68. Past about 470 the top
 * tier's wrong-answer path starts failing its own guard — a mechanically strong player
 * who answered everything wrong gets knocked out — so the arithmetic ceiling is not
 * reachable in practice and the empirical wall arrives first.
 *
 * HEALTH NO LONGER CARRIES THE TIER CURVE, WHICH REVERSES THE ADVICE THIS COMMENT
 * USED TO GIVE, AND THE OLD ADVICE IS WHAT HELD THE DEFECT IN PLACE. Health was
 * 250 + 35 a tier because "with no budget to exhaust, health is simply duration and
 * it is safe to scale", and `boss.test.ts` pinned a 1.5x spread across the tiers to
 * prove it was a real lever. Those two facts together CAP THE BOTTOM OF THE CURVE:
 * tier 5's health is bounded above by the winnability gate, so a 1.5x spread bounds
 * tier 1's at two thirds of that, and two thirds of the gate is the two-round fight
 * M1 shipped. The test written to prove health mattered is precisely what stopped
 * it being usable where it was needed.
 *
 * So duration is now a CONSTANT OF THE FORMAT rather than a difficulty dial: every
 * tier is about four rounds on the correct path, and BOSS_HEALTH_PER_TIER is 0. What
 * a higher tier buys is lethality inside those rounds — a tighter cone, a better
 * lead, a faster ball, more evasion — which is where boss.ts's own comment says the
 * curve always actually lived. Flat health is also what makes the round count flat:
 * the player's measured accuracy FALLS as the tier rises, from 53% to 44% on the
 * correct path, so equal health already produces a slightly longer fight at the top
 * (4.3 rounds at tier 1 against 4.4 at tier 5) and a rising curve would compound
 * duration with lethality in the one place there is no room for either.
 */
export const PLAYER_MAX_HEALTH = 200;
export const PLAYER_SHOT_DAMAGE = 20;

/**
 * Sized so a correct answer buys a four-round boss fight rather than a two-round
 * one. See the exchange model above for why four is a ceiling and not a preference,
 * and why this is flat across the tiers.
 */
export const BOSS_BASE_HEALTH = 450;
/**
 * Zero, deliberately, and it is kept as a named parameter rather than deleted so
 * that reintroducing a duration curve stays a one-line experiment. Anything above
 * about 5 starts taking health from the top tier's wrong-answer path, which is the
 * first thing to fail: at 470 a tier 5 boss knocks out a mechanically strong player
 * who answered everything wrong in 2 runs of 8, against an allowance of 1.
 */
export const BOSS_HEALTH_PER_TIER = 0;

/**
 * Measured, not assumed: the share of balls the reference skilled player lands
 * against a strafing, dodging boss, averaged over the shipped tiers and the seed
 * set. `scripts/sweep.mts` prints it; re-measure and update it whenever ballistics,
 * the arena or the dodge change, because every projection below is built on it.
 */
export const REFERENCE_PLAYER_ACCURACY = 0.5;

/**
 * The same number for a boss shooting at a player who dodges properly. It is far
 * lower than the player's because the boss carries authored aim error and only a
 * partial lead solution, and because a competent target simply leaves.
 *
 * IT IS FLAT ACROSS THE TIERS AND THE REAL THING IS NOT, WHICH IS A KNOWN LIMIT OF
 * THE MODEL AND THE REASON `winnability.test.ts` IS THE AUTHORITY. Measured against
 * the reference player, a boss lands roughly 5% of its balls at the bottom of the
 * aim curve and 12% at the top; against a passive one, 17% and 57%. A single number
 * cannot say that, so `projectExchange`'s estimate of how long the BOSS needs is
 * only trustworthy near the top of the curve, and at the bottom it is optimistic by
 * a factor of two or three.
 *
 * The bias is deliberately kept in that direction. `assertBossWinnableOnWrongAnswers`
 * exists to catch a boss that OUT-PACES the player, so a constant that over-states
 * boss accuracy makes the gate refuse early rather than late, which is the safe way
 * for a guard to be wrong. What it cannot do is notice a boss too weak to win — a
 * flat accuracy cannot express an aim cone nobody can be hit by — and that blind
 * spot is exactly how a tier 1 boss that could not finish a duel reached a mission.
 * The passive-player sweep and the "EVERY BOSS CAN WIN" test are the answer to it;
 * do not try to make this number carry both jobs.
 */
export const REFERENCE_BOSS_ACCURACY = 0.12;

/**
 * How much better the wrong-answer path has to be than a coin flip.
 *
 * The design rule survives the format change unaltered — answering wrong is a
 * handicap, never a lockout — but it needs a number now that it is a rate
 * comparison rather than a shot count. 1.15 means a player who answers every
 * question wrong still reaches the kill 15% sooner than the boss reaches theirs,
 * which is the smallest edge that survives real variance as a win rate above half.
 * The top tier is meant to sit just above this line, not comfortably above it.
 */
export const REQUIRED_WRONG_PATH_MARGIN = 1.15;

// ---- the aim model ---------------------------------------------------------
//
// STATED EXPLICITLY, BECAUSE IT SETS THE SKILL CEILING FOR THE WHOLE PRODUCT AND
// SHOULD NOT BE SOMETHING THAT FALLS OUT OF AN IMPLEMENTATION.
//
// Two constraints pull against each other. The owner wants a real mechanical
// ceiling, so that getting better is possible and worth doing. The audience is
// thirteen-year-olds on school hardware, a good share of them on trackpads, where
// fine angular precision is not a skill anyone can practise their way into — it is
// a hardware tax. The model has to delete the tax without deleting the ceiling.
//
// It does that by being explicit about WHICH dimension of aiming is skill:
//
//   1. ONE AXIS. The player aims a heading in the ground plane; elevation is
//      solved by the simulation, which flies the ball at the height of the chest it
//      was aimed at. Vertical aim is the axis a chase camera makes ambiguous and a
//      trackpad makes miserable, and deleting it costs no decision anybody enjoys
//      making. Height still matters — but as the DEFENDER's mechanic, where it is
//      readable: crouch and an aimed ball goes over you.
//
//   2. THE BALL NEVER LIES. No magnetism, no curving in flight, no inflated hitbox
//      for one side, no second hit test. The ball goes exactly where the aim vector
//      points at the speed everyone can see. This is not negotiable, because the
//      tracer is the OPPONENT's dodge cue: a ball that bends toward its target is a
//      ball whose path the other player cannot trust, and in PvP that is a lie told
//      to one player for the benefit of the other.
//
//   3. ASSISTANCE IS A CORRECTION TO THE AIM BEFORE THE SHOT, BOUNDED AND SHARED.
//      Inside a cone around the true intercept solution, the aim snaps to it.
//      Outside the cone, it is untouched. So the shot is still honest — the assist
//      moves the crosshair, not the bullet.
//
// WHY A FULL SNAP INSIDE THE CONE RATHER THAN A PARTIAL NUDGE. A partial correction
// helps most the players who were already nearly on target and barely helps the
// ones who were not, which is precisely backwards from the requirement. A full snap
// inside a modest cone deletes exactly one thing — sub-degree pointing precision —
// and that is the thing the trackpad constraint says must go.
//
// WHY THE CEILING SURVIVES IT. The snap target is the intercept for the opponent's
// CURRENT velocity. It is right only if they keep going the way they are going. A
// player who changes direction after you commit makes the solution wrong, and no
// cone can fix that. So what remains, entirely intact, is: reading a feint,
// choosing the moment, choosing the lane, holding a shot until the opponent commits
// to a direction, and managing a magazine and a dodge cooldown against a 20-second
// clock. That is a deep enough ceiling for a duel, and none of it is a hardware tax.
//
// The tolerance is a lateral distance at the target converted to an angle, then
// clamped. A fixed angle would make range irrelevant to difficulty and players
// would stand at the back and plink; a pure distance tolerance would become an
// enormous auto-turn at point-blank. This is roughly a 4-5x widening of the target
// at every range, which is legible and does not vary in feel as the fight moves.

/** Lateral forgiveness at the target. About 4.5 capsule radii. */
export const AIM_ASSIST_LATERAL_M = 1.6;
/** Never turn a shot further than this, however close the opponent is. */
export const AIM_ASSIST_MAX_RAD = 0.21;

/**
 * Whether a fighter's shots are aim-corrected, and by how much.
 *
 * A PARAMETER RATHER THAN A GLOBAL because the boss must not have it. The boss's
 * difficulty is authored directly as `aimErrorRad`, and an assist would snap that
 * jitter away and make every tier a perfect shot. Both human sides in PvP carry the
 * same profile, so the correction is symmetric where symmetry matters.
 */
export interface AimAssistProfile {
  readonly lateralMetres: number;
  readonly maxRadians: number;
}

export const PLAYER_AIM_ASSIST: AimAssistProfile = {
  lateralMetres: AIM_ASSIST_LATERAL_M,
  maxRadians: AIM_ASSIST_MAX_RAD,
};

/**
 * HEADSHOTS DO NOT EXIST AS A DISTINCT OUTCOME. Settled, and recorded here so it is
 * not re-litigated by accident.
 *
 * A hit is a hit anywhere on the capsule, which is engine-world's capsule at its
 * live height, tested by engine-world's `segmentHitsCapsule`. There is no second
 * hit test in this package and no damage multiplier keyed on where the ball
 * connected.
 *
 * Three reasons, in order of weight.
 *
 * The player does not choose the height. The aim model above solves elevation
 * automatically, so which band of the body a ball arrives at is a consequence of
 * the target's stance and the shooter's range, not of a decision anyone made. A
 * bonus for it would be a lottery dressed as a skill, and the brief's test —
 * readable to a thirteen-year-old — is one it fails immediately: the honest
 * explanation is "sometimes you get double damage for reasons you cannot see".
 *
 * Making it a real skill means giving the player vertical aim, and vertical aim is
 * the exact axis deleted above for the exact reason given above.
 *
 * And it would break the exchange model. Damage per round is the load-bearing
 * quantity in an unbounded fight; a 2x band would make the damage rate depend on
 * a stance the shooter cannot control, which is variance in the one number the
 * whole winnability guarantee is computed from.
 *
 * `combat.test.ts` pins this: damage is identical wherever on the body the ball
 * lands.
 */
export const HEADSHOT_IS_A_DISTINCT_OUTCOME = false;

// ---- arena -----------------------------------------------------------------

/** Face-off separation. Both fighters start here, facing each other. */
export const FACE_OFF_SEPARATION_M = 14;
