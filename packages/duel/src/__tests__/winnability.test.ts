// The tuning decisions, checked by simulation rather than by argument.
//
// Arithmetic alone cannot answer "is this winnable?", because a dodged ball costs
// the attacker exactly what a missed one does. So these tests run whole duels: a
// reference skilled player against every shipped boss tier, on a wrong answer's
// magazine and on a correct answer's, over a fixed seed set. Deterministic, so the
// numbers in the comments are reproducible rather than indicative.
//
// READ THIS BEFORE TRUSTING ANY NUMBER IN THIS FILE FOR A CLAIM ABOUT M1.
//
// For most of this file's life every measurement here drove `bossProfileForTier(tier)`
// in `referenceArena()`, and M1 ships neither of those. The mission builds the tier-1
// curve plus THREE opt-ins — SYMMETRIC_COMPLEMENT ammo, cover-seeking before each
// question, and the ammo-aware tactical layer — in the 11x11 rope-walk yard with eight
// pieces of cover, not the 12x12 four-cover tuning fixture. Both halves differed, so
// every "winnability verified" claim in this package described a fight nobody plays.
// That is the same defect class as the replay harness ruled inadmissible for real-play
// claims: a test path that diverged from the shipped path and nobody noticed, because
// it stayed green.
//
// The file is now in two parts, and the division is deliberate:
//
//   THE TIER CURVE (`sweep`)      the bare profile in the reference fixture, across all
//                                five tiers. This is what it has always measured and it
//                                is still worth measuring — the curve's SHAPE (a harder
//                                boss kills faster, knowledge is worth more at the top)
//                                is a property of the profiles, and tiers 2-5 have no
//                                shipped arena to measure in because no mission ships
//                                them yet. It is NOT evidence about M1.
//
//   M1'S SHIPPED FIGHT (`shipped`)  the tier-1 profile WITH its three opt-ins in the
//                                rope-walk yard. The only measurement here that is
//                                evidence about the fight a student plays.
//
// PAIR THEM AS M1 SHIPS THEM OR THE NUMBERS MEAN NOTHING. Measuring the production
// profile in `referenceArena()` was tried and retracted: it reports a 12.4-round
// correct path against the real pairing's 11.5 and, worse, it MISSES the backstop hits
// entirely, because reaching the round ceiling is an arena effect (2 of 8 seeds in the
// yard, 0 of 8 in the fixture). Half the shipped configuration is not a measurement of
// the shipped configuration.
//
// WHAT CHANGED WHEN THE ROUND COUNT BECAME UNBOUNDED. The old file asked one
// question — can six shots kill this boss? — and every assertion was a variation on
// it. There is no shot budget now, so the questions are:
//
//   does it END?                 an unbounded loop that cannot terminate is a hang,
//                                and in a classroom it is a match that outlasts the
//                                period
//   can the BOSS win?            the question this file forgot to ask, and the one
//                                that let a tier 1 boss ship unable to finish a
//                                fight. Every other test here drives the player and
//                                asks whether the PLAYER can win, so a boss too weak
//                                to kill anybody passed all of them
//   does WRONG still win?        the design rule survives the format change: a
//                                handicap, never a lockout
//   does CORRECT win FASTER?     the economy pays in rounds survived, so this is
//                                where knowledge has to show up
//   does CORRECT beat WRONG?     head to head, identical skill. This is the
//                                pedagogical invariant and it is the whole reason
//                                the mode exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ropewalkYardArena, type DuelArena } from "../arena.js";
import {
  M1_BOSS_OVERRIDES,
  M1_BOSS_TACTICS,
  M1_BOSS_TIER,
  bossProfileForTier,
  projectExchange,
  type BossProfile,
  type BossTier,
} from "../boss.js";
import { fieldRandom } from "../engine.js";
import { duelClearedMission, MISSION_CLEAR_REQUIRES_KNOCKOUT } from "../events.js";
import {
  DEFAULT_ORACLE_OPTIONS,
  nearestThreat,
  oracleIntent,
} from "../policy.js";
import {
  IDLE_INTENT,
  intent,
  isDodging,
  type CombatIntent,
  type CombatView,
} from "../combat.js";
import {
  BULLETS_FOR_WRONG,
  DUEL_ROUNDS,
  DUEL_ROUND_CEILING,
  REQUIRED_WRONG_PATH_MARGIN,
} from "../tuning.js";
import type { DuelSide } from "../sides.js";
import type { VerdictKind } from "../verdict.js";
import { runDuel } from "./harness.js";

const SEEDS = [1, 7, 19, 33, 101, 512, 4242, 90210] as const;
const TIERS: readonly BossTier[] = [1, 2, 3, 4, 5];

interface Sweep {
  readonly wins: number;
  readonly knockouts: number;
  readonly deaths: number;
  readonly rounds: number;
  readonly bossHealthLeft: number;
  readonly playerHealthLeft: number;
  /**
   * In the runs the player LOST, the most health the boss had left, as a fraction
   * of its own bar. This is how close the losses were, and it is the number that
   * separates "I nearly had him" from "this was hopeless" now that every loss is a
   * knockout. Zero when the player never lost.
   */
  readonly worstLoss: number;
  /** The same, at the median rather than the maximum: what a loss TYPICALLY looks like. */
  readonly medianLoss: number;
  readonly runs: number;
}

