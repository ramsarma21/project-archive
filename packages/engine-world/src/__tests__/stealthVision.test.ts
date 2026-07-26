// Detection: the cone, occlusion, and the one-difficulty guarantee.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHEST_HEIGHT_FRACTION,
  CROUCH_HEIGHT,
  EYE_HEIGHT_FRACTION,
  STAND_HEIGHT,
  chestPosition,
  eyePosition,
} from "../collision.js";
import {
  STEALTH_TUNING,
  eyePoint,
  motionReadFor,
  sightTarget,
  visibility,
} from "../stealth/index.js";
import { box, wall, world } from "./parkourHarness.js";

const eyeAtOrigin = {
  position: { x: 0, y: 0, z: 0 },
  forwardX: 0,
  forwardZ: 1,
};

function player(
  x: number,
  z: number,
  overrides: Partial<Parameters<typeof visibility>[2]> = {},
) {
  return {
    position: { x, y: 0, z },
    capsuleHeight: STAND_HEIGHT,
    exposure: "EXPOSED" as const,
    motion: "WALK" as const,
    covered: false,
    lightLevel: 1,
    crowdBlend: 0,
    ...overrides,
  };
}

test("a player dead ahead in the open is seen", () => {
  const result = visibility(world(), eyeAtOrigin, player(0, 6));
  assert.ok(result.inCone);
  assert.ok(result.hasLineOfSight);
  assert.ok(result.visibility > 0.3, `visibility was ${result.visibility}`);
});

test("a player behind the watcher is not seen at all", () => {
  const result = visibility(world(), eyeAtOrigin, player(0, -6));
  assert.equal(result.inCone, false);
  assert.equal(result.visibility, 0);
});

test("a player past the sight range is not seen at all", () => {
  const far = STEALTH_TUNING.coneRangeM + 1;
  const result = visibility(world(), eyeAtOrigin, player(0, far));
  assert.equal(result.visibility, 0);
  assert.equal(result.inCone, false);
});

test("visibility feathers toward the cone edge rather than snapping", () => {
  const centre = visibility(world(), eyeAtOrigin, player(0, 6)).visibility;
  const edgeward = visibility(world(), eyeAtOrigin, player(3.6, 6)).visibility;
  assert.ok(edgeward > 0, "just inside the cone edge is still contact");
  assert.ok(edgeward < centre, "the cone edge must be weaker than dead centre");
});

test("a wall between them breaks line of sight completely", () => {
  // A full-height wall at z=3 spans the sightline from an eye at 1.62m.
  const collision = world([wall("wall", 3, 0.5, 12)]);
  const result = visibility(collision, eyeAtOrigin, player(0, 6));
  assert.equal(result.inCone, true, "the player is still inside the cone");
  assert.equal(result.hasLineOfSight, false);
  assert.equal(result.visibility, 0, "occlusion is a complete break, not a discount");
});

test("crouching behind a low crate breaks a sightline that standing does not", () => {
  // Cover works because the sightline is a real segment from the guard's eye to
  // the player's chest: the crate has to be low enough and near enough to the
  // player that only the crouched chest falls behind it.
  const collision = world([box("crate", 5.4, 0.8, 0.4, { width: 12 })]);
  const standing = visibility(collision, eyeAtOrigin, player(0, 6.1));
  const crouched = visibility(
    collision,
    eyeAtOrigin,
    player(0, 6.1, { capsuleHeight: CROUCH_HEIGHT }),
  );
  assert.equal(standing.hasLineOfSight, true, "standing is exposed over the crate");
  assert.equal(crouched.hasLineOfSight, false, "crouching hides behind it");
  assert.ok(
    crouched.visibility < standing.visibility,
    `crouched ${crouched.visibility} should be under standing ${standing.visibility}`,
  );
});

test("distance, concealment, cover, darkness and crowd all reduce visibility", () => {
  const base = visibility(world(), eyeAtOrigin, player(0, 5)).visibility;
  assert.ok(visibility(world(), eyeAtOrigin, player(0, 12)).visibility < base);
  assert.ok(
    visibility(world(), eyeAtOrigin, player(0, 5, { exposure: "CONCEALED" }))
      .visibility < base,
  );
  assert.ok(
    visibility(world(), eyeAtOrigin, player(0, 5, { covered: true })).visibility <
      base,
  );
  assert.ok(
    visibility(world(), eyeAtOrigin, player(0, 5, { lightLevel: 0 })).visibility <
      base,
  );
  assert.equal(
    visibility(world(), eyeAtOrigin, player(0, 5, { crowdBlend: 1 })).visibility,
    0,
    "a completed crowd blend is a full break",
  );
});

