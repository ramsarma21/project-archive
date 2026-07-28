// Drive the AUTHORED GROUND STREET LINE explicitly (bypassing SAFE guidance,
// which diverts up onto the canopies) to test whether a normal player can run
// the Shambles at street level without climbing on props. Steers node-to-node,
// crouches under the hoist, consents to the barrel vault. Reports penetration,
// stalls, and whether it reaches B_EXIT staying grounded on GROUND the whole way.
import { FIELD_DT, RUN_SPEED, WALK_SPEED, createGroundedState, groundedSupport } from "@pa/engine-world";
import { CAPSULE_RADIUS, STAND_HEIGHT, positionClear } from "@pa/engine-world/collision";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";

const APP = "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/src";
const { M1_MISSION_ID, m1Instance } = await import(`${APP}/chapter/m1Mission.ts`);
const { createMissionRuntime, stepMissionRuntime } = await import(`${APP}/mission/traversal.ts`);
const { resolveEncountersForTraversal } = await import(
  "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/test/traversalEncounters.ts"
);

const nodePos = (id) => { const n = M1_EFFIGY_RUN.nodes.find((n) => n.id === id); if (!n) throw new Error(`no node ${id}`); return { x: n.pos[0], y: n.pos[1], z: n.pos[2] }; };

function kerbIds(world) {
  const ids = new Set();
  for (const b of world.blockers) if (b.landable && Number.isFinite(b.topY) && b.topY - b.baseY <= 0.5) ids.add(b.id);
  return ids;
}

const instance = m1Instance({ missionId: M1_MISSION_ID, attemptOrdinal: 1, seed: 0xb057, Scenery: null });
const runtime = createMissionRuntime({ instance, seed: 0xb057 });
resolveEncountersForTraversal(runtime);
const world = runtime.instance.world;
const kerbs = kerbIds(world);

// Start at B_STREET_W, on the ground, facing east.
const start = nodePos("B_STREET_W");
runtime.motion = createGroundedState({ x: start.x, y: 0, z: start.z }, Math.PI / 2);

const WAYPOINTS = ["B_VAULT_IN", "B_VAULT_OUT", "B_DUCK", "B_STREET_MID", "B_STREET_E", "B_EXIT"].map((id) => ({ id, pos: nodePos(id) }));
let wp = 0;
let pendingJump = false, jumpCooldown = 0, stall = 0, maxStall = 0;
let prev = { ...runtime.motion.pos };
const penetrations = [];
const offGround = [];      // ticks where support is not GROUND (climbing on a prop)
const milestones = [];
let lastSupport = null;
const trace = [];

for (let tick = 0; tick < 60 * 60; tick++) {
  const target = WAYPOINTS[wp];
  const p = runtime.motion.pos;
  const dx = target.pos.x - p.x, dz = target.pos.z - p.z;
  const len = Math.hypot(dx, dz);
  const moveX = len > 1e-4 ? dx / len : 0;
  const moveZ = len > 1e-4 ? dz / len : 1;
  // Crouch through the duck-under segment (between B_DUCK and B_STREET_MID).
  const crouch = p.x >= 24.8 && p.x <= 28.6;
  // Consent to a previewed vault/leap.
  const preview = runtime.flow.previewVerb;
  const wantJump = preview === "JUMP" || preview === "JUMP_GAP" || preview === "LEAP_OF_FAITH";
  if (runtime.motion.grounded && wantJump && jumpCooldown === 0) { pendingJump = true; jumpCooldown = 12; }
  if (jumpCooldown > 0) jumpCooldown -= 1;

  const step = stepMissionRuntime(runtime, {
    dtS: FIELD_DT, moveX, moveZ, sprintHeld: !crouch, crouchHeld: crouch,
    jumpBuffered: pendingJump, reducedMotion: false, flowEnabled: true,
  });
  if (step.jumpConsumed) pendingJump = false;

  const np = runtime.motion.pos;
  const support = runtime.motion.grounded ? (groundedSupport(world, np)?.id ?? "GROUND") : null;
  if (support && support !== lastSupport) { milestones.push({ tick, x: +np.x.toFixed(1), z: +np.z.toFixed(1), support, verb: runtime.flow.verb }); lastSupport = support; }
  if (runtime.motion.grounded && support && support !== "GROUND" && !support.startsWith("PUMP")) offGround.push({ tick, x: +np.x.toFixed(1), support });

  if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
    if (!positionClear(world, np, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) penetrations.push({ tick, x: +np.x.toFixed(2), z: +np.z.toFixed(2), support });
  }

  const moved = Math.hypot(np.x - prev.x, np.z - prev.z);
  if (step.steps > 0) stall = moved < 0.002 ? stall + step.steps : 0;
  if (stall > maxStall) maxStall = stall;
  prev = { ...np };

  // advance waypoint
  if (Math.hypot(np.x - target.pos.x, np.z - target.pos.z) < 0.7) {
    milestones.push({ tick, reached: target.id, x: +np.x.toFixed(1), z: +np.z.toFixed(1) });
    if (wp === WAYPOINTS.length - 1) { console.log(`REACHED B_EXIT @tick ${tick} (${(tick/60).toFixed(1)}s)`); break; }
    wp++;
  }
  if (stall > 5 * 60) { console.log(`STALL ${(stall/60).toFixed(1)}s @tick ${tick} pos=${JSON.stringify({x:+np.x.toFixed(2),z:+np.z.toFixed(2)})} support=${support} targeting=${target.id} verb=${runtime.flow.verb} preview=${runtime.flow.previewVerb}`); break; }
  if (runtime.outcome) { console.log(`OUTCOME ${runtime.outcome.kind}`); break; }
}

const p = runtime.motion.pos;
console.log("final:", JSON.stringify({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }), "wp reached:", wp, "of", WAYPOINTS.length);
console.log("max stall:", (maxStall/60).toFixed(2), "s   penetrations:", penetrations.length, penetrations.slice(0,4));
console.log("off-GROUND ticks (climbed a prop):", offGround.length, offGround.slice(0,6));
console.log("milestones:");
for (const m of milestones) console.log("  ", JSON.stringify(m));