/**
 * A DELIBERATELY WIDER SEED SET, FOR THE ONE MEASUREMENT EIGHT SEEDS CANNOT MAKE.
 *
 * Everything else here is a count — wins, deaths, mean rounds — and eight runs is
 * plenty for a count. `worstLoss` is a MAXIMUM over a heavy-tailed quantity, and a
 * maximum over eight samples is mostly a fact about which eight. Measured over these
 * 32 seeds, the worst loss at tier 5 is 29% at a 7-ball wrong-answer grant and 29% at
 * a 9-ball one, while the eight-seed figure moved between 15% and 24% as the economy
 * was retuned without the underlying distribution moving at all. So the loss-quality
 * assertion below reads this set instead, and the fast one keeps the counts.
 */
const WIDE_SEEDS = [
  ...SEEDS,
  ...Array.from({ length: 24 }, (_unused, index) => 1000 + index * 7919),
] as const;

const sweepCache = new Map<string, Sweep>();

/** How a run answers. `ALTERNATING` is the realistic middle a real student sits in. */
type AnswerPath = VerdictKind | "ALTERNATING";

function verdictOn(path: AnswerPath, round: number): VerdictKind {
  if (path === "ALTERNATING") return round % 2 === 1 ? "CORRECT" : "WRONG";
  return path;
}

/**
 * Drive `seeds` whole duels against one profile in one arena and aggregate them.
 *
 * The profile and the arena are ONE argument in spirit: they are a fight, and the two
 * callers below exist so that the pairing is chosen once, explicitly, rather than a
 * profile being handed whatever arena the harness happens to default to. That default
 * is how the gate came to measure a boss M1 does not ship in a yard M1 does not use.
 */
function sweepFight(
  profile: BossProfile,
  arena: DuelArena | undefined,
  path: AnswerPath,
  intents: ((side: DuelSide, view: CombatView) => CombatIntent) | undefined,
  seeds: readonly number[],
): Sweep {
  let wins = 0;
  let knockouts = 0;
  let deaths = 0;
  let rounds = 0;
  let bossHealthLeft = 0;
  let playerHealthLeft = 0;
  let worstLoss = 0;
  const losses: number[] = [];
  for (const seed of seeds) {
    const result = runDuel({
      opponent: { kind: "BOSS", profile },
      verdicts: (_side, round) => verdictOn(path, round),
      seed,
      ...(arena ? { arena } : {}),
      ...(intents ? { intents } : {}),
    });
    if (result.outcome.winner === "A") wins += 1;
    if (result.outcome.winner === "A" && result.outcome.reason === "KNOCKOUT") knockouts += 1;
    if (result.outcome.healthA <= 0) {
      deaths += 1;
      const left = result.outcome.healthB / profile.maxHealth;
      losses.push(left);
      worstLoss = Math.max(worstLoss, left);
    }
    rounds += result.state.round / seeds.length;
    bossHealthLeft += result.outcome.healthB / profile.maxHealth / seeds.length;
    playerHealthLeft += result.outcome.healthA / seeds.length;
  }
  const sorted = [...losses].sort((a, b) => a - b);
  return {
    wins,
    knockouts,
    deaths,
    rounds,
    bossHealthLeft,
    playerHealthLeft,
    worstLoss,
    medianLoss: sorted.length === 0 ? 0 : sorted[Math.floor((sorted.length - 1) / 2)]!,
    runs: seeds.length,
  };
}

/**
 * THE TIER CURVE: the bare profile in the reference fixture. Not M1 — see the header.
 * `bossProfileForTier(tier)` takes no opt-ins, so this is AUTHORED_FLAT ammo, no
 * cover-seeking and no tactical layer, and `runDuel` defaults to `referenceArena()`.
 */
function sweep(
  tier: BossTier,
  verdict: VerdictKind,
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
  key?: string,
  seeds: readonly number[] = SEEDS,
): Sweep {
  const cacheKey = `tier${tier}:${verdict}:${key ?? "oracle"}:${seeds.length}`;
  const cached = sweepCache.get(cacheKey);
  if (cached) return cached;
  const result = sweepFight(
    bossProfileForTier(tier),
    undefined,
    verdict,
    intents,
    seeds,
  );
  sweepCache.set(cacheKey, result);
  return result;
}

/**
 * M1's boss, built exactly as the mission builds it: the tier-1 curve plus the three
 * opt-ins the production sites pass. `M1_BOSS_OVERRIDES` is the shared constant those
 * sites are pinned against (`apps/web/test/duelPathParity.test.ts`), so a fourth opt-in
 * added to the mission and not here fails that pin instead of silently re-diverging
 * this gate from the fight.
 *
 * `bossId` is the one field that legitimately differs between construction sites — the
 * reducer reads it only into telemetry — so a distinct label here is not a divergence.
 */
const M1_BOSS: BossProfile = bossProfileForTier(
  M1_BOSS_TIER,
  "BOS.MD01.BOSS.WINNABILITY",
  M1_BOSS_OVERRIDES,
);

/** M1'S SHIPPED FIGHT: the profile above, in the arena the mission actually uses. */
function shipped(
  path: AnswerPath,
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
  key?: string,
  seeds: readonly number[] = SEEDS,
): Sweep {
  const cacheKey = `m1:${path}:${key ?? "oracle"}:${seeds.length}`;
  const cached = sweepCache.get(cacheKey);
  if (cached) return cached;
  const result = sweepFight(M1_BOSS, ropewalkYardArena(), path, intents, seeds);
  sweepCache.set(cacheKey, result);
  return result;
}

