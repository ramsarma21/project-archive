// The three shared primitives: the burst phase, the actor query, and the body
// landmarks.
//
// These are consumed by parkour, by the duel and eventually by PvP, so the tests
// that matter most are the ones asserting there is ONE of each — that a burst is
// the same burst in both contexts, and that a body is the same body to a vision
// cone and to an incoming ball.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAPSULE_RADIUS,
  CHEST_HEIGHT_FRACTION,
  CROUCH_HEIGHT,
  EYE_HEIGHT_FRACTION,
  STAND_HEIGHT,
  chestPosition,
  eyePosition,
  firstActorHit,
  isCrouched,
  segmentClear,
  segmentHitsCapsule,
  type Vec3,
} from "../collision.js";
import { FIELD_DT } from "../fieldSimulation.js";
import {
  AUTHORED_PHASES,
  BURST_PHASES,
  DASH_DURATION_MS,
  DASH_SPEED_SCALE,
  RUN_SPEED,
  WALK_SPEED,
  beginDash,
  beginRunningJump,
  beginAuthored,
  canDash,
  cancelDash,
  dashProgress,
  dashRemainingMs,
  dashSpeed,
  isDashing,
  stepMotion,
  type MotionEventType,
  type MotionState,
} from "../playerMotion.js";
import { createFlowState, stepFlow } from "../parkour/index.js";
import { box, flowInput, runningNorth, wall, world } from "./parkourHarness.js";

// ---------------------------------------------------------------------------
// PRIMITIVE 1 — the DASH / burst phase
// ---------------------------------------------------------------------------

const NORTH = { x: 0, z: 1 };

function dashFor(
  collision = world(),
  ticks = 24,
  options: {
    start?: MotionState;
    speed?: number;
    dir?: { x: number; z: number };
    targetVelX?: number;
    targetVelZ?: number;
    durationMs?: number;
  } = {},
): { motion: MotionState; events: MotionEventType[] } {
  const dir = options.dir ?? NORTH;
  let motion = beginDash(
    options.start ?? runningNorth(0, 0),
    dir.x,
    dir.z,
    options.speed ?? dashSpeed(RUN_SPEED),
    options.durationMs ?? DASH_DURATION_MS,
  );
  const events: MotionEventType[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const result = stepMotion(collision, motion, {
      dt: FIELD_DT,
      targetVelX: options.targetVelX ?? 0,
      targetVelZ: options.targetVelZ ?? 0,
      reducedMotion: false,
    });
    motion = result.state;
    events.push(...result.events);
  }
  return { motion, events };
}

test("a burst enters a real phase carrying its window", () => {
  const motion = beginDash(runningNorth(0, 0), 0, 1, dashSpeed(RUN_SPEED));
  assert.equal(motion.phase, "DASH");
  assert.equal(isDashing(motion), true);
  assert.ok(motion.dash);
  assert.equal(motion.dash!.durationMs, DASH_DURATION_MS);
  assert.equal(dashProgress(motion), 0);
  assert.equal(dashRemainingMs(motion), DASH_DURATION_MS);
  // The window is observable so the duel can hang i-frames on it without owning
  // the motion.
  assert.equal(motion.dash!.dirZ, 1);
  assert.equal(motion.dash!.speed, RUN_SPEED * DASH_SPEED_SCALE);
});

test("a burst is not an authored action: it is velocity-driven", () => {
  assert.equal(AUTHORED_PHASES.has("DASH"), false);
  assert.equal(BURST_PHASES.has("DASH"), true);
  const motion = beginDash(runningNorth(0, 0), 0, 1, dashSpeed(RUN_SPEED));
  assert.equal(motion.action, null, "a burst follows no anchored trajectory");
});

test("the burst travels at the scaled speed, and further than a walk", () => {
  const burst = dashFor(world(), 20);
  let walking = runningNorth(0, 0);
  for (let tick = 0; tick < 20; tick++) {
    walking = stepMotion(world(), walking, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: WALK_SPEED,
      reducedMotion: false,
    }).state;
  }
  assert.ok(
    burst.motion.pos.z > walking.pos.z * 2,
    `burst reached ${burst.motion.pos.z.toFixed(2)}, walk ${walking.pos.z.toFixed(2)}`,
  );
});

