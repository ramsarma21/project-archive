import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertBossWinnableOnWrongAnswers,
  bossFighterParams,
  bossProfileForTier,
  BOSS_TIERS,
  correctPathRoundCeiling,
  knowledgeAdvantage,
  marginImpliedByCorrectPathRounds,
  projectExchange,
  validateBossProfile,
} from "../boss.js";
import { referenceArena } from "../arena.js";
import { createDuel } from "../machine.js";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  KNOWLEDGE_ADVANTAGE_RATIO,
  REQUIRED_WRONG_PATH_MARGIN,
} from "../tuning.js";
import { questionSet } from "./harness.js";

test("difficulty rises monotonically across every offensive and evasive dial", () => {
  // HEALTH IS NOT IN THIS LIST, AND THE TEST'S OWN NAME IS THE REASON: health is
  // neither offensive nor evasive. It is duration, and duration is now a constant of
  // the format rather than a difficulty axis — see the test below.
  const profiles = BOSS_TIERS.map((tier) => bossProfileForTier(tier));
  for (let index = 1; index < profiles.length; index++) {
    const previous = profiles[index - 1]!;
    const current = profiles[index]!;
    assert.ok(current.shotDamage > previous.shotDamage, "damage rises");
    assert.ok(current.fireIntervalTicks <= previous.fireIntervalTicks, "rate of fire rises");
    assert.ok(current.magazinePerRound >= previous.magazinePerRound, "magazine rises");
    assert.ok(current.aimErrorRad < previous.aimErrorRad, "aim tightens");
    assert.ok(current.leadFraction > previous.leadFraction, "prediction improves");
    assert.ok(current.dodgeChance > previous.dodgeChance, "evasion improves");
    assert.ok(current.dodgeReactionTicks < previous.dodgeReactionTicks, "reactions tighten");
    assert.ok(current.moveSpeedScale > previous.moveSpeedScale, "mobility rises");
    assert.ok(current.maxHealth >= previous.maxHealth, "health never falls with tier");
  }
});

test("KNOWING THE ANSWERS BUYS A BOSS FIGHT, NOT THE END OF ONE", () => {
  // THE DEFECT THIS REPLACES, AND WHY THE TEST IT REPLACES WAS THE CAUSE.
  //
  // The old test asserted that tier 5's health was at least 1.5x tier 1's, to prove
  // "health now carries the tier curve, because it is only duration". It was true,
  // and it silently capped the bottom of the curve: tier 5's health is bounded above
  // by the winnability gate, so demanding a 1.5x spread bounds tier 1's health at two
  // thirds of that bound — and two thirds of it is a boss that falls in two rounds.
  // M1 shipped that way. A student who answered every question correctly got 2.6
  // rounds and 29 seconds of shooting; a student who answered every question wrong got
  // 4.5 rounds and won anyway on 89% health. Knowledge bought no outcome at all,
  // because both paths won easily. It bought only a shorter climax, which is the
  // reward for learning being less game.
  //
  // So the invariant is inverted with it. What has to be true is not that health
  // spreads across the tiers, but that the correct-answer path is a FIGHT at every
  // tier — including the first one a thirteen-year-old ever plays.
  //
  // Four is the ceiling, not a preference: correct-path rounds are
  // `roundsForBossToWin / (ratio x margin)`, the ratio is 2, the margin may not go below
  // REQUIRED_WRONG_PATH_MARGIN, and `roundsForBossToWin` is capped by the boss having to
  // be able to finish a passive player. Six rounds would require a wrong-answer margin at
  // or below 1.0, which is a lockout. The wrong-answer grant cancels out of the whole
  // expression, so none of these numbers moved while it was briefly 9 — see
  // KNOWLEDGE_ADVANTAGE_RATIO.
  for (const tier of BOSS_TIERS) {
    const profile = bossProfileForTier(tier);
    const correct = projectExchange(profile, BULLETS_FOR_CORRECT);
    assert.ok(
      correct.roundsForPlayerToWin >= 3,
      `tier ${tier} falls to a knowledgeable player in ` +
        `${correct.roundsForPlayerToWin.toFixed(2)} projected rounds. Knowledge is ` +
        "supposed to be the reward; below three rounds it deletes the climax instead",
    );
    const ceiling = correctPathRoundCeiling(profile);
    assert.ok(
      correct.roundsForPlayerToWin <= ceiling,
      `tier ${tier} projects ${correct.roundsForPlayerToWin.toFixed(2)} rounds on the ` +
        `correct path against a ceiling of ${ceiling.toFixed(2)}, which cannot be paid ` +
        "for: the wrong path is the grant ratio times that, and " +
        "REQUIRED_WRONG_PATH_MARGIN puts a ceiling on the wrong path",
    );
  }
});