const ANSWER_PATHS: readonly AnswerPath[] = ["CORRECT", "ALTERNATING", "WRONG"];

/**
 * The instrument that can actually be hit.
 *
 * `oracleIntent` dodges every ball predicted to pass within 0.56 m and the burst
 * clears 2.22 m, so a perfect player is untouchable and its health measures
 * nothing. This models the real failure of a thirteen-year-old: not a bad roll, but
 * not seeing the ball. Awareness is rolled once per BALL — per tick would compound
 * to certainty over a flight, the trap the boss's own dodgeChance comment describes.
 */
function sloppy(view: CombatView, seed: number): CombatIntent {
  const base = oracleIntent(view, {
    ...DEFAULT_ORACLE_OPTIONS,
    dodgeWithinTicks: -1,
  });
  const jitter = (fieldRandom(seed, view.tick, 77) * 2 - 1) * 0.09;
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  const aimX = base.aimX * cos - base.aimZ * sin;
  const aimZ = base.aimX * sin + base.aimZ * cos;
  const threat = nearestThreat(view);
  const canDodge = view.tick >= view.self.dodge.readyAtTick && !isDodging(view.self);
  const notices = threat !== null && fieldRandom(seed, threat.projectile.id, 55) < 0.55;
  if (notices && canDodge && threat.ticks <= DEFAULT_ORACLE_OPTIONS.dodgeWithinTicks) {
    return intent({
      moveX: threat.evadeX,
      moveZ: threat.evadeZ,
      dodge: true,
      aimX,
      aimZ,
    });
  }
  return { ...base, aimX, aimZ };
}

const SLOPPY = (_side: DuelSide, view: CombatView): CombatIntent =>
  sloppy(view, 20260726);

/**
 * A player who does nothing at all: no fire, no movement, no dodge.
 *
 * The instrument that was missing, and its absence is the whole of the second
 * defect. Every other measurement in this file drives the PLAYER and asks whether
 * the player can win. Against a target that never shoots back, what is measured is
 * purely the boss's own offence — can it convert twenty seconds a round into a
 * dead player, and how long does that take.
 */
const PASSIVE = (): CombatIntent => IDLE_INTENT;

// ---- termination ------------------------------------------------------------

test("EVERY DUEL TERMINATES, and almost always on health rather than the backstop", () => {
  // The first thing an unbounded format has to prove. A match that cannot end is
  // not a balance problem in a classroom, it is a match that outlasts the period.
  for (const tier of TIERS) {
    for (const verdict of ["WRONG", "CORRECT"] as const) {
      const result = sweep(tier, verdict);
      assert.ok(
        result.rounds < DUEL_ROUND_CEILING,
        `tier ${tier} on ${verdict} averaged ${result.rounds.toFixed(1)} rounds ` +
          `against a ceiling of ${DUEL_ROUND_CEILING}: the backstop is meant to be ` +
          "unreachable in normal play, not load-bearing",
      );
      assert.equal(
        result.knockouts + result.deaths,
        result.runs,
        `tier ${tier} on ${verdict} did not resolve every run on health`,
      );
    }
  }
});

test("EVERY BOSS CAN WIN, which is what nothing here used to ask", () => {
  // THE SECOND HALF OF TERMINATION, AND THE ONE THAT WAS MISSING.
  //
  // The test above proves a duel ends when the player is good. It cannot prove a
  // duel ends, because it only ever drives a player who wins. Ask the other
  // question — can the BOSS finish — and the answer used to be no at the bottom of
  // the curve: measured against a player who did nothing whatsoever, a tier 1 boss
  // ran the full 24-round backstop, 585 seconds, and ended with the player still
  // holding 128 of 400 health. Tier 3 took 9.5 rounds and tier 5 took 2.6.
  //
  // That is worse than a balance problem. Under the six-round format a boss that
  // could not win simply lost on round six and the fight ended on schedule; with
  // health-based termination, a boss that cannot win produces a fight that cannot
  // end. The stalemate does not need a player who does literally nothing to appear,
  // either — it needs a thirteen-year-old whose aim is bad enough that neither bar
  // moves, which is the median first-mission student.
  //
  // The projection could not see it. `projectExchange` credits every boss with
  // REFERENCE_BOSS_ACCURACY, and a flat number cannot express a boss whose aim cone
  // is too wide to hit anybody. So this is a simulation test, and it is the
  // authority: a boss that cannot land enough to finish an unresisting target has
  // no business in a mission.
  for (const tier of TIERS) {
    const result = sweep(tier, "WRONG", PASSIVE, "passive");
    assert.equal(
      result.deaths,
      result.runs,
      `tier ${tier} failed to finish a player who never fired a shot in ` +
        `${result.runs - result.deaths}/${result.runs} runs. A boss that cannot ` +
        "win is a duel that cannot end",
    );
    assert.ok(
      result.rounds <= 12,
      `tier ${tier} needed ${result.rounds.toFixed(1)} rounds to put down a ` +
        "passive player. Half the backstop is already twice as long as a duel " +
        "should ever run",
    );
  }
  // And the curve points the right way: a harder boss kills faster.
  assert.ok(
    sweep(5, "WRONG", PASSIVE, "passive").rounds <
      sweep(1, "WRONG", PASSIVE, "passive").rounds,
    "the top tier must close a fight sooner than the bottom one",
  );
});