test("the window closes after its authored duration and restores the stance", () => {
  const ticksToClose = Math.ceil(DASH_DURATION_MS / (FIELD_DT * 1000));
  const short = dashFor(world(), ticksToClose - 2);
  assert.equal(short.motion.phase, "DASH", "still bursting");
  assert.ok(!short.events.includes("dashEnded"));

  const done = dashFor(world(), ticksToClose + 1);
  assert.equal(done.motion.phase, "GROUNDED");
  assert.equal(done.motion.dash, null);
  assert.ok(done.events.includes("dashEnded"));
});

test("a burst from a crouch ends crouched", () => {
  const crouching: MotionState = {
    ...runningNorth(0, 0),
    phase: "CROUCH",
    capsuleHeight: CROUCH_HEIGHT,
  };
  const result = dashFor(world(), 40, { start: crouching });
  assert.equal(result.motion.phase, "CROUCH");
  assert.equal(isCrouched(result.motion.capsuleHeight), true);
});

test("the burst does not end in a stop the player did not ask for", () => {
  const ticksToClose = Math.ceil(DASH_DURATION_MS / (FIELD_DT * 1000));
  const done = dashFor(world(), ticksToClose + 1);
  assert.ok(
    Math.hypot(done.motion.vel.x, done.motion.vel.z) > 1,
    "velocity survives the exit so a burst flows into a run",
  );
});

test("the direction is fixed at commit: a burst is a commitment", () => {
  // Two callers feeding completely different movement intent get identical
  // motion, which is what lets the duel keep reading a stick mid-dodge without
  // steering the burst.
  const a = dashFor(world(), 16, { targetVelX: 0, targetVelZ: 0 });
  const b = dashFor(world(), 16, { targetVelX: -RUN_SPEED, targetVelZ: -RUN_SPEED });
  assert.deepEqual(a.motion.pos, b.motion.pos);
  assert.deepEqual(a.motion.vel, b.motion.vel);
});

test("displacement comes from the shared integrator, so a burst collides", () => {
  // If the burst wrote position directly it would pass through the wall. It does
  // not, because it only replaces the target velocity handed to stepGrounded.
  const collision = world([wall("wall", 3, 0.5, 12)]);
  const result = dashFor(collision, 40);
  assert.ok(
    result.motion.pos.z < 3,
    `burst ended at z=${result.motion.pos.z.toFixed(2)}; it must not pass the wall`,
  );
});

test("a burst slides along a wall instead of stopping dead on it", () => {
  // Wall slide is the integrator's, and a burst inherits it unchanged.
  const collision = world([wall("wall", 3, 0.5, 12)]);
  const result = dashFor(collision, 20, { dir: { x: 0.6, z: 0.8 } });
  assert.ok(result.motion.pos.x > 0.3, `slid to x=${result.motion.pos.x.toFixed(2)}`);
});

test("a burst onto a low ledge snaps to support like running does", () => {
  const collision = world([box("step", 3, 0.3, 2, { width: 6 })]);
  const result = dashFor(collision, 40);
  // Either it mounted the step or it was stopped by it, but it never tunnels.
  assert.ok(result.motion.pos.y >= 0);
  assert.ok(result.motion.grounded);
});

test("a burst off a ledge becomes a fall and the window closes with it", () => {
  // A deliberately long burst, so the thing that closes the window is the ledge
  // rather than the duration expiring. Coyote grace applies first, exactly as it
  // does to a run, because this is the same grounded step.
  const collision = world([box("roof", 0, 4, 6, { width: 12 })]);
  const start: MotionState = { ...runningNorth(1, 0, 4), phase: "GROUNDED" };
  const result = dashFor(collision, 30, { start, durationMs: 1200 });
  assert.ok(result.events.includes("dashEnded"));
  assert.equal(result.motion.dash, null);
  assert.ok(result.motion.pos.y < 4, "it left the roof");
});

