import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_YAW_LIMIT,
  HEAD_PITCH_LIMIT,
  HEAD_YAW_LIMIT,
  bodyYawTarget,
  clampAngle,
  dampAngle,
  glanceEnvelope,
  headPitchTarget,
  headYawTarget,
  shotGaze,
} from "../src/module/presenterGaze.js";

// The owner asked the presenter to face the viewer with real eye contact and no
// twisted neck. The gaze maths is pure, so the clamps, the smoothing and the
// glance-and-return can be pinned here without a canvas.

test("the body faces the camera on every shot", () => {
  // "Face the user more": the torso yaw is at or near zero and always within a
  // small limit, whatever the shot. The over-shoulder look is the head's job.
  for (const shot of ["ESTABLISH", "PRESENTER_MEDIUM", "OVER_SHOULDER", "VISUAL_FOCUS", "REACTION"] as const) {
    const body = bodyYawTarget(shotGaze(shot));
    assert.ok(Math.abs(body) <= BODY_YAW_LIMIT, `${shot} body yaw ${body} exceeds the limit`);
  }
});

test("direct-address shots hold full eye contact; a wide shot relaxes it", () => {
  assert.equal(shotGaze("PRESENTER_MEDIUM").contact, 1);
  assert.equal(shotGaze("REACTION").contact, 1);
  assert.ok(
    shotGaze("ESTABLISH").contact < shotGaze("PRESENTER_MEDIUM").contact,
    "the establishing wide should not force robotic eye contact",
  );
});

test("only the visual shots carry a motivated glance", () => {
  assert.equal(shotGaze("PRESENTER_MEDIUM").glanceYaw, 0);
  assert.equal(shotGaze("REACTION").glanceYaw, 0);
  assert.ok(shotGaze("OVER_SHOULDER").glanceYaw > 0, "over-shoulder glances toward the visual");
  assert.ok(shotGaze("VISUAL_FOCUS").glanceYaw > 0, "focus keeps a partial glance");
});

test("head yaw and pitch are always clamped to their limits", () => {
  // Even an absurd camera offset cannot twist the neck past the ceiling.
  const gaze = shotGaze("OVER_SHOULDER");
  const yaw = headYawTarget(gaze, 1, 5);
  const pitch = headPitchTarget(gaze, -5);
  assert.ok(Math.abs(yaw) <= HEAD_YAW_LIMIT + 1e-9, `yaw ${yaw} over limit`);
  assert.ok(Math.abs(pitch) <= HEAD_PITCH_LIMIT + 1e-9, `pitch ${pitch} over limit`);
  assert.equal(clampAngle(99, 0.5), 0.5);
  assert.equal(clampAngle(-99, 0.5), -0.5);
});

test("the glance rises, holds, and returns to eye contact within a shot", () => {
  assert.equal(glanceEnvelope(0), 0, "no glance at the instant the shot begins");
  assert.ok(glanceEnvelope(0.2) > 0 && glanceEnvelope(0.2) < 1, "it ramps in");
  assert.equal(glanceEnvelope(0.7), 1, "it holds on the visual briefly");
  assert.ok(glanceEnvelope(1.5) > 0 && glanceEnvelope(1.5) < 1, "then it returns");
  assert.equal(glanceEnvelope(2.5), 0, "and eye contact is restored while the shot is still up");
});

test("with no camera offset and no glance the head looks straight ahead", () => {
  // Medium shot, camera dead ahead: the head neither yaws nor pitches, which is
  // exactly the eye contact the owner wanted.
  const gaze = shotGaze("PRESENTER_MEDIUM");
  assert.equal(headYawTarget(gaze, 0, 0), 0);
  assert.equal(headPitchTarget(gaze, 0), 0);
});

test("damping is frame-rate independent and never overshoots", () => {
  // One big step and many small steps reach nearly the same place, and neither
  // passes the target — the guarantee against snapping and jitter.
  const rate = 0.02;
  const oneStep = dampAngle(0, 1, 0.1, rate);
  let many = 0;
  for (let i = 0; i < 10; i += 1) many = dampAngle(many, 1, 0.01, rate);
  assert.ok(Math.abs(oneStep - many) < 0.05, `frame-rate dependent: ${oneStep} vs ${many}`);
  assert.ok(oneStep <= 1 && many <= 1, "damping never overshoots the target");

  // A monotone approach: each step moves toward the target, never away.
  let prev = 0;
  for (let i = 0; i < 20; i += 1) {
    const next = dampAngle(prev, 1, 0.016, rate);
    assert.ok(next >= prev && next <= 1, `non-monotone step ${prev} -> ${next}`);
    prev = next;
  }
});

test("a stalled frame cannot fling the head across the clamp", () => {
  // dt is clamped inside dampAngle, so a 2-second stall advances at most the
  // 100ms cap's worth — no snap after a background tab wakes.
  const huge = dampAngle(0, 1, 2, 0.02);
  const capped = dampAngle(0, 1, 0.1, 0.02);
  assert.equal(huge, capped, "a long delta is clamped to the per-frame cap");
});
