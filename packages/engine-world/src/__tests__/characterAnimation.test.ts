import test from "node:test";
import assert from "node:assert/strict";
import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import {
  ADDITIVE_UPPER_BODY_THRESHOLD,
  AIRBORNE_VISUAL_TUNING,
  CLIP_AUTHORED_MS,
  CLIP_UPPER_BODY_SHARE,
  CLIP_AUTHORED_SPEED_MPS,
  CLIP_CONTENT_MS,
  CLIP_CONTENT_START_MS,
  CYCLIC_VERB_CLIPS,
  MAX_VERB_TIME_SCALE,
  PLAYER_CLIPS,
  PLAYER_CLIP_SPEC,
  chooseAvailableClip,
  clipStartSeconds,
  compactPlayerAirborneClips,
  playerClipFor,
  registerCharacterClips,
  strideTimeScale,
  verbTimeScale,
} from "../characterAnimation.js";
import {
  PARKOUR_CLIP_FALLBACKS,
  PARKOUR_CLIP_TARGET_MS,
} from "../parkour/clips.js";
import { PARKOUR_TUNING } from "../parkour/tuning.js";
import {
  CROUCH_SPEED,
  GRAVITY,
  RUN_SPEED,
  STANDING_JUMP_VY,
  WALK_SPEED,
  dashSpeed,
} from "../playerMotion.js";

function quaternionValues(quaternion: Quaternion): number[] {
  return [...quaternion.toArray(), ...quaternion.toArray()];
}

test("airborne clip compaction reduces arm splay without touching root motion", () => {
  const idleRotation = new Quaternion();
  const splayed = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  const rootValues = [0, 0, 0, 0, 0.4, 0];
  const clips = [
    new AnimationClip("idle", 1, [
      new QuaternionKeyframeTrack(
        "mixamorigLeftArm.quaternion",
        [0, 1],
        quaternionValues(idleRotation),
      ),
    ]),
    new AnimationClip("jump", 1, [
      new QuaternionKeyframeTrack(
        "mixamorigLeftArm.quaternion",
        [0, 1],
        quaternionValues(splayed),
      ),
      new VectorKeyframeTrack(
        "mixamorigHips.position",
        [0, 1],
        rootValues,
      ),
    ]),
  ];
  const sourceArmBefore = [...clips[1]!.tracks[0]!.values];
  const compacted = compactPlayerAirborneClips(
    "playerboy-rigged",
    clips,
  );
  const sourceJump = clips[1]!;
  const compactJump = compacted[1]!;
  assert.notEqual(compactJump, sourceJump);
  const sourceArm = sourceJump.tracks[0] as QuaternionKeyframeTrack;
  const compactArm = compactJump.tracks[0] as QuaternionKeyframeTrack;
  const sourceAngle = new Quaternion()
    .fromArray(sourceArm.values, 0)
    .angleTo(idleRotation);
  const compactAngle = new Quaternion()
    .fromArray(compactArm.values, 0)
    .angleTo(idleRotation);
  assert.ok(compactAngle < sourceAngle * 0.7);
  assert.deepEqual(
    [...compactJump.tracks[1]!.values],
    [...sourceJump.tracks[1]!.values],
    "root performance must remain authored",
  );
  assert.deepEqual(
    [...sourceArm.values],
    sourceArmBefore,
    "source asset clip must not be mutated",
  );
});

// ---------------------------------------------------------------------------
// Clip substitution.
//
// The clip contract has always named what each performance degrades to, and a
// test has always checked that the table says so. Nothing read it: selection
// went straight to the rig-wide `fallback`, which for the player is `idle`. So
// a clip this rig does not carry — `stepUp`, authored to fall back to `run` —
// planted a standing pose on a body still crossing the ground at speed. (`dash`
// was in this list until 2026-07-27, when a real "Idle To Sprint" launch was
// baked onto the rig; the substitution still has to work for anything unbaked.)
// ---------------------------------------------------------------------------

test("a missing clip takes its authored substitute, not the rig-wide fallback", () => {
  registerCharacterClips("test-rig", PLAYER_CLIP_SPEC);
  // A rig that carries the manifest minus `dash`, to exercise the substitution
  // for a genuinely absent clip. `stepUp` is never in the manifest at all.
  const available = PLAYER_CLIPS.filter((name) => name !== "dash");

  assert.equal(chooseAvailableClip("test-rig", "dash", available), "run");
  assert.equal(chooseAvailableClip("test-rig", "stepUp", available), "run");
  // A clip the rig does carry is returned untouched.
  assert.equal(chooseAvailableClip("test-rig", "landRun", available), "landRun");
});