test("a burst is refused where it would not be legal, observably", () => {
  const airborne = beginRunningJump(runningNorth(0, RUN_SPEED));
  assert.equal(canDash(airborne), false);
  assert.equal(beginDash(airborne, 0, 1, 10), airborne, "a refusal is a no-op");

  const collision = world([box("crate", 3, 0.9, 0.8)]);
  const authored = beginAuthored(collision, runningNorth(2.2), {
    kind: "VAULT",
    anchors: [
      { x: 0, y: 0, z: 2.2 },
      { x: 0, y: 0.9, z: 3 },
      { x: 0, y: 0, z: 3.9 },
    ],
    durationMs: 380,
    ignore: ["crate"],
  });
  assert.ok(authored, "the vault should begin");
  assert.equal(canDash(authored!), false);

  const grounded = runningNorth(0, 0);
  assert.equal(canDash(grounded), true);
  assert.equal(beginDash(grounded, 0, 0, 10), grounded, "no direction, no burst");
  assert.equal(beginDash(grounded, 0, 1, 0), grounded, "no speed, no burst");
});

test("a burst can be cancelled early, keeping its momentum", () => {
  const mid = dashFor(world(), 6).motion;
  assert.equal(isDashing(mid), true);
  const cancelled = cancelDash(mid);
  assert.equal(cancelled.phase, "GROUNDED");
  assert.equal(cancelled.dash, null);
  assert.deepEqual(cancelled.vel, mid.vel);
});

test("reduced motion resolves the burst immediately", () => {
  let motion = beginDash(runningNorth(0, 0), 0, 1, dashSpeed(RUN_SPEED));
  const result = stepMotion(world(), motion, {
    dt: FIELD_DT,
    targetVelX: 0,
    targetVelZ: 0,
    reducedMotion: true,
  });
  motion = result.state;
  assert.equal(motion.phase, "GROUNDED");
  assert.ok(result.events.includes("dashEnded"));
});

test("A BURST IS THE SAME BURST IN A DUEL AND IN A MISSION", () => {
  // The load-bearing test. The duel drives stepMotion directly; a mission drives
  // stepFlow. Given the same burst on the same ground they must produce byte-
  // identical motion, because there is one integrator underneath both.
  const build = () => world();
  const ticks = 30;

  // Duel-style: stepMotion, feeding combat movement intent every tick.
  let duel = beginDash(runningNorth(0, 0), 0, 1, dashSpeed(RUN_SPEED));
  for (let tick = 0; tick < ticks; tick++) {
    duel = stepMotion(build(), duel, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: RUN_SPEED,
      reducedMotion: false,
    }).state;
  }

  // Mission-style: the same burst through the parkour flow controller.
  let mission = beginDash(runningNorth(0, 0), 0, 1, dashSpeed(RUN_SPEED));
  let flow = createFlowState();
  for (let tick = 0; tick < ticks; tick++) {
    const result = stepFlow(build(), mission, flow, flowInput());
    mission = result.motion;
    flow = result.flow;
  }

  assert.deepEqual(mission.pos, duel.pos);
  assert.deepEqual(mission.vel, duel.vel);
  assert.equal(mission.phase, duel.phase);
});

test("a burst covers the DISTANCE the duel tuned its dodge to", () => {
  // The tuned quantity is the distance, not the scale. The duel's dodge, its boss
  // evasion curves and its winnability table were all measured against a ~2.22 m
  // burst, so that is what this pins — and pinning the distance is what catches a
  // change to the velocity profile, which pinning the scale did not.
  //
  // The scale fell from 2.6 to 1.45 when `beginDash` started setting velocity
  // outright instead of accelerating into it: the same 2.6 stretched the burst to
  // 3.99 m. Snappier onset, same reach.
  // Measured to the moment the window closes, not beyond it: velocity deliberately
  // survives a burst, so a longer sample measures the coast as well as the burst.
  const burstTicks = Math.ceil(DASH_DURATION_MS / 1000 / FIELD_DT);
  const { motion } = dashFor(world(), burstTicks);
  assert.equal(isDashing(motion), false, "the window has closed, so this is full reach");
  assert.ok(
    Math.abs(motion.pos.z - 2.22) < 0.05,
    `a standing burst covered ${motion.pos.z.toFixed(3)} m, expected ~2.22 m`,
  );

  assert.equal(DASH_SPEED_SCALE, 1.45);
  assert.equal(DASH_DURATION_MS, 320);
  assert.equal(dashSpeed(RUN_SPEED), RUN_SPEED * 1.45);
  assert.equal(dashSpeed(10, 2), 20);
});