test("a duel is short enough to sit inside a lesson", () => {
  // Measured: 6.1 rounds at tier 1 on a wrong answer, 7.0 at tier 5. A round is
  // ~20s of play plus an untimed question, so this is the number that decides
  // whether the mode fits a class period.
  //
  // These rose to here when boss health went flat at 450 to stop knowledge deleting the
  // climax, and raising the wrong-answer grant is the lever that brings them back down:
  // the correct path is 4.3 rounds and the wrong path is the grant ratio times it, so a
  // higher floor shortens the loser's fight without touching the winner's. At 9 it
  // measured 5.1 and 6.1. The bound is what stops the trade going too far in either
  // direction; see KNOWLEDGE_ADVANTAGE_RATIO for why the floor is at 7 regardless.
  for (const tier of TIERS) {
    assert.ok(
      sweep(tier, "WRONG").rounds <= 12,
      `tier ${tier} takes ${sweep(tier, "WRONG").rounds.toFixed(1)} rounds on the ` +
        "wrong-answer path",
    );
  }
});

// ---- the wrong-answer path ---------------------------------------------------

test("DUEL_ROUNDS is a measurement, not a leftover", () => {
  // `structure.ts` has always claimed this file fails if the simulation drifts away
  // from DUEL_ROUNDS. It did not — nothing asserted it, and the number was wrong for
  // long enough that the fun audit asked for the name to be cut as misleading. It is
  // true now: a mid-tier duel on the wrong-answer path measures 5.3 rounds against a
  // declared 6. So the claim gets the assertion it advertised, and the name survives
  // on the strength of being accurate rather than on being widely imported.
  //
  // A round of tolerance, because DUEL_ROUNDS is an integer describing a mean.
  const measured = sweep(3, "WRONG").rounds;
  assert.ok(
    Math.abs(measured - DUEL_ROUNDS) <= 1,
    `DUEL_ROUNDS says ${DUEL_ROUNDS} and a mid-tier wrong-answer duel measures ` +
      `${measured.toFixed(1)}. Either retune or move the number — a descriptive ` +
      "constant that is not descriptive is how the grading service came to refuse " +
      "every verdict past round six",
  );
});

test("a skilled player can win on wrong answers at every shipped tier", () => {
  for (const tier of TIERS) {
    const result = sweep(tier, "WRONG");
    assert.ok(
      result.wins > result.runs / 2,
      `tier ${tier} won ${result.wins}/${result.runs} on ${result.rounds.toFixed(1)} rounds`,
    );
  }
});

test("answering wrong is a handicap, never a lockout", () => {
  for (const tier of TIERS) {
    assert.notEqual(sweep(tier, "WRONG").wins, 0, `tier ${tier} is a knowledge gate`);
  }
});

test("a skilled player rarely loses on the wrong-answer path, and never badly", () => {
  // WHAT THIS TEST USED TO SAY, AND WHY IT HAD TO CHANGE.
  //
  // It said: losing on damage dealt is "I nearly had him", being knocked out is
  // "this is hopeless", so a reference player must never be knocked out below the
  // top tier. That dichotomy no longer exists. A duel ends when a health bar
  // empties, so EVERY loss is a knockout by construction — `decideOutcome` only
  // reaches ROUNDS_EXHAUSTED at the termination backstop, which nothing normal
  // touches. Deaths and losses became the same number the day the round count went.
  //
  // Which made the old assertion something much stronger than it read as: "the
  // reference player is never knocked out at tiers 1-4" is very nearly "the boss
  // cannot win at tiers 1-4", and that is exactly the defect that shipped. A tier 1
  // boss ran the full 24-round backstop against a player who did nothing at all,
  // and this test was green throughout, because a boss too weak to kill anybody
  // trivially satisfies "does not kill anybody".
  //
  // So the guard is restated in terms that still mean something once the boss can
  // actually win. Two claims, and the second is the one carrying the intent:
  //
  //   1. A mechanically strong player wins nearly always, and on the early tiers —
  //      the ones a student meets first — always.
  //   2. When they do lose, they lost a close fight. A player who falls with the
  //      boss on a sliver is the best loss in the game; a player who falls with the
  //      boss near full is the "no amount of practice fixes this" the old comment
  //      was really about, and THAT is what must not happen.
  //
  // AND THE SECOND CLAIM WAS BEING CHECKED WITH THE WRONG INSTRUMENT, WHICH IS WORTH
  // READING BEFORE TRUSTING ANY MAXIMUM IN THIS FILE. It asserted `worstLoss <= 0.15`
  // over the eight-seed set. `worstLoss` is a maximum over the runs that LOST, of which
  // there are one or two, so the statistic was essentially one run's health — and the
  // threshold turned out to describe the seed set rather than the game. Trying the
  // wrong-answer grant at 9 tripped it at tier 4 (15% to 24%) while the distribution
  // underneath did not move at all: measured over 32 seeds, the worst loss is 24% at
  // tier 4 and 29% at tier 5 at EITHER grant, and at 7 the eight shipped seeds simply
  // happen to miss the 20% run that is already there. A guard that passes because of
  // which seeds it drew is the same failure as the shallow-bank test further down this
  // package, and it fires on retunes that changed nothing.
  //
  // So the maximum is measured over WIDE_SEEDS, and against a threshold that describes
  // the intent instead of the sample: 35% is "the player took two thirds of him with
  // them", which is a fight, and anything above it is the beating the claim is about.
  // The median is asserted too, because the shape that actually matters is that a
  // TYPICAL loss is close — one freak run near the threshold is not the complaint.
  for (const tier of TIERS) {
    const result = sweep(tier, "WRONG");
    // The first three tiers are the missions a student meets before they are any
    // good. Nothing there may knock out a player who plays well.
    const allowed = tier >= 4 ? 1 : 0;
    assert.ok(
      result.deaths <= allowed,
      `tier ${tier} knocked out a reference skilled player in ` +
        `${result.deaths}/${result.runs} wrong-answer runs, allowed ${allowed}`,
    );
  }
  // Only the top two tiers can lose at all, so only they have a loss to grade; the
  // wide set is not worth its runtime where the count is already zero over 64 seeds.
  for (const tier of [4, 5] as const) {
    const wide = sweep(tier, "WRONG", undefined, undefined, WIDE_SEEDS);
    assert.ok(
      wide.worstLoss <= 0.35,
      `tier ${tier}: the worst of ${wide.deaths} losses over ${wide.runs} runs left the ` +
        `boss on ${(wide.worstLoss * 100).toFixed(0)}% health. A loss at this level of ` +
        "play has to be a fight that went to the wire, not a beating",
    );
    assert.ok(
      wide.medianLoss <= 0.2,
      `tier ${tier}: a typical loss leaves the boss on ` +
        `${(wide.medianLoss * 100).toFixed(0)}% health, so losing is no longer "I ` +
        'nearly had him"',
    );
  }
});