test("SIX ROUNDS IS ARITHMETICALLY IMPOSSIBLE, so nobody has to rediscover it", () => {
  // The constraint recorded as an assertion, because prose in a comment is what the
  // last four hours have been about. The owner's instinct was a four-to-six-round
  // climax; four is reachable and six cannot be bought at any price, and the reason is
  // not a tuning judgement but the gate the owner set at 1.15.
  //
  // If a future change makes six reachable, this test fails and the message says which
  // of the two escapes was taken — a weaker boss (which has to keep finishing a passive
  // player) or a bigger player bar (which has to keep a hit at a tenth of it).
  for (const tier of BOSS_TIERS) {
    const profile = bossProfileForTier(tier);
    const ceiling = correctPathRoundCeiling(profile);
    assert.ok(
      ceiling < 6,
      `tier ${tier} can now support a ${ceiling.toFixed(2)}-round correct-answer fight. ` +
        "Six used to be impossible; if that changed, either the boss got weaker or the " +
        "player's bar got bigger, and both are load-bearing elsewhere",
    );
    const impliedBySix = marginImpliedByCorrectPathRounds(profile, 6);
    assert.ok(
      impliedBySix < 1,
      `a six-round correct-answer fight at tier ${tier} implies a wrong-answer margin ` +
        `of ${impliedBySix.toFixed(2)}, which is supposed to be below 1.0 — a boss the ` +
        "wrong-answer player cannot beat",
    );
    // FOUR IS THE NUMBER, AND IT IS A MEASURED FOUR RATHER THAN A PROJECTED ONE — a
    // distinction the ceiling makes unavoidable. The projected ceiling is 3.98 at tier
    // 5, so four PROJECTED rounds is already past the wall at the top of the curve;
    // what the design ships is 3.2 projected, which is 4.3 measured, because a round is
    // an integer and the last one is partial. If this band ever moves, the four-round
    // target moved with it and everything above needs rereading.
    assert.ok(
      ceiling >= 3.9 && ceiling <= 4.8,
      `tier ${tier}'s correct-answer ceiling is ${ceiling.toFixed(2)} rounds, outside ` +
        "the 3.9-4.8 band the four-round target was derived against",
    );
  }
});

test("duration is a constant of the format, and lethality is the tier curve", () => {
  // The positive form of the change above. Every tier is the same length of fight to
  // within a few percent, and what a higher tier costs you is health rather than
  // time. If a future retune wants a duration curve back, this is the test to argue
  // with — but note that the player's own accuracy falls from 51% to 41% across the
  // tiers, so flat health already produces a marginally LONGER fight at the top.
  const rounds = BOSS_TIERS.map(
    (tier) => projectExchange(bossProfileForTier(tier), BULLETS_FOR_CORRECT).roundsForPlayerToWin,
  );
  const spread = Math.max(...rounds) / Math.min(...rounds);
  assert.ok(spread <= 1.1, `correct-path length varies ${spread.toFixed(2)}x across the tiers`);
  const slack = BOSS_TIERS.map(
    (tier) => projectExchange(bossProfileForTier(tier), BULLETS_FOR_WRONG).playerHitsOfSlack,
  );
  for (let index = 1; index < slack.length; index++) {
    assert.ok(
      slack[index]! < slack[index - 1]!,
      "a higher tier must cost the wrong-answer player more health, since it no " +
        "longer costs them more time",
    );
  }
});