// ---------------------------------------------------------------------------
// PRIMITIVE 2 — segment vs actor
// ---------------------------------------------------------------------------

const STANDING_BODY: Vec3 = { x: 0, y: 0, z: 5 };

test("a flat segment at chest height hits a standing body", () => {
  const chest = chestHeight(STAND_HEIGHT);
  const hit = segmentHitsCapsule(
    { x: 0, y: chest, z: 0 },
    { x: 0, y: chest, z: 10 },
    STANDING_BODY,
    STAND_HEIGHT,
  );
  assert.ok(hit, "a shot down the middle connects");
  assert.ok(Math.abs(hit!.t - 0.5) < 1e-9, "closest approach is at the body");
  assert.equal(hit!.distanceSq, 0);
});

function chestHeight(capsule: number): number {
  return capsule * CHEST_HEIGHT_FRACTION;
}

test("a segment past the body's shoulder misses", () => {
  const chest = chestHeight(STAND_HEIGHT);
  const grazing = segmentHitsCapsule(
    { x: CAPSULE_RADIUS - 0.02, y: chest, z: 0 },
    { x: CAPSULE_RADIUS - 0.02, y: chest, z: 10 },
    STANDING_BODY,
    STAND_HEIGHT,
  );
  assert.ok(grazing, "just inside the radius still connects");
  const clean = segmentHitsCapsule(
    { x: CAPSULE_RADIUS + 0.02, y: chest, z: 0 },
    { x: CAPSULE_RADIUS + 0.02, y: chest, z: 10 },
    STANDING_BODY,
    STAND_HEIGHT,
  );
  assert.equal(clean, null, "just outside it does not");
});

test("A SHOT AIMED AT A STANDING CHEST PASSES OVER A CROUCHED BODY", () => {
  // The reason the landmarks and this query belong to the same body model. The
  // aim point comes from the shared model; the pass-over is decided by the same
  // model's capsule height. Crouching therefore means one thing everywhere.
  const aimedAt = chestPosition({ pos: STANDING_BODY, capsuleHeight: STAND_HEIGHT });
  const shot = {
    a: { x: 0, y: aimedAt.y, z: 0 },
    b: { x: 0, y: aimedAt.y, z: 10 },
  };
  assert.ok(
    segmentHitsCapsule(shot.a, shot.b, STANDING_BODY, STAND_HEIGHT),
    "it hits the body it was aimed at",
  );
  assert.equal(
    segmentHitsCapsule(shot.a, shot.b, STANDING_BODY, CROUCH_HEIGHT),
    null,
    "and passes over the same body once it has dropped below the aim line",
  );
});

test("a descending segment catches a body on the way down", () => {
  // A thrown object is not a flat line, so the vertical band has to be resolved
  // across the segment rather than guessed from an endpoint.
  const hit = segmentHitsCapsule(
    { x: 0, y: 4, z: 0 },
    { x: 0, y: 0.2, z: 6 },
    STANDING_BODY,
    STAND_HEIGHT,
  );
  assert.ok(hit, "the descent passes through the body's band at the body");
  assert.ok(hit!.t > 0 && hit!.t < 1);
});

test("a shallower descent passes over the same body", () => {
  // The same start point, thrown further: by the time it drops into the body's
  // band it is already past them. Aiming a throw is therefore a real skill.
  assert.equal(
    segmentHitsCapsule(
      { x: 0, y: 4, z: 0 },
      { x: 0, y: 0.2, z: 10 },
      STANDING_BODY,
      STAND_HEIGHT,
    ),
    null,
  );
});

