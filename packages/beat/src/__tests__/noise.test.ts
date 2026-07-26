// The coupling. These are the tests that decide whether this is a pillar or a
// bolt-on, so they measure against the stealth field's own constants and its own
// audibility function rather than against numbers restated here.

import assert from "node:assert/strict";
import test from "node:test";
import { PARKOUR_TUNING, STEALTH_TUNING, noiseAudibility, noiseImplicatesPlayer } from "../engine.js";
import {
  noiseBudget,
  strikeAudibilityAt,
  strikeIntensity,
  strikeIsInaudible,
  strikeNoiseEvent,
  strikeRadiusM,
} from "../noise.js";
import { DRIVE_FASTENER } from "../verbs.js";
import { M1_NAIL_TARGET, m1NailStanceBeat } from "../m1NailStance.js";
import type { BeatJudgement } from "../judge.js";

const SPEC = m1NailStanceBeat();
const LADDER: BeatJudgement[] = ["FLUSH", "TRUE", "GLANCING", "SLIP", "STRAY"];

test("a centred stroke is inaudible to the field from any distance", () => {
  // The ceiling of this mechanic is that a perfect beat makes no sound the world
  // can hear. Audibility peaks at the source intensity, so a stroke quieter than
  // the field's floor is silent everywhere — including to somebody standing in
  // the tree with you.
  assert.ok(strikeIsInaudible("FLUSH", DRIVE_FASTENER));
  assert.equal(
    strikeAudibilityAt("FLUSH", DRIVE_FASTENER, M1_NAIL_TARGET, M1_NAIL_TARGET.x, M1_NAIL_TARGET.z),
    strikeIntensity("FLUSH", DRIVE_FASTENER),
  );
  assert.ok(
    strikeIntensity("FLUSH", DRIVE_FASTENER) < STEALTH_TUNING.minAudibleNoise,
    "a FLUSH stroke is loud enough for the field to notice",
  );
});

test("every other judgement is audible, and loudness rises with error", () => {
  let previous = -1;
  for (const judgement of LADDER) {
    const intensity = strikeIntensity(judgement, DRIVE_FASTENER);
    assert.ok(
      intensity > previous,
      `${judgement} is not louder than the judgement above it`,
    );
    previous = intensity;
    if (judgement !== "FLUSH") {
      assert.equal(
        strikeIsInaudible(judgement, DRIVE_FASTENER),
        false,
        `${judgement} is silent, so that grade of mistake costs nothing`,
      );
    }
  }
});

test("beat noise implicates the player rather than redirecting attention", () => {
  // The difference between this and a thrown bottle. A diversion points a cone
  // away from you; a hammer stroke points it at you. If this ever flipped, the
  // failure state of the mechanic would HELP the player.
  const event = strikeNoiseEvent("STRAY", DRIVE_FASTENER, M1_NAIL_TARGET);
  assert.ok(noiseImplicatesPlayer(event.kind));
  assert.ok(STEALTH_TUNING.noiseSuspicionImpulse[event.kind] > 0);
  assert.equal(event.x, M1_NAIL_TARGET.x);
  assert.equal(event.z, M1_NAIL_TARGET.z);
});

test("radius comes off the movement layer's scale, not a second one", () => {
  for (const judgement of LADDER) {
    assert.equal(
      strikeRadiusM(judgement, DRIVE_FASTENER),
      strikeIntensity(judgement, DRIVE_FASTENER) *
        PARKOUR_TUNING.noiseRadiusPerIntensityM,
    );
  }
});

test("the emitted event agrees with the engine's own audibility function", () => {
  // strikeAudibilityAt is a convenience; the field will use noiseAudibility on
  // the event itself. Those two must not be able to disagree.
  const event = strikeNoiseEvent("GLANCING", DRIVE_FASTENER, M1_NAIL_TARGET);
  for (let metres = 0; metres <= 10; metres += 0.5) {
    assert.equal(
      noiseAudibility(event, M1_NAIL_TARGET.x + metres, M1_NAIL_TARGET.z),
      strikeAudibilityAt(
        "GLANCING",
        DRIVE_FASTENER,
        M1_NAIL_TARGET,
        M1_NAIL_TARGET.x + metres,
        M1_NAIL_TARGET.z,
      ),
    );
  }
});