test("substitution follows the chain and cannot be hung by a cycle", () => {
  // landHard -> dropRoll -> runJump, so stripping the first two must land on
  // the third rather than collapsing to idle.
  registerCharacterClips("chain-rig", PLAYER_CLIP_SPEC);
  const thin = PLAYER_CLIPS.filter(
    (name) => name !== "landHard" && name !== "dropRoll",
  );
  assert.equal(PARKOUR_CLIP_FALLBACKS.landHard, "dropRoll");
  assert.equal(PARKOUR_CLIP_FALLBACKS.dropRoll, "runJump");
  assert.equal(chooseAvailableClip("chain-rig", "landHard", thin), "runJump");

  registerCharacterClips("cycle-rig", {
    fallback: "idle",
    expected: ["idle"],
    fallbacks: { a: "b", b: "a" },
  });
  assert.equal(
    chooseAvailableClip("cycle-rig", "a", ["idle"]),
    "idle",
    "a cycle must fall through to the rig fallback rather than spin",
  );
});

test("a rig with no substitution table still resolves the old way", () => {
  registerCharacterClips("plain-rig", { fallback: "idle", expected: ["idle", "run"] });
  assert.equal(chooseAvailableClip("plain-rig", "dash", ["idle", "run"]), "idle");
});

// ---------------------------------------------------------------------------
// Playback rate.
//
// Every number checked here was measured off the shipped rig by
// assets/pipeline/measure_clip_rates.mjs. These tests are not re-deriving them
// — they hold the PROPERTIES the measurement was taken to guarantee, so that a
// future re-measurement is free to move a constant but not free to reintroduce
// a cycle running at twice the speed of the body under it.
// ---------------------------------------------------------------------------

test("the player rig times the clip it will play, not the one it was asked for", () => {
  // `stepUp` this rig does not carry: it is answered with `run`, and used to be
  // timed as itself, find nothing, and play the run cycle at 1.0 while the body
  // moved at a completely different speed. `dash` is now baked, so it times as
  // itself.
  assert.equal(playerClipFor("dash"), "dash");
  assert.equal(playerClipFor("stepUp"), "run");
  assert.equal(playerClipFor("run"), "run");
  assert.equal(playerClipFor("landRun"), "landRun");
  // Unknown names still land somewhere playable rather than undefined.
  assert.equal(playerClipFor("nosuchclip"), PLAYER_CLIP_SPEC.fallback);
});

test("the dash is a first-class one-shot, fitted to its own launch", () => {
  // The dash used to be an alias of `run`, stride-matched to the burst speed
  // because the rig carried no dash performance. It is now a baked clip in its
  // own right (Mixamo "Idle To Sprint"): playerClipFor returns it unchanged, and
  // it is fitted to its content by verbTimeScale like any other one-shot verb
  // rather than stride-matched like a locomotion cycle.
  assert.equal(playerClipFor("dash"), "dash");
  const window = PARKOUR_CLIP_TARGET_MS.dash!;
  const scale = verbTimeScale("dash", window);
  assert.ok(scale !== null, "a baked dash must have a measured rate");
  assert.ok(scale! > 1, `the launch compresses into its short window (got ${scale})`);
  assert.ok(scale! <= MAX_VERB_TIME_SCALE + 1e-9, "and never above the ceiling");
});

test("every locomotion cycle is driven at a rate near its authored one", () => {
  // The failure this catches is the one the owner reported: a cycle spun at
  // nearly twice the cadence of the body carrying it. A stride match is allowed
  // to correct a clip, but a correction of more than half again in either
  // direction means the clip is the wrong performance for the speed, which is a
  // bake decision and not something a timeScale should be papering over.
  const driven: ReadonlyArray<readonly [string, number]> = [
    ["walk", WALK_SPEED],
    ["run", RUN_SPEED],
    ["crouchWalk", CROUCH_SPEED],
    ["run", dashSpeed(RUN_SPEED)],
  ];
  for (const [clip, speed] of driven) {
    const scale = strideTimeScale(clip, speed);
    assert.ok(
      scale > 0.66 && scale < 1.5,
      `${clip} at ${speed}m/s wants timeScale ${scale.toFixed(2)}`,
    );
  }
});

test("the run cycle is slowed to the body, not the body sped to the cycle", () => {
  // Specifically the regression that was shipped: `run` was recorded at
  // 2.81 m/s, which asks for 1.64x under a 4.6 m/s body. The clip is a fast
  // performance and RUN_SPEED is below it, so the honest correction is below 1.
  assert.ok(CLIP_AUTHORED_SPEED_MPS.run! > RUN_SPEED);
  assert.ok(strideTimeScale("run", RUN_SPEED) < 1);
});