test("a segment entirely above or below a body misses it", () => {
  assert.equal(
    segmentHitsCapsule(
      { x: 0, y: 3, z: 0 },
      { x: 0, y: 3, z: 10 },
      STANDING_BODY,
      STAND_HEIGHT,
    ),
    null,
  );
  assert.equal(
    segmentHitsCapsule(
      { x: 0, y: -1, z: 0 },
      { x: 0, y: -1, z: 10 },
      STANDING_BODY,
      STAND_HEIGHT,
    ),
    null,
  );
});

test("a degenerate segment is handled rather than dividing by zero", () => {
  const point = { x: 0, y: 1, z: 5 };
  const hit = segmentHitsCapsule(point, point, STANDING_BODY, STAND_HEIGHT);
  assert.ok(hit);
  assert.ok(Number.isFinite(hit!.t));
  assert.ok(Number.isFinite(hit!.distanceSq));
});

test("actors are not blockers: they never occlude a sightline", () => {
  // The whole reason this query has to exist. A body between two points does not
  // appear in the CollisionWorld, so the world query is blind to it by design.
  const empty = world();
  const eye = { x: 0, y: 1.4, z: 0 };
  const target = { x: 0, y: 1.4, z: 10 };
  assert.equal(
    segmentClear(empty, eye, target),
    true,
    "a body standing in the middle does not block line of sight",
  );
  assert.ok(
    segmentHitsCapsule(eye, target, STANDING_BODY, STAND_HEIGHT),
    "but a projectile along that same line does hit it",
  );
});

test("the nearest actor along the segment is the one that is hit", () => {
  const actors = [
    { id: "far", pos: { x: 0, y: 0, z: 8 }, capsuleHeight: STAND_HEIGHT },
    { id: "near", pos: { x: 0, y: 0, z: 3 }, capsuleHeight: STAND_HEIGHT },
  ];
  const chest = chestHeight(STAND_HEIGHT);
  const struck = firstActorHit(
    { x: 0, y: chest, z: 0 },
    { x: 0, y: chest, z: 12 },
    actors,
  );
  assert.equal(struck?.actor.id, "near");
  assert.equal(
    firstActorHit({ x: 5, y: chest, z: 0 }, { x: 5, y: chest, z: 12 }, actors),
    null,
  );
});

test("the actor radius defaults to the shared capsule radius", () => {
  const chest = chestHeight(STAND_HEIGHT);
  const atRadius = segmentHitsCapsule(
    { x: CAPSULE_RADIUS, y: chest, z: 0 },
    { x: CAPSULE_RADIUS, y: chest, z: 10 },
    STANDING_BODY,
    STAND_HEIGHT,
  );
  assert.ok(atRadius, "contact is closed at exactly the radius");
  assert.equal(
    segmentHitsCapsule(
      { x: CAPSULE_RADIUS, y: chest, z: 0 },
      { x: CAPSULE_RADIUS, y: chest, z: 10 },
      STANDING_BODY,
      STAND_HEIGHT,
      CAPSULE_RADIUS - 0.05,
    ),
    null,
    "a narrower explicit radius misses",
  );
});

// ---------------------------------------------------------------------------
// PRIMITIVE 3 — body landmarks
// ---------------------------------------------------------------------------

test("the body model is five numbers describing one capsule", () => {
  assert.equal(CAPSULE_RADIUS, 0.35);
  assert.equal(STAND_HEIGHT, 1.55);
  assert.equal(CROUCH_HEIGHT, 0.98);
  assert.equal(EYE_HEIGHT_FRACTION, 0.92);
  assert.equal(CHEST_HEIGHT_FRACTION, 0.72);
});

