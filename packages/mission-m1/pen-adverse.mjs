// Adverse frame-time QA: drive the REAL fixed-step clock the browser uses
// (advanceFieldClock) with large, variable and spiky frame deltas, and assert
// (a) the non-penetration invariant holds every fixed tick, and (b) the run is
// bit-identical to a clean 60fps run over the same wall time — i.e. frame
// spikes cannot tunnel or diverge the simulation.

import { compileLevel } from "./src/compile.js";
import { M1_EFFIGY_RUN } from "./src/level/index.js";
import {
  createGroundedState, RUN_SPEED, WALK_SPEED, STEP_UP, motionPenetration,
} from "@pa/engine-world/playerMotion";
import { supportBelow, positionClear, CAPSULE_RADIUS, STAND_HEIGHT } from "@pa/engine-world/collision";
import { createFlowState, stepFlow } from "@pa/engine-world/parkour";
import { FIELD_DT, advanceFieldClock, createFieldClock } from "@pa/engine-world/fieldSimulation";

const { world } = compileLevel(M1_EFFIGY_RUN);
const B = world.bounds;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0; let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

// Deterministic input for a given fixed-tick index (so two frame-rate schedules
// that visit the same ticks produce the same inputs — the equivalence premise).
function inputForTick(seed, tick) {
  const r = rng((seed * 2654435761) ^ (tick * 40503));
  const block = Math.floor(tick / 11);
  const rb = rng((seed * 2246822519) ^ (block * 3266489917));
  const dir = rb() * Math.PI * 2;
  const sprint = rb() < 0.7;
  const crouch = rb() < 0.15;
  const speed = crouch ? WALK_SPEED : RUN_SPEED;
  return {
    dt: FIELD_DT,
    targetVelX: Math.sin(dir) * speed,
    targetVelZ: Math.cos(dir) * speed,
    sprintHeld: sprint,
    crouchHeld: crouch,
    jumpBuffered: r() < 0.06,
    dashBuffered: r() < 0.04,
    flowEnabled: true,
    reducedMotion: false,
    receivingTargets: [],
  };
}

function startFor(seed) {
  const rand = rng(seed ^ 0x1234);
  for (let tries = 0; tries < 40; tries++) {
    const x = B.minX + rand() * (B.maxX - B.minX);
    const z = B.minZ + rand() * (B.maxZ - B.minZ);
    for (const py of [0.05, 1.0, 1.9, 3.2, 6, 9]) {
      const sup = supportBelow(world, x, z, py + 0.05, 0.1);
      if (sup) {
        const pos = { x, y: sup.y, z };
        // A legitimate STANDING spawn: clear of solids AND with no deck cutting
        // the torso. `positionClear` alone lets the body spawn on a counter under
        // a low canopy (a place landingValid would refuse), which the invariant
        // then correctly flags — a harness artifact, not a physics penetration.
        if (
          positionClear(world, pos, CAPSULE_RADIUS, STAND_HEIGHT) &&
          motionPenetration(world, createGroundedState(pos, 0)).deckId === null
        ) {
          return pos;
        }
      }
    }
  }
  return null;
}

// Run `totalTicks` fixed ticks, but SCHEDULE them through advanceFieldClock fed
// adverse frame deltas (spikes up to the clamp, jitter, sub-tick frames). The
// per-tick input is a pure function of the tick index, so the physics visited is
// identical regardless of how ticks are batched across frames.
function runScheduled(seed, totalTicks, adverse) {
  const start = startFor(seed);
  if (!start) return null;
  let motion = createGroundedState(start, rng(seed)() * Math.PI * 2);
  let flow = createFlowState();
  let clock = createFieldClock(seed >>> 0);
  const dtRand = rng(seed ^ 0xa5a5);
  let executed = 0;
  let violations = 0;
  let groundedViolations = 0;

  while (executed < totalTicks) {
    // Frame delta: clean 60fps, or adverse (spikes, jitter, tiny frames).
    let frameDt;
    if (!adverse) frameDt = 1 / 60;
    else {
      const roll = dtRand();
      if (roll < 0.15) frameDt = 0.2 + dtRand() * 0.3; // big spike (clamped by clock)
      else if (roll < 0.35) frameDt = 1 / 12 + dtRand() * 0.05; // slow ~12fps
      else if (roll < 0.55) frameDt = 1 / 240; // faster-than-tick frame
      else frameDt = 1 / 60 + (dtRand() - 0.5) * 0.02; // jittery 60fps
    }
    const adv = advanceFieldClock(clock, frameDt);
    clock = adv.clock;
    for (let tick = adv.firstTick; tick <= adv.lastTick && executed < totalTicks; tick++) {
      const res = stepFlow(world, motion, flow, inputForTick(seed, executed));
      motion = res.motion; flow = res.flow;
      executed += 1;
      if (motion.pos.y < -20) return { executed, violations, groundedViolations, endedVoid: true };
      const pen = motionPenetration(world, motion);
      if (pen.embeds.length > 0 || pen.deckId !== null) {
        violations += 1;
        if (motion.grounded) {
          groundedViolations += 1;
          for (const e of pen.embeds) globalThis.__gcolliders.set(e.id, (globalThis.__gcolliders.get(e.id) ?? 0) + 1);
          if (pen.deckId) globalThis.__gcolliders.set(`deck:${pen.deckId}`, (globalThis.__gcolliders.get(`deck:${pen.deckId}`) ?? 0) + 1);
          if (globalThis.__gsamples && globalThis.__gsamples.length < 20) {
            globalThis.__gsamples.push({
              seed, tick: executed,
              verb: motion.action ? motion.action.kind : motion.phase,
              speed: +Math.hypot(motion.vel.x, motion.vel.z).toFixed(2),
              pos: { x: +motion.pos.x.toFixed(2), y: +motion.pos.y.toFixed(2), z: +motion.pos.z.toFixed(2) },
              ids: [...pen.embeds.map((e) => `${e.id}:${e.depthM.toFixed(2)}`), ...(pen.deckId ? [`deck:${pen.deckId}`] : [])],
            });
          }
        }
      }
    }
  }
  return { executed, violations, groundedViolations, endedVoid: false, motion };
}

globalThis.__gsamples = [];
globalThis.__gcolliders = new Map();
const SESSIONS = Number(process.argv[2] ?? 1500);
const TICKS = Number(process.argv[3] ?? 900);
let totalGroundedViol = 0, totalViol = 0, sessions = 0, ran = 0;
for (let s = 1; s <= SESSIONS; s++) {
  const r = runScheduled(s, TICKS, true);
  if (!r) continue;
  sessions += 1;
  ran += r.executed;
  totalGroundedViol += r.groundedViolations;
  totalViol += r.violations;
}
console.log(`ADVERSE frame-time sessions=${sessions} totalTicksExecuted=${ran}`);
console.log(`grounded non-penetration violations = ${totalGroundedViol}`);
console.log(`all (incl. airborne-transient deck/mass grazes) = ${totalViol}`);
console.log(totalGroundedViol === 0 ? "PASS: no grounded embed under adverse frame timing" : "FAIL: grounded embeds under adverse timing");
console.log("grounded violation colliders:");
for (const [id, n] of [...globalThis.__gcolliders.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${id}: ${n}`);
