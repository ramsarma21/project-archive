// Non-penetration invariant fuzzer against the REAL compiled M1 world, driven
// through the production stepFlow at FIELD_DT (the exact per-tick physics the
// browser runs). Seeded, reproducible. Measures END-OF-TICK penetration DEPTH
// so genuine embeds are separated from sub-skin grazes, and reports the worst.

import { compileLevel } from "./src/compile.js";
import { M1_EFFIGY_RUN } from "./src/level/index.js";
import {
  createGroundedState,
  RUN_SPEED,
  WALK_SPEED,
  STEP_UP,
} from "@pa/engine-world/playerMotion";
import {
  supportBelow,
  positionClear,
  blockerIdsAt,
  lowStepIds,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  CONTACT_EPS,
} from "@pa/engine-world/collision";
import { createFlowState, stepFlow } from "@pa/engine-world/parkour";
import { FIELD_DT } from "@pa/engine-world/fieldSimulation";

const { world } = compileLevel(M1_EFFIGY_RUN);
const B = world.bounds;
const blockerById = new Map(world.blockers.map((b) => [b.id, b]));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

function allowedIntrusions(motion) {
  const ids = new Set();
  const low = lowStepIds(world, motion.pos.x, motion.pos.z, CAPSULE_RADIUS, motion.pos.y, STEP_UP);
  if (low) for (const id of low) ids.add(id);
  const action = motion.action;
  if (action && action.ignore) for (const id of action.ignore) ids.add(id);
  return ids;
}

// How far a body at pos is inside `blocker`, found by shrinking the test radius
// until it no longer intrudes. Works for AABB / OBB / capsule footprints.
function depthInside(id, pos, height) {
  const b = blockerById.get(id);
  if (!b) return 0;
  let lo = 0, hi = CAPSULE_RADIUS;
  const inAt = (r) => blockerIdsAt(world, pos, r, height).includes(id);
  if (!inAt(CAPSULE_RADIUS)) return 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inAt(mid)) hi = mid; else lo = mid;
  }
  return CAPSULE_RADIUS - lo; // how much of the radius is buried past the face
}

// End-of-tick: is a deck plane strictly inside the standing capsule span AND
// does the capsule disc (radius) overlap it? Persistent torso-through-a-deck.
// Returns { id, centerInside } so an edge graze (only the radius clips the
// boards) is distinguished from a true pass-through (the centre is under it).
function deckThroughCapsule(pos, height, ignore) {
  for (const p of world.platforms) {
    if (ignore.has(p.id)) continue;
    if (p.y <= pos.y + CONTACT_EPS) continue;
    if (p.y >= pos.y + height - CONTACT_EPS) continue;
    const dx = Math.max(p.minX - pos.x, 0, pos.x - p.maxX);
    const dz = Math.max(p.minZ - pos.z, 0, pos.z - p.maxZ);
    if (dx * dx + dz * dz <= CAPSULE_RADIUS * CAPSULE_RADIUS) {
      const centerInside = dx === 0 && dz === 0;
      return { id: p.id, centerInside };
    }
  }
  return null;
}

const DEPTH_EPS = 0.01; // ignore <1cm skin-level readings
const embeds = new Map(); // id -> {count, maxDepth, sample}
const deckThru = new Map(); // id -> {count, sample}
let embedTicks = 0;
let deckTicks = 0;
let deckCenterTicks = 0;

function bump(map, id, motion, depth) {
  let e = map.get(id);
  if (!e) { e = { count: 0, maxDepth: 0, sample: null }; map.set(id, e); }
  e.count += 1;
  if (depth > e.maxDepth) {
    e.maxDepth = depth;
    e.sample = {
      verb: motion.action ? motion.action.kind : motion.phase,
      phase: motion.phase,
      grounded: motion.grounded,
      pos: { x: +motion.pos.x.toFixed(2), y: +motion.pos.y.toFixed(2), z: +motion.pos.z.toFixed(2) },
      speed: +Math.hypot(motion.vel.x, motion.vel.z).toFixed(2),
    };
  }
}

function runSession(seed, ticks) {
  const rand = rng(seed);
  let start = null;
  for (let tries = 0; tries < 40 && !start; tries++) {
    const x = B.minX + rand() * (B.maxX - B.minX);
    const z = B.minZ + rand() * (B.maxZ - B.minZ);
    for (const probeY of [0.05, 1.0, 1.9, 3.2, 6, 9]) {
      const sup = supportBelow(world, x, z, probeY + 0.05, 0.1);
      if (sup) {
        const pos = { x, y: sup.y, z };
        if (positionClear(world, pos, CAPSULE_RADIUS, STAND_HEIGHT)) { start = pos; break; }
      }
    }
  }
  if (!start) return;

  let motion = createGroundedState(start, rand() * Math.PI * 2);
  let flow = createFlowState();
  let dir = rand() * Math.PI * 2, sprint = true, crouch = false;

  for (let tick = 0; tick < ticks; tick++) {
    if (tick % Math.floor(4 + rand() * 20) === 0) {
      dir = rand() * Math.PI * 2; sprint = rand() < 0.7; crouch = rand() < 0.15;
    }
    const speed = crouch ? WALK_SPEED : RUN_SPEED;
    const res = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: Math.sin(dir) * speed,
      targetVelZ: Math.cos(dir) * speed,
      sprintHeld: sprint,
      crouchHeld: crouch,
      jumpBuffered: rand() < 0.06,
      dashBuffered: rand() < 0.04,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    });
    motion = res.motion;
    flow = res.flow;
    if (motion.pos.y < -20) return;

    const ignore = allowedIntrusions(motion);
    const ids = blockerIdsAt(world, motion.pos, CAPSULE_RADIUS, motion.capsuleHeight, ignore);
    let embeddedThisTick = false;
    for (const id of ids) {
      const d = depthInside(id, motion.pos, motion.capsuleHeight);
      if (d > DEPTH_EPS) { bump(embeds, id, motion, d); embeddedThisTick = true; }
    }
    if (embeddedThisTick) embedTicks += 1;

    const through = deckThroughCapsule(motion.pos, motion.capsuleHeight, ignore);
    if (through) {
      bump(deckThru, through.centerInside ? `${through.id}*CENTER` : through.id, motion, motion.pos.y);
      deckTicks += 1;
      if (through.centerInside) deckCenterTicks += 1;
    }
  }
}

const SESSIONS = Number(process.argv[2] ?? 4000);
const TICKS = Number(process.argv[3] ?? 700);
for (let s = 1; s <= SESSIONS; s++) runSession(s, TICKS);

console.log(`sessions=${SESSIONS} ticksEach=${TICKS}`);
console.log(`embedTicks=${embedTicks} deckThroughTicks=${deckTicks} deckCenterInsideTicks=${deckCenterTicks}`);
console.log("\n== EMBEDDED in solid blocker (depth > 1cm), by collider ==");
for (const [id, e] of [...embeds.entries()].sort((a, b) => b[1].maxDepth - a[1].maxDepth)) {
  console.log(`  ${id}: ticks=${e.count} maxDepth=${e.maxDepth.toFixed(3)}m ${JSON.stringify(e.sample)}`);
}
console.log("\n== TORSO THROUGH DECK at end of tick, by deck ==");
for (const [id, e] of [...deckThru.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${id}: ticks=${e.count} ${JSON.stringify(e.sample)}`);
}