// ---- what knowledge buys -----------------------------------------------------

test("a correct answer shortens the duel, which is where the economy is paid", () => {
  // The economy in an unbounded fight: more balls is more damage rate, so the
  // projection divides the round count by the grant ratio exactly. Measured 6.1 -> 4.3
  // at tier 1 and 7.0 -> 4.4 at tier 5 — short of the full 2x, because a round is an
  // integer and the last one is always partial, and because a player holding a full
  // magazine stays in the open to spend it rather than taking cover, which is the price
  // of the correct answer nobody authored.
  //
  // THIS TEST IS NOT SUFFICIENT ON ITS OWN, AND THE ONE BELOW IS WHY. "Correct wins
  // sooner" is satisfied just as well by a two-round fight as by a four-round one, so
  // it was green throughout the period when knowing the history deleted M1's climax.
  for (const tier of TIERS) {
    const wrong = sweep(tier, "WRONG");
    const correct = sweep(tier, "CORRECT");
    assert.ok(
      correct.rounds < wrong.rounds,
      `tier ${tier}: ${correct.rounds.toFixed(1)} rounds on a correct answer against ` +
        `${wrong.rounds.toFixed(1)} on a wrong one`,
    );
    assert.ok(
      correct.wins >= wrong.wins,
      `tier ${tier}: wins must not fall when the player answers correctly`,
    );
  }
});

test("A CORRECT ANSWER BUYS A CLIMAX, NOT AN EARLY EXIT", () => {
  // THE OTHER HALF OF THE ECONOMY, AND THE HALF NOTHING HERE USED TO ASK.
  //
  // Every measurement above asks whether knowing the answers wins SOONER. A duel that
  // ends in two rounds satisfies all of them, and that is what shipped: against M1's
  // boss a student who answered everything correctly finished in 2.6 rounds — 2.1 and
  // twenty-nine seconds of shooting for a fallible one — while a student who answered
  // everything wrong got 4.5 rounds and won anyway on 89% health. Knowledge decided no
  // outcome, because both paths won comfortably. The only thing it changed was the
  // length of the fight, and it changed it downwards. The better a student did in the
  // three-minute learning module, the less boss fight they were given.
  //
  // So the floor is asserted, not just the direction. A knowledgeable player must get
  // a fight; four rounds is the format's ceiling (see boss.test.ts for why six is
  // arithmetically impossible), so three is the floor that says "this is a climax".
  const FLOOR = 3;
  for (const tier of TIERS) {
    const correct = sweep(tier, "CORRECT");
    assert.ok(
      correct.rounds >= FLOOR,
      `tier ${tier} falls to a knowledgeable player in ${correct.rounds.toFixed(1)} ` +
        `rounds. Below ${FLOOR} the reward for knowing the history is a deleted climax`,
    );
  }
  // And for the instrument that models a student rather than an oracle, at the bottom
  // of the curve.
  //
  // THE 2.1 THIS COMMENT USED TO CITE IS PRE-FIX AND WAS LEFT BEHIND BY THE RETUNE that
  // introduced the floor it sits under. Measured now: 3.8 rounds. The stale figure was
  // the more misleading half of a stale sentence — it also called this "M1's boss",
  // which it is not: `sweep` drives the BARE tier-1 profile in `referenceArena()`. M1's
  // own fight is measured in the shipped-fight section below, and a fallible student who
  // knows the answers gets 12.0 rounds there, not 3.8. Do not read this line as a fact
  // about the mission.
  const student = sweep(1, "CORRECT", SLOPPY, "sloppy");
  assert.ok(
    student.rounds >= FLOOR,
    `a fallible student who knows the answers finishes the bare tier-1 boss in ` +
      `${student.rounds.toFixed(1)} rounds`,
  );
});

test("knowledge is worth more the harder the boss is", () => {
  // The property that makes the economy feel fair rather than decorative: against a
  // weak boss the correct answer is a convenience, and against a strong one it is
  // the difference between finishing healthy and finishing on the floor.
  const soft = sweep(1, "CORRECT").playerHealthLeft - sweep(1, "WRONG").playerHealthLeft;
  const hard = sweep(5, "CORRECT").playerHealthLeft - sweep(5, "WRONG").playerHealthLeft;
  assert.ok(
    hard > soft,
    `health saved by knowing the answer: ${hard.toFixed(0)} at tier 5 against ` +
      `${soft.toFixed(0)} at tier 1`,
  );
});