test("noise can bring a watcher over and can never detect on its own", () => {
  // Both halves matter. Without the first, imprecision costs nothing. Without
  // the second, one mistimed stroke would end a three-minute run outright, which
  // is the wrong severity for a mechanic being learned.
  assert.ok(
    STEALTH_TUNING.noiseSuspicionCeiling < STEALTH_TUNING.thresholds.alerted,
    "the field would let noise alone complete a detection",
  );
  const budget = noiseBudget(DRIVE_FASTENER);
  const stray = budget.find((row) => row.judgement === "STRAY")!;
  assert.ok(
    stray.peakSuspicion > STEALTH_TUNING.thresholds.curious,
    `a swing at nothing peaks at ${stray.peakSuspicion} suspicion, under the ` +
      `${STEALTH_TUNING.thresholds.curious} needed to make anybody look up`,
  );
  assert.ok(
    stray.peakSuspicion < STEALTH_TUNING.thresholds.alerted,
    "a single stray would detect the player outright",
  );
  const flush = budget.find((row) => row.judgement === "FLUSH")!;
  assert.equal(flush.peakSuspicion, 0);
  assert.equal(flush.inaudible, true);
});

test("the M1 constable hears a botched stroke and not a clean one", () => {
  // CONSTABLE_ORANGE walks Orange Street from x=86 to x=63 at z between +0.6 and
  // -0.6, which takes him almost directly under the elm: his closest approach to
  // the nail face is about a third of a metre in plan. Walked here as a straight
  // line at the authored waypoints rather than asserted, so the claim is a
  // measurement over the leg the player is actually exposed to.
  const legFrom = { x: 86, z: 0.6 };
  const legTo = { x: 72, z: -0.6 };
  const peak = (judgement: BeatJudgement): number => {
    let loudest = 0;
    for (let step = 0; step <= 200; step++) {
      const t = step / 200;
      const x = legFrom.x + (legTo.x - legFrom.x) * t;
      const z = legFrom.z + (legTo.z - legFrom.z) * t;
      const heard = strikeAudibilityAt(judgement, DRIVE_FASTENER, M1_NAIL_TARGET, x, z);
      if (heard > loudest) loudest = heard;
    }
    return loudest;
  };

  // He passes about half a metre from the nail face in plan, which is inside a
  // centred stroke's 0.56m reach — and still below the floor at which the field
  // registers a noise at all, which is the guarantee that matters.
  assert.ok(
    peak("FLUSH") < STEALTH_TUNING.minAudibleNoise,
    `a centred stroke registered at ${peak("FLUSH")} on the constable`,
  );
  assert.ok(
    peak("STRAY") > STEALTH_TUNING.thresholds.curious,
    "a swing at nothing did not even make the constable look up",
  );
  assert.ok(
    peak("SLIP") > STEALTH_TUNING.minAudibleNoise,
    "a dropped stroke was inaudible from the street directly below",
  );
  // Two botched strokes take him past the investigate threshold, which is the
  // line between "he glances up" and "he walks to the base of the tree".
  assert.ok(
    peak("STRAY") + peak("SLIP") > STEALTH_TUNING.thresholds.investigating,
    "two botched strokes do not add up to an investigation",
  );
});

test("a botched stroke does not carry across the whole square", () => {
  // The other direction. If the loudest mistake reached every watcher in the
  // level, the beat would stop being a local decision about one patrol and
  // become a global fail switch — and the player's choice of when to start would
  // stop mattering.
  assert.ok(
    strikeRadiusM("STRAY", DRIVE_FASTENER) < STEALTH_TUNING.callRadiusM,
    "the loudest stroke carries further than a shout, which cannot be right",
  );
  assert.ok(
    strikeRadiusM("STRAY", DRIVE_FASTENER) < 12,
    "the loudest stroke reaches beyond the corner the beat happens in",
  );
});

test("a quieter verb scales the whole ladder together", () => {
  const whisper = { ...DRIVE_FASTENER, id: "test.quiet", noiseScale: 0.5 };
  for (const judgement of LADDER) {
    assert.equal(
      strikeIntensity(judgement, whisper),
      strikeIntensity(judgement, DRIVE_FASTENER) * 0.5,
    );
  }
  // And the relationship between grades survives it, so a quiet verb is quieter
  // rather than flatter.
  assert.ok(
    strikeIntensity("STRAY", whisper) > strikeIntensity("GLANCING", whisper),
  );
});

test("the shipped spec puts its noise at the work, not at the feet", () => {
  assert.equal(SPEC.noiseAt, undefined);
  const event = strikeNoiseEvent("SLIP", SPEC.verb, SPEC.target);
  assert.equal(event.y, SPEC.target.y);
});