test("landmarks are fractions of the live capsule, never absolute metres", () => {
  const feet = { x: 1, y: 2, z: 3 };
  const standing = eyePosition({ pos: feet, capsuleHeight: STAND_HEIGHT });
  const crouched = eyePosition({ pos: feet, capsuleHeight: CROUCH_HEIGHT });
  assert.equal(standing.y, 2 + STAND_HEIGHT * EYE_HEIGHT_FRACTION);
  assert.equal(crouched.y, 2 + CROUCH_HEIGHT * EYE_HEIGHT_FRACTION);
  assert.ok(crouched.y < standing.y);
  // Landmarks track x/z exactly: a landmark is on the body, not near it.
  assert.equal(standing.x, feet.x);
  assert.equal(standing.z, feet.z);
});

test("the chest is below the eyes and both are inside the body", () => {
  const pose = { pos: { x: 0, y: 0, z: 0 }, capsuleHeight: STAND_HEIGHT };
  const eye = eyePosition(pose);
  const chest = chestPosition(pose);
  assert.ok(chest.y < eye.y);
  assert.ok(eye.y < STAND_HEIGHT);
  assert.ok(chest.y > 0);
});

test("MotionState is a body pose, with no adapter in between", () => {
  // The point of putting landmarks on the shared body model: a MotionState is
  // structurally a BodyPose, so the duel, the stealth field and a renderer all
  // read the same two numbers off the same object.
  const motion = runningNorth(0, 0);
  assert.deepEqual(eyePosition(motion), {
    x: motion.pos.x,
    y: motion.pos.y + motion.capsuleHeight * EYE_HEIGHT_FRACTION,
    z: motion.pos.z,
  });
  assert.deepEqual(chestPosition(motion), {
    x: motion.pos.x,
    y: motion.pos.y + motion.capsuleHeight * CHEST_HEIGHT_FRACTION,
    z: motion.pos.z,
  });
});

test("stance has one source of truth: the capsule", () => {
  assert.equal(isCrouched(STAND_HEIGHT), false);
  assert.equal(isCrouched(CROUCH_HEIGHT), true);
  const motion = runningNorth(0, 0);
  assert.equal(isCrouched(motion.capsuleHeight), false);
});

// ---------------------------------------------------------------------------
// The standing requirement: exactly one of each core
// ---------------------------------------------------------------------------

test("the engine defines each core exactly once", () => {
  // Parkour, the duel and PvP all run on these. A second definition of any of
  // them is the failure mode this guard exists to catch, because it would not
  // break a test on the day it was added — it would drift, and then two systems
  // would disagree about how far a body can jump.
  const engineSrc = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };
  walk(engineSrc);

  const singletons: Record<string, RegExp> = {
    "fixed-step clock": /^export const FIELD_TICK_HZ\s*=/m,
    "seeded RNG": /^export function fieldRandom\s*\(/m,
    "motion integrator": /^export function stepMotion\s*\(/m,
    "collision world": /^export interface CollisionWorld\s*\{/m,
    gravity: /^export const GRAVITY\s*=/m,
    "capsule radius": /^export const CAPSULE_RADIUS\s*=/m,
    "eye landmark": /^export const EYE_HEIGHT_FRACTION\s*=/m,
    "chest landmark": /^export const CHEST_HEIGHT_FRACTION\s*=/m,
    "body pose": /^export interface BodyPose\s*\{/m,
    "burst phase entry": /^export function beginDash\s*\(/m,
    "actor query": /^export function segmentHitsCapsule\s*\(/m,
  };

  for (const [name, pattern] of Object.entries(singletons)) {
    const defining = files.filter((file) =>
      pattern.test(readFileSync(file, "utf8")),
    );
    assert.equal(
      defining.length,
      1,
      `${name} must be defined exactly once, found ${defining.length}: ${defining
        .map((file) => file.slice(engineSrc.length))
        .join(", ")}`,
    );
  }

  // And no live RNG anywhere in the engine: determinism is not optional.
  const usingMathRandom = files.filter((file) =>
    /Math\.random\s*\(/.test(
      readFileSync(file, "utf8").replace(/\/\/[^\n]*/g, ""),
    ),
  );
  assert.deepEqual(usingMathRandom, [], "gameplay must draw from fieldRandom");
});