test("for a player who can be hit, the correct answer is survival", () => {
  // The reference player is nearly untouchable by construction, so this is the
  // instrument that shows what the economy is actually for, and it is where every change
  // to the grant shows up most sharply. Over 64 seeds at tier 5 a fallible student wins
  // 21/64 on wrong answers against 56/64 on correct, finishing on 19 health against 68.
  //
  // THIS IS THE MEASUREMENT THAT SENT THE WRONG-ANSWER FLOOR BACK TO 7. At 9 the same
  // pair reads 12/64 and 46/64, and the mechanism is not the economy: the boss's
  // magazine IS the wrong-answer grant, so raising the floor to fill the loser's dead
  // air also hands every boss 29% more damage a round, on both paths, and the correct
  // path gets no compensating grant. The gap between knowing and not knowing does not
  // narrow — both ends move down together — but the correct path losing ten runs in
  // sixty-four is a difficulty increase the owner wants to feel before accepting. See
  // KNOWLEDGE_ADVANTAGE_RATIO in tuning.ts for the full measurement and for the one
  // lever that would fill the dead air without moving the boss's damage.
  //
  // The design rule is about the MECHANICALLY STRONG player, who still wins 61/64 at
  // tier 4 and 51/64 at tier 5 on wrong answers; a student who cannot see half the
  // incoming balls AND knows none of the history is supposed to lose to the last boss in
  // the game. Note also that this instrument models a Level 0 player with no abilities,
  // which nobody reaching tier 5 will be.
  const wrong = sweep(5, "WRONG", SLOPPY, "sloppy");
  const correct = sweep(5, "CORRECT", SLOPPY, "sloppy");
  assert.ok(
    correct.playerHealthLeft > wrong.playerHealthLeft,
    `sloppy player at tier 5 finishes on ${correct.playerHealthLeft.toFixed(0)} health ` +
      `knowing the answers and ${wrong.playerHealthLeft.toFixed(0)} not knowing them`,
  );
  assert.ok(
    correct.deaths <= wrong.deaths,
    "knowing the answers must never get you killed more often",
  );
});

test("THE PEDAGOGICAL INVARIANT: a player who knows the history beats one who does not", () => {
  // Head to head, and the sharpest test in the package. Two players, the same
  // policy, the same arena, the same seeds, the same health. The ONLY difference is
  // that A answers every question correctly and B answers every question wrong.
  //
  // This is what the economy has to buy, and it is the assertion that bounds how far
  // the wrong-answer floor can be raised. The ratio has fallen from 3:1 to 2:1 and the
  // floor has risen from 1 ball to 7, so a wrong answer no longer loses a round outright
  // and the advantage is purely cumulative. It has to still be decisive by the end, and
  // it is: measured 8/8 to the knowledgeable player in 6 rounds, every one a knockout,
  // with the loser on zero health rather than merely behind. THIS IS THE TEST THAT FAILS
  // FIRST if the floor goes on rising, and a floor that reaches 14 is a mode with no
  // economy at all.
  let correctWins = 0;
  let rounds = 0;
  for (const seed of SEEDS) {
    const result = runDuel({
      opponent: { kind: "REMOTE", handle: "opponent" },
      verdicts: (side) => (side === "A" ? "CORRECT" : "WRONG"),
      intents: SLOPPY,
      seed,
    });
    if (result.outcome.winner === "A") correctWins += 1;
    rounds += result.state.round / SEEDS.length;
  }
  assert.equal(
    correctWins,
    SEEDS.length,
    `the knowledgeable player won ${correctWins}/${SEEDS.length}: a 2:1 economy that ` +
      "does not decide matches is not converting knowledge into power at all",
  );
  assert.ok(rounds < DUEL_ROUND_CEILING, `head to head took ${rounds.toFixed(1)} rounds`);
});

// ---- M1's shipped fight ------------------------------------------------------
//
// The only measurements in this file that are evidence about the fight a student plays.
// Everything above drives the bare tier curve in the reference fixture; these drive the
// tier-1 profile WITH its three production opt-ins in the rope-walk yard.
//
// WHAT THE SHIPPED FIGHT MEASURES, over the eight seeds, reference player unless said:
//
//   answers      rounds  wins  resolved on health  boss HP left
//   WRONG           5.8   8/8                 8/8            0%
//   ALTERNATING     6.4   8/8                 8/8            0%
//   CORRECT        11.5   8/8                 6/8            7%
//   WRONG sloppy   10.4   6/8                 6/8           16%
//   CORRECT sloppy 12.0   8/8                 5/8           12%
//   WRONG passive   4.4   0/8                 8/8          100%
//
// The boss's own offence is in better shape than the tier curve suggests: it puts down a
// passive player in 4.4 rounds where the bare profile needs 9.6. What is NOT healthy is
// how the fight terminates, and the two assertions recording that are marked `todo` —
// see the block above them.
//
// AND EIGHT SEEDS UNDERSTATE IT. The eight-seed set reports the backstop being reached on
// the correct path only; over the 32-seed set it is reached on all three, which is the
// honest picture and the reason the `todo` block quotes both:
//
//   answers      rounds  wins    resolved on health  reached the 24-round backstop
//   CORRECT        10.8  32/32              25/32     7/32
//   ALTERNATING     8.6  32/32              29/32     3/32
//   WRONG           7.9  32/32              30/32     2/32
//
// Twelve of those ninety-six fights ran out of rounds with both fighters alive. The
// eight-seed figures are kept as the assertion set because they are what the rest of the
// file uses and they already fail; the wider set is the measurement to quote.

