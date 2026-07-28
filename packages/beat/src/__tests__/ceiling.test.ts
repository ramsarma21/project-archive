// Difficulty, as a measurement rather than an intention.
//
// M1's beat is a story moment on mission one: it must be VERY doable. So the
// claims here are the opposite of a skill ceiling — that a player who is paying
// attention passes comfortably, that missing one flare is never fatal, and that
// the stealth coupling still holds so a fumble is heard even though it does not
// end the run.

import assert from "node:assert/strict";
import test from "node:test";
import { STEALTH_TUNING } from "../engine.js";
import { deriveSchedule } from "../schedule.js";
import { m1NailStanceBeat } from "../m1NailStance.js";
import { playBeat } from "./harness.js";

const SPEC = m1NailStanceBeat();
const SEEDS = [3, 17, 88, 404, 2025];
const TARGETS = SPEC.reaction.targetCount;

/** Total audibility a run would deliver to a listener standing at the tree. */
function attentionCost(seed: number, dropped: readonly number[]): number {
  const played = playBeat(SPEC, seed, { dropped });
  let total = 0;
  for (const event of played.noise) {
    if (event.intensity < STEALTH_TUNING.minAudibleNoise) continue;
    total += STEALTH_TUNING.noiseSuspicionImpulse[event.kind] * event.intensity;
  }
  return total;
}

test("striking every flare posts the sheet SILENT and is heard by nobody", () => {
  for (const seed of SEEDS) {
    const played = playBeat(SPEC, seed);
    assert.equal(played.outcome.grade, "SILENT", `seed ${seed}`);
    assert.equal(played.outcome.posted, true);
    assert.equal(attentionCost(seed, []), 0, `seed ${seed}: a clean run was heard`);
  }
});

test("the reaction window is generous — well over a second on every flare", () => {
  // A trained reaction is ~250ms; the window is more than five times that, which
  // is the whole reason this is doable. Pinned so a later tightening is a choice.
  assert.ok(
    SPEC.reaction.windowTicks >= 72,
    `the window is ${SPEC.reaction.windowTicks} ticks (${(SPEC.reaction.windowTicks / 60).toFixed(2)}s); a reaction test needs a comfortable one`,
  );
});

test("missing one flare is never fatal — the sheet goes up crooked", () => {
  for (const seed of SEEDS) {
    const played = playBeat(SPEC, seed, { dropped: [2] });
    assert.equal(played.outcome.score.slips, 1, `seed ${seed}`);
    assert.equal(played.outcome.grade, "RAGGED", `seed ${seed}`);
    assert.equal(played.outcome.posted, true, `seed ${seed}: one miss tore the sheet`);
  }
});

test("a player can miss almost half the flares and still post", () => {
  // "Very doable" as a boundary: even a distracted first-timer who connects with
  // more than half the flares gets the handbill up. Only near-total failure tears.
  const halfMinusOne = Math.floor(TARGETS / 2) - 1; // miss this many, hit the rest
  const dropped = Array.from({ length: halfMinusOne }, (_, index) => index);
  for (const seed of SEEDS) {
    const played = playBeat(SPEC, seed, { dropped });
    assert.equal(played.outcome.posted, true, `seed ${seed}: missing ${halfMinusOne} tore it`);
  }
});

test("only missing most of the act tears the sheet", () => {
  // TORN is a player who did not play, not a player who slipped: nearly every
  // flare has to go by unstruck.
  const dropMost = Array.from({ length: TARGETS - 1 }, (_, index) => index);
  for (const seed of SEEDS) {
    const played = playBeat(SPEC, seed, { dropped: dropMost });
    assert.equal(played.outcome.grade, "TORN", `seed ${seed}`);
    assert.equal(played.outcome.posted, false);
  }
});

test("a fumble is heard but cannot get the player caught by itself", () => {
  // The stealth coupling, intact: a missed flare is loud, and the field caps what
  // noise alone can build below certainty, so a botched act brings a watcher over
  // and hands the rest to his eyes.
  for (const seed of SEEDS) {
    const missAll = Array.from({ length: TARGETS }, (_, index) => index);
    const mashed = playBeat(SPEC, seed, { dropped: missAll });
    assert.ok(
      mashed.outcome.loudestIntensity >= STEALTH_TUNING.minAudibleNoise,
      `seed ${seed}: dropping every flare was silent`,
    );
    assert.ok(mashed.outcome.loudestIntensity < 1);
    assert.ok(
      STEALTH_TUNING.noiseSuspicionCeiling < STEALTH_TUNING.thresholds.alerted,
      "the field would let a botched act complete a detection by itself",
    );
  }
});

test("getting fewer flares wrong is strictly quieter", () => {
  for (const seed of SEEDS) {
    const clean = attentionCost(seed, []);
    const one = attentionCost(seed, [1]);
    const two = attentionCost(seed, [1, 3]);
    assert.equal(clean, 0, `seed ${seed}: a clean run made a sound`);
    assert.ok(one > clean, `seed ${seed}: a miss cost no attention`);
    assert.ok(two > one, `seed ${seed}: two misses were no louder than one`);
  }
});

test("clicking the wrong cell is a stray, and it is louder than a clean strike", () => {
  const seed = 17;
  const played = playBeat(SPEC, seed, { wrongCell: [2] });
  assert.ok(played.outcome.score.strays >= 1);
  assert.ok(
    played.outcome.loudestIntensity >= STEALTH_TUNING.minAudibleNoise,
    "a stray went unheard",
  );
});

test("every seed's beat costs the same worst case, so the budget is a price", () => {
  // The span varies a little with the seeded gap jitter, but the reserved worst
  // case is fixed, which is what the pacing budget rests on.
  const worst = deriveSchedule(SPEC.reaction, 0);
  for (let seed = 0; seed < 200; seed++) {
    const schedule = deriveSchedule(SPEC.reaction, seed);
    assert.equal(schedule.targets.length, TARGETS, `seed ${seed} drew a different count`);
    assert.ok(schedule.spanTicks > 0);
    assert.ok(schedule.spanTicks <= worst.spanTicks + SPEC.reaction.gapJitterTicks * TARGETS);
  }
});
