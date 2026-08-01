import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_ANGLE, stepTurntable, type TurntableSpin } from "../src/pages/hub/turntable.js";

// The opening yaw is load-bearing off-screen: the intro cuts to the player
// face-on and crossfades into the hub, so a non-zero home angle makes the
// figure turn across the dissolve. Nothing else pins it, and the defect is
// invisible in a still taken more than a second after load — by then the
// ambient spin has moved him anyway — so it is pinned here.

function freshSpin(): TurntableSpin {
  return {
    angle: HOME_ANGLE,
    target: HOME_ANGLE,
    velocity: 0,
    dragging: false,
    lastInputAt: performance.now(),
  };
}

test("the hub opens square to the camera, for the intro's match cut", () => {
  assert.equal(HOME_ANGLE, 0);
});

test("drag still rotates from the home angle, and holds where it is let go", () => {
  const spin = freshSpin();
  spin.dragging = true;
  spin.target = HOME_ANGLE + 1.2;
  for (let i = 0; i < 30; i++) stepTurntable(spin, 1 / 60, false);
  assert.ok(
    spin.angle > HOME_ANGLE + 0.5,
    `drag from the home angle should turn the model, got ${spin.angle}`,
  );
});

test("reduced motion holds the opening pose instead of spinning away from it", () => {
  const spin = freshSpin();
  for (let i = 0; i < 600; i++) stepTurntable(spin, 1 / 60, true);
  assert.equal(spin.angle, HOME_ANGLE);
});

// The counterpart to the above, and the thing that makes "face-on at rest"
// impossible to state without qualification: with motion allowed the turntable
// takes itself over and keeps turning. The opening pose is the first beat, not
// a resting state, so a capture taken seconds after load says nothing about it.
test("with motion allowed the turntable does not rest — it resumes its own spin", () => {
  const spin = freshSpin();
  spin.lastInputAt = performance.now() - 5000;
  for (let i = 0; i < 300; i++) stepTurntable(spin, 1 / 60, false);
  assert.ok(
    Math.abs(spin.angle - HOME_ANGLE) > 0.5,
    `the ambient spin should have moved the model, got ${spin.angle}`,
  );
});