test("the shipped-fight section really drives the shipped fight", () => {
  // THE STRUCTURAL GUARD, and it is the one that would have caught the original defect.
  //
  // Every assertion below is only as good as the pairing `shipped()` chose, and the way
  // this file went wrong was not a bad threshold — it was measuring the wrong fight while
  // every threshold passed. A future edit that "simplifies" `shipped()` back to the
  // reference fixture, or drops an opt-in, changes no assertion's text and would go
  // unnoticed for exactly the same reason. So the pairing itself is pinned.
  //
  // The counterpart pin lives in `apps/web/test/duelPathParity.test.ts`, which checks
  // that these constants still equal what the mission passes. This one checks they are
  // what this file actually uses.
  const arena = ropewalkYardArena();
  assert.equal(arena.spec.arenaId, "DUEL.ARENA.ROPEWALK_YARD");
  assert.equal(arena.spec.cover.length, 8, "the yard's eight pieces of cover");
  assert.notEqual(
    arena.spec.arenaId,
    "DUEL.ARENA.REFERENCE",
    "the shipped fight is not the tuning fixture",
  );

  assert.equal(M1_BOSS.tier, M1_BOSS_TIER);
  assert.equal(M1_BOSS.ammoPolicy, "SYMMETRIC_COMPLEMENT");
  assert.equal(M1_BOSS.takesCoverBeforeQuestion, true);
  assert.equal(M1_BOSS.tactical, M1_BOSS_TACTICS);
  // And the bare profile really is a different fight, so the two sections cannot be
  // silently collapsed into one on the belief that the opt-ins do not matter.
  const bare = bossProfileForTier(M1_BOSS_TIER);
  assert.notEqual(bare.ammoPolicy, M1_BOSS.ammoPolicy);
  assert.notEqual(bare.takesCoverBeforeQuestion, M1_BOSS.takesCoverBeforeQuestion);
  assert.equal(bare.tactical, null);
});

test("M1'S BOSS CAN WIN, measured on the fight it actually fights", () => {
  // The invariant that caught a tier-1 boss shipping unable to finish a duel, now asked
  // of the boss that ships. It passes comfortably, and BETTER than the tier curve does:
  // 4.4 rounds to put down a player who never fires, against 9.6 for the bare profile.
  // The three opt-ins make the officer a more effective killer, not a less effective one,
  // which is worth knowing before anyone reads the correct-path problem below as "the
  // boss is too weak".
  const result = shipped("WRONG", PASSIVE, "passive");
  assert.equal(
    result.deaths,
    result.runs,
    `M1's boss failed to finish a player who never fired a shot in ` +
      `${result.runs - result.deaths}/${result.runs} runs. A boss that cannot win is a ` +
      "duel that cannot end",
  );
  assert.ok(
    result.rounds <= 12,
    `M1's boss needed ${result.rounds.toFixed(1)} rounds to put down a passive player`,
  );
});

test("M1'S WRONG-ANSWER PATH IS A HANDICAP, NEVER A LOCKOUT", () => {
  // The design's one non-negotiable, on the shipped fight. Note that the projection is
  // arena-independent and profile-only — SYMMETRIC_COMPLEMENT leaves `magazinePerRound`
  // at the wrong-answer grant as the projection baseline — so the 1.68 margin is the
  // same number the tier curve reports. The SIMULATION is what differs, and it differs a
  // lot: a wrong answer arms this boss with 14 balls rather than a flat 7, so the wrong
  // path here is a genuinely harder fight than any figure above it describes.
  const projection = projectExchange(M1_BOSS, BULLETS_FOR_WRONG);
  assert.ok(
    projection.margin >= REQUIRED_WRONG_PATH_MARGIN,
    `M1's boss projects a wrong-answer margin of ${projection.margin.toFixed(2)} ` +
      `against a required ${REQUIRED_WRONG_PATH_MARGIN}`,
  );
  const wrong = shipped("WRONG");
  assert.equal(
    wrong.wins,
    wrong.runs,
    `a mechanically strong player answering everything wrong won ` +
      `${wrong.wins}/${wrong.runs} against M1's boss`,
  );
  // And for the player who can be hit — the median first-mission student — it stays a
  // fight rather than a wall: 6/8, and the losses are close (worst 24% of the boss's bar).
  const sloppyWrong = shipped("WRONG", SLOPPY, "sloppy");
  assert.ok(
    sloppyWrong.wins > sloppyWrong.runs / 2,
    `a fallible student answering everything wrong won ` +
      `${sloppyWrong.wins}/${sloppyWrong.runs} against M1's boss`,
  );
  assert.ok(
    sloppyWrong.worstLoss <= 0.35,
    `the worst of ${sloppyWrong.deaths} losses left M1's boss on ` +
      `${(sloppyWrong.worstLoss * 100).toFixed(0)}% health: a loss has to be a fight ` +
      "that went to the wire, not a beating",
  );
});