test("sprinting is more visible than walking, crouching less", () => {
  const sprint = visibility(
    world(),
    eyeAtOrigin,
    player(0, 6, { motion: "SPRINT" }),
  ).visibility;
  const walk = visibility(world(), eyeAtOrigin, player(0, 6)).visibility;
  const crouch = visibility(
    world(),
    eyeAtOrigin,
    player(0, 6, { motion: "CROUCH_MOVE" }),
  ).visibility;
  assert.ok(sprint > walk);
  assert.ok(crouch < walk);
});

test("traversal is the most conspicuous thing the player can do", () => {
  const factors = STEALTH_TUNING.motion;
  const peak = Math.max(...Object.values(factors));
  assert.equal(factors.TRAVERSAL, peak, "vaulting a wall must not be stealthy");
});

// ---- the one-difficulty guarantee ------------------------------------------

test("detection has no per-player term: identical geometry, identical value", () => {
  // The old detection code multiplied accrual by a per-player Standing band
  // (0.7x to 1.4x) and a global heat band (0.8x to 1.6x). Neither exists here.
  const factorKeys = Object.keys(STEALTH_TUNING).filter((key) =>
    /standing|heat|difficulty|tier|skill|rank|level/i.test(key),
  );
  assert.deepEqual(
    factorKeys,
    [],
    `stealth tuning must carry no per-player scaling: found ${factorKeys.join(",")}`,
  );
  assert.deepEqual(Object.keys(STEALTH_TUNING.exposure), [
    "EXPOSED",
    "PARTIAL",
    "CONCEALED",
  ]);
  assert.deepEqual(Object.keys(STEALTH_TUNING.motion), [
    "STILL",
    "CROUCH_STILL",
    "CROUCH_MOVE",
    "WALK",
    "SPRINT",
    "TRAVERSAL",
  ]);
});

test("the same situation resolves identically every time it is asked", () => {
  const collision = world([box("crate", 4, 1, 1)]);
  const first = visibility(collision, eyeAtOrigin, player(0.5, 7));
  const second = visibility(collision, eyeAtOrigin, player(0.5, 7));
  assert.deepEqual(first, second);
});

test("the motion read is derived from the body, not asserted by the caller", () => {
  const stand = STAND_HEIGHT;
  const crouch = CROUCH_HEIGHT;
  assert.equal(
    motionReadFor({ speedMps: 4.6, capsuleHeight: stand, sprinting: true, traversing: false }),
    "SPRINT",
  );
  assert.equal(
    motionReadFor({ speedMps: 4.6, capsuleHeight: stand, sprinting: true, traversing: true }),
    "TRAVERSAL",
  );
  assert.equal(
    motionReadFor({ speedMps: 0, capsuleHeight: crouch, sprinting: false, traversing: false }),
    "CROUCH_STILL",
  );
  assert.equal(
    motionReadFor({ speedMps: 0, capsuleHeight: stand, sprinting: false, traversing: false }),
    "STILL",
  );
});

// ---- one body model --------------------------------------------------------

test("a watcher's eye and the player's chest come from the shared body model", () => {
  // Not "two systems that agree" — one definition, consumed twice. This is what
  // makes a crouched silhouette mean one thing to a cone and to an aimed shot.
  const watcher = { position: { x: 1, y: 2, z: 3 }, forwardX: 0, forwardZ: 1 };
  assert.deepEqual(
    eyePoint(watcher),
    eyePosition({ pos: watcher.position, capsuleHeight: STAND_HEIGHT }),
  );
  const crouching = player(0, 5, { capsuleHeight: CROUCH_HEIGHT });
  assert.deepEqual(
    sightTarget(crouching),
    chestPosition({ pos: crouching.position, capsuleHeight: CROUCH_HEIGHT }),
  );
});

test("the eye line sits inside the body, not above it", () => {
  // The height this replaced was an absolute 1.62m on a 1.55m capsule: a watcher
  // whose eyes were above the top of his own head, and therefore whose sightline
  // cleared walls that should have stopped it.
  assert.ok(EYE_HEIGHT_FRACTION < 1);
  assert.ok(CHEST_HEIGHT_FRACTION < EYE_HEIGHT_FRACTION);
  const eye = eyePoint({ position: { x: 0, y: 0, z: 0 }, forwardX: 0, forwardZ: 1 });
  assert.ok(eye.y < STAND_HEIGHT, `eye at ${eye.y} must be under ${STAND_HEIGHT}`);
});

test("crouching lowers both landmarks proportionally", () => {
  const ratio = CROUCH_HEIGHT / STAND_HEIGHT;
  const standingEye = eyePosition({ pos: { x: 0, y: 0, z: 0 }, capsuleHeight: STAND_HEIGHT });
  const crouchedEye = eyePosition({ pos: { x: 0, y: 0, z: 0 }, capsuleHeight: CROUCH_HEIGHT });
  assert.ok(Math.abs(crouchedEye.y / standingEye.y - ratio) < 1e-9);
});
