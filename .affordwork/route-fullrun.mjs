// Deterministic, headless full-route driver (no browser). Reuses the exact
// link-aware controller the web tests use, but runs the WHOLE mission from spawn
// until it resolves or stalls, and reports: how far it got, every penetration,
// every stall, and every surface it stood on (so "climbing on props" is counted,
// not guessed). This is the ground truth for passability.
import { FIELD_DT, groundedSupport } from "@pa/engine-world";
import { CAPSULE_RADIUS, STAND_HEIGHT, positionClear } from "@pa/engine-world/collision";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";

const APP = "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/src";
const { M1_MISSION_ID, m1Instance } = await import(`${APP}/chapter/m1Mission.ts`);
const { createMissionRuntime, markRead, standingObjective, stepMissionRuntime } =
  await import(`${APP}/mission/traversal.ts`);
const { resolveEncountersForTraversal } = await import(
  "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/test/traversalEncounters.ts"
);

function kerbIds(world) {
  const ids = new Set();
  for (const b of world.blockers) {
    if (b.landable && Number.isFinite(b.topY) && b.topY - b.baseY <= 0.5) ids.add(b.id);
  }
  return ids;
}

const instance = m1Instance({ missionId: M1_MISSION_ID, attemptOrdinal: 1, seed: 0xb057, Scenery: null });
const runtime = createMissionRuntime({ instance, seed: 0xb057 });
resolveEncountersForTraversal(runtime);
const world = runtime.instance.world;
const kerbs = kerbIds(world);

let pendingJump = false, jumpCooldown = 0, stall = 0, maxStall = 0;
let prev = { ...runtime.motion.pos };
const supports = new Map();          // surfaceId -> ticks stood
const milestones = [];
const penetrations = [];
let lastLoggedX = -999;
let lastSupport = null;
const RUN_TICKS = 240 * 60;

for (let tick = 0; tick < RUN_TICKS; tick++) {
  let moveX = 0, moveZ = 1;
  const standing = standingObjective(runtime);
  if (standing) {
    const mark = markRead(standing.objective, runtime.motion.pos);
    if (mark) {
      const dx = mark.pos.x - runtime.motion.pos.x, dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) { moveX = dx / len; moveZ = dz / len; }
    }
  }
  const preview = runtime.flow.previewVerb;
  const leap = preview === "JUMP" || preview === "JUMP_GAP" || preview === "LEAP_OF_FAITH" || preview === "DASH_JUMP";
  if (runtime.motion.grounded && leap && jumpCooldown === 0) { pendingJump = true; jumpCooldown = 12; }
  if (jumpCooldown > 0) jumpCooldown -= 1;

  const step = stepMissionRuntime(runtime, {
    dtS: FIELD_DT, moveX, moveZ, sprintHeld: true, crouchHeld: false,
    jumpBuffered: pendingJump, reducedMotion: false, flowEnabled: true,
  });
  if (step.jumpConsumed) pendingJump = false;

  const p = runtime.motion.pos;
  const support = runtime.motion.grounded ? (groundedSupport(world, p)?.id ?? "GROUND") : null;
  if (support) { supports.set(support, (supports.get(support) ?? 0) + 1); }
  if (support && support !== lastSupport) {
    milestones.push({ tick, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), support, verb: runtime.flow.verb });
    lastSupport = support;
  }

  if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
    if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
      penetrations.push({ tick, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), support });
    }
  }

  const moved = Math.hypot(p.x - prev.x, p.z - prev.z);
  if (step.steps > 0) { stall = moved < 0.002 ? stall + step.steps : 0; }
  if (stall > maxStall) maxStall = stall;
  prev = { ...p };

  if (runtime.outcome) {
    console.log(`OUTCOME @tick ${tick}: ${runtime.outcome.kind} ${JSON.stringify(runtime.outcome.failure ?? {})}`);
    break;
  }
  // hard stall break
  if (stall > 8 * 60) {
    console.log(`HARD STALL ${(stall/60).toFixed(1)}s @tick ${tick} pos=${JSON.stringify({x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2)})} support=${support} mark=${JSON.stringify(standingObjective(runtime)?markRead(standingObjective(runtime).objective,p):null)}`);
    break;
  }
}

const p = runtime.motion.pos;
console.log("final pos:", JSON.stringify({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }), "grounded:", runtime.motion.grounded);
console.log("outcome:", runtime.outcome?.kind ?? "none (still running / stalled)");
console.log("max stall:", (maxStall / 60).toFixed(2), "s");
console.log("penetrations:", penetrations.length, penetrations.slice(0, 6));
console.log("\n--- surfaces stood on (ticks) ---");
console.log([...supports.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v/60).toFixed(1)}s`).join("  "));
console.log("\n--- milestone surface changes (first 60) ---");
for (const m of milestones.slice(0, 60)) console.log(`  t${m.tick} x${m.x} y${m.y} z${m.z} on ${m.support} (${m.verb})`);