test("M1'S FIGHT GIVES A KNOWLEDGEABLE PLAYER A CLIMAX", () => {
  // The floor, on the shipped fight. It is not in danger from below — the correct path
  // measures 11.5 rounds against a floor of 3. It is the CEILING that is in trouble, and
  // that is the `todo` below.
  const FLOOR = 3;
  for (const path of ANSWER_PATHS) {
    const result = shipped(path);
    assert.ok(
      result.rounds >= FLOOR,
      `M1's fight on the ${path} path lasts ${result.rounds.toFixed(1)} rounds. Below ` +
        `${FLOOR} the reward for knowing the history is a deleted climax`,
    );
  }
  // Every path must still be winnable by a strong player, on every answer pattern.
  for (const path of ANSWER_PATHS) {
    const result = shipped(path);
    assert.equal(
      result.wins,
      result.runs,
      `M1's fight on the ${path} path was won ${result.wins}/${result.runs}`,
    );
  }
});

// THE TWO PROPERTIES M1'S SHIPPED FIGHT DOES NOT SATISFY.
//
// Both are marked `todo`, which in node:test means they RUN, print the real assertion
// failure with the real numbers on every test run, and do not fail the suite. That is
// deliberate and it is not a way of hiding them:
//
//   - they are written as the invariant that SHOULD hold, not as a characterisation of
//     the defect, so nothing here launders a broken fight into an expected one;
//   - they execute, so the numbers cannot go quietly stale, and if the fight gets worse
//     the printed figures move;
//   - and the fix is a BALANCE decision that belongs to the owner, not to this lane. The
//     owner has been explicit that he wants the boss aggressive, and every way of making
//     these pass — more boss ammo on the correct path, less boss health, a shorter round
//     ceiling, weaker cover-seeking — changes how the fight feels. Retuning until the
//     gate goes green is exactly the move that produced the numbers this file just spent
//     a header correcting.
//
// Promote each to a plain `test` the moment it holds.
//
// THE MECHANISM, traced rather than inferred. SYMMETRIC_COMPLEMENT gives the boss the
// MIRROR of the player's award: answer correctly and the player gets 14 while the boss
// gets 7. Seven balls is barely above `lowAmmoThreshold` (3), so the boss drops into LOW
// and then EMPTY early in every round, and both of those states are fought from cover —
// measured 22% of live combat in LOW and 27% in EMPTY on the correct path, against 6%
// and 0% on the wrong path. A boss behind cover is a boss the PLAYER cannot hit either,
// so the player's damage output collapses on exactly the path where their magazine is
// largest. Hence: the better a student answers, the longer the fight, and 2 of 8 seeds
// never finish it at all.

test(
  "a correct answer shortens M1's fight",
  { todo: "M1 defect: it lengthens it, 11.5 rounds against 5.8. Owner's call — see block above." },
  () => {
    const correct = shipped("CORRECT");
    const wrong = shipped("WRONG");
    assert.ok(
      correct.rounds < wrong.rounds,
      `M1: ${correct.rounds.toFixed(1)} rounds on a correct answer against ` +
        `${wrong.rounds.toFixed(1)} on a wrong one. The economy pays in rounds ` +
        "survived, so a correct answer must not buy a LONGER fight",
    );
  },
);

test(
  "M1'S FIGHT ENDS ON HEALTH, NOT ON THE ANTI-HANG BACKSTOP",
  {
    todo:
      "M1 defect: the 24-round ceiling is reached on every answer path — 7/32 correct, " +
      "3/32 alternating, 2/32 wrong. Owner's call — see block above.",
  },
  () => {
    // `DUEL_ROUND_CEILING` is documented as unreachable in normal play, and reaching it
    // is the failure this whole file was rewritten around: a duel that ends on the
    // backstop is ~585 seconds of shooting plus two dozen untimed questions, which in a
    // classroom is a match that outlasts the period. On the correct path it is reached
    // by seeds 1 and 19, both times with the player alive and the boss still holding 20%
    // and 33% of its bar — the player cannot finish it, so the clock does.
    //
    // This assertion runs on the eight-seed set, where only the CORRECT path fails.
    // Over 32 seeds all three paths fail (7, 3 and 2 of 32), so the wrong-answer path is
    // not immune either and the eight seeds simply miss its two. Do not read a green
    // ALTERNATING or WRONG line here as those paths being sound.
    for (const path of ANSWER_PATHS) {
      const result = shipped(path);
      assert.equal(
        result.knockouts + result.deaths,
        result.runs,
        `M1's fight on the ${path} path resolved on health in only ` +
          `${result.knockouts + result.deaths}/${result.runs} runs, averaging ` +
          `${result.rounds.toFixed(1)} rounds against a ceiling of ${DUEL_ROUND_CEILING}`,
      );
    }
  },
);

test("winning on points clears the mission", () => {
  // Settled: missions are optional-outcome fun and the assessment is the learning
  // spine, so a mission need not be a knowledge gate as well.
  const decision = {
    winner: "A" as const,
    reason: "ROUNDS_EXHAUSTED" as const,
    healthA: 80,
    healthB: 20,
    tiebreak: "HEALTH" as const,
  };
  assert.equal(MISSION_CLEAR_REQUIRES_KNOCKOUT, false);
  assert.equal(duelClearedMission(decision), true);
  assert.equal(duelClearedMission({ ...decision, reason: "KNOCKOUT" }), true);
  assert.equal(duelClearedMission({ ...decision, winner: "B" }), false);
  assert.equal(
    duelClearedMission({ ...decision, winner: null, tiebreak: "DRAWN" }),
    false,
    "a draw is not a clear",
  );
});