test("a one-shot is fitted to its content, and never faster than the ceiling", () => {
  for (const [clip, content] of Object.entries(CLIP_CONTENT_MS)) {
    const file = CLIP_AUTHORED_MS[clip];
    assert.ok(file, `${clip} has content but no measured length`);
    assert.ok(
      content <= file!,
      `${clip} claims ${content}ms of performance inside a ${file}ms file`,
    );
  }
  // A window of one tick is the hardest case there is: the ceiling has to hold
  // even when the mechanical claim is absurd.
  for (const clip of Object.keys(CLIP_CONTENT_MS)) {
    const scale = verbTimeScale(clip, 1000 / 60);
    assert.ok(scale !== null, `${clip} should be fitted`);
    assert.ok(
      scale! <= MAX_VERB_TIME_SCALE + 1e-9,
      `${clip} fitted at ${scale} exceeds the ceiling`,
    );
  }
});

test("the contract's target outranks a window shorter than it", () => {
  // The landing rule, generalised: a nine-tick recovery does not get to squeeze
  // a 250ms beat into 150ms. The rate is the slower claim, and the overrun is
  // blended out.
  const window = 9 * (1000 / 60);
  const target = PARKOUR_CLIP_TARGET_MS.landRun!;
  assert.ok(window < target);
  assert.equal(
    verbTimeScale("landRun", window),
    verbTimeScale("landRun", target),
  );
  // And a window LONGER than the target wins instead, so the clip fills it
  // rather than finishing early and freezing on its last frame.
  const long = target * 4;
  assert.ok(verbTimeScale("landRun", long)! < verbTimeScale("landRun", target)!);
});

test("a cyclic verb clip is never compressed into its window", () => {
  // climbUp is four ladder cycles in one file. Fitting it to the 900ms window
  // would run all four in nine tenths of a second.
  for (const clip of CYCLIC_VERB_CLIPS) {
    assert.equal(verbTimeScale(clip, PARKOUR_TUNING.durationsMs.CLIMB_UP), 1);
  }
});

test("a clip with no measured performance reports so rather than answering 1", () => {
  // The distinction matters at the call site: 1 is a rate, null is "ask the
  // stride instead". Collapsing them is how a step-up came to play the run
  // cycle at 1.0 in the middle of a sprint.
  assert.equal(verbTimeScale("run", 200), null);
  assert.equal(verbTimeScale("idle", 200), null);
  assert.equal(verbTimeScale("vault", 0), null);
});

test("the leap-of-faith payoff opens on the get-up rather than on the dead air", () => {
  const start = CLIP_CONTENT_START_MS.leapOfFaithLand!;
  const content = CLIP_CONTENT_MS.leapOfFaithLand!;
  const file = CLIP_AUTHORED_MS.leapOfFaithLand!;
  assert.ok(start > 2000, "the lead-in is 2.5s of lying still and must be skipped");
  assert.ok(start + content <= file);
  assert.equal(clipStartSeconds("leapOfFaithLand"), start / 1000);
  // Locomotion must never be seeked: it would cost the walk/run crossfade the
  // phase continuity that keeps a gait change from hitching.
  for (const clip of ["walk", "run", "crouchWalk", "idle"]) {
    assert.equal(clipStartSeconds(clip), 0);
  }
});

test("the landing clip is not additive-shaped and the throw is", () => {
  // The contract says landRun was authored upper-body-weighted so it could be
  // blended over a run. The bake disagrees: it drives the leg chains harder per
  // bone than the run does, so adding it to a run would scissor the legs. This
  // is the measurement that stops an additive layer being built on the strength
  // of a note, and points it at the clip that would actually benefit.
  assert.ok(
    CLIP_UPPER_BODY_SHARE.landRun! < ADDITIVE_UPPER_BODY_THRESHOLD,
    "landRun must not be treated as an additive overlay",
  );
  assert.ok(
    CLIP_UPPER_BODY_SHARE.throwLight! >= ADDITIVE_UPPER_BODY_THRESHOLD,
    "throwLight is the overlay candidate",
  );
});

test("every measured clip name is one the rig actually carries", () => {
  const carried = new Set<string>(PLAYER_CLIPS);
  for (const table of [CLIP_CONTENT_MS, CLIP_CONTENT_START_MS, CLIP_AUTHORED_SPEED_MPS]) {
    for (const clip of Object.keys(table)) {
      assert.ok(carried.has(clip), `${clip} is measured but not in the manifest`);
    }
  }
});

test("jump playback leaves a bounded landing recovery after touchdown", () => {
  const ballisticSeconds = (2 * STANDING_JUMP_VY) / GRAVITY;
  const standingSeconds = 2.4 / AIRBORNE_VISUAL_TUNING.standingTimeScale;
  const runningSeconds =
    (14 / 15) / AIRBORNE_VISUAL_TUNING.runningTimeScale;
  for (const clipSeconds of [standingSeconds, runningSeconds]) {
    const recovery = clipSeconds - ballisticSeconds;
    assert.ok(recovery > 0.08, `missing landing recovery: ${recovery}`);
    assert.ok(
      recovery <= AIRBORNE_VISUAL_TUNING.landingRecoverySeconds,
      `recovery ${recovery} exceeds visual window`,
    );
  }
});
