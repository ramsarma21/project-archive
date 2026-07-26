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
  AIRBORNE_VISUAL_TUNING,
  compactPlayerAirborneClips,
} from "../characterAnimation.js";
import {
  GRAVITY,
  STANDING_JUMP_VY,
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