test("every shipped tier leaves the wrong-answer path open", () => {
  for (const tier of BOSS_TIERS) {
    const profile = bossProfileForTier(tier);
    const projection = projectExchange(profile, BULLETS_FOR_WRONG);
    assert.ok(
      projection.margin >= REQUIRED_WRONG_PATH_MARGIN,
      `tier ${tier} margin ${projection.margin.toFixed(2)}: a wrong answer is a ` +
        "handicap, never a lockout",
    );
    assert.deepEqual(validateBossProfile(profile), []);
    assert.doesNotThrow(() => assertBossWinnableOnWrongAnswers(profile));
  }
});

test("the wrong-answer margin narrows as the tier rises, and never inverts", () => {
  const margins = BOSS_TIERS.map(
    (tier) => projectExchange(bossProfileForTier(tier), BULLETS_FOR_WRONG).margin,
  );
  for (let index = 1; index < margins.length; index++) {
    assert.ok(
      margins[index]! < margins[index - 1]!,
      "a higher tier must be a tighter race, not a longer one",
    );
  }
  assert.ok(margins[margins.length - 1]! >= REQUIRED_WRONG_PATH_MARGIN);
});

test("answering correctly shortens the duel by exactly the grant ratio", () => {
  for (const tier of BOSS_TIERS) {
    const profile = bossProfileForTier(tier);
    const advantage = knowledgeAdvantage(profile);
    assert.ok(advantage.roundsSaved > 0, `tier ${tier} saves no rounds`);
    // Rounds-to-kill is inversely proportional to bullets, so the grant ratio is the
    // speed-up exactly — 2 at the shipped 14 and 7, as it was 1.56 at 14 and 9. The
    // assertion is against the ratio rather than a literal, so retuning the economy
    // cannot silently change what knowledge is worth: if this drifts, the economy has
    // grown a second input and the drift is the thing to explain.
    const speedUp = advantage.wrongPathRounds / advantage.correctPathRounds;
    assert.ok(
      Math.abs(speedUp - KNOWLEDGE_ADVANTAGE_RATIO) < 1e-9,
      `tier ${tier}: knowing the answer is worth ${speedUp.toFixed(2)}x, expected ` +
        `${KNOWLEDGE_ADVANTAGE_RATIO}x`,
    );
  }
});

test("a boss that out-paces a wrong-answer player cannot reach a live duel", () => {
  const arena = referenceArena();
  assert.throws(
    () =>
      createDuel({
        duelId: "TEST",
        seed: 1,
        world: arena.world,
        opponent: {
          kind: "BOSS",
          profile: { ...bossProfileForTier(1), maxHealth: 5000 },
        },
        questions: questionSet(),
      }),
    /handicap, never a lockout/,
  );
});

test("a duel needs one authored question, not one per round", () => {
  // It cannot need one per round: there is no round count to compare against.
  const arena = referenceArena();
  assert.doesNotThrow(() =>
    createDuel({
      duelId: "TEST",
      seed: 1,
      world: arena.world,
      opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
      questions: questionSet(1),
    }),
  );
  assert.throws(
    () =>
      createDuel({
        duelId: "TEST",
        seed: 1,
        world: arena.world,
        opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
        questions: [],
      }),
    /at least one authored question/,
  );
});

test("a boss profile projects onto ordinary fighter parameters", () => {
  const profile = bossProfileForTier(4);
  const params = bossFighterParams(profile);
  assert.equal(params.maxHealth, profile.maxHealth);
  assert.equal(params.shotDamage, profile.shotDamage);
  assert.equal(params.moveSpeedScale, profile.moveSpeedScale);
  assert.deepEqual(params.loadout, [], "PvE bosses hold no abilities yet");
  assert.equal(
    params.aimAssist,
    null,
    "a boss's accuracy is authored as aimErrorRad; an assist would snap it away " +
      "and flatten the whole difficulty curve",
  );
});

test("a validator catches nonsense before a designer ships it", () => {
  const problems = validateBossProfile({
    ...bossProfileForTier(1),
    shotDamage: 0,
    magazinePerRound: 0,
    leadFraction: 1.4,
    dodgeChance: -0.2,
    aimErrorRad: -1,
  });
  assert.equal(problems.length, 5);
});
