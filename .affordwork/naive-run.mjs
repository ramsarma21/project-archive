// Model a NAIVE player on the Shambles ground: hold sprint toward a distant
// target (not threading authored nodes), and see where the tight lane wedges
// them. This is the owner's actual experience. Several steering styles.
import { FIELD_DT, RUN_SPEED, createGroundedState, groundedSupport } from "@pa/engine-world";
import { CAPSULE_RADIUS, STAND_HEIGHT, positionClear } from "@pa/engine-world/collision";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";

const APP = "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/src";
const { M1_MISSION_ID, m1Instance } = await import(`${APP}/chapter/m1Mission.ts`);
const { createMissionRuntime, stepMissionRuntime } = await import(`${APP}/mission/traversal.ts`);
const { resolveEncountersForTraversal } = await import(
  "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/test/traversalEncounters.ts"
);
const nodePos = (id) => { const n = M1_EFFIGY_RUN.nodes.find((n) => n.id === id); return { x: n.pos[0], y: n.pos[1], z: n.pos[2] }; };
function kerbIds(world) { const s = new Set(); for (const b of world.blockers) if (b.landable && Number.isFinite(b.topY) && b.topY - b.baseY <= 0.5) s.add(b.id); return s; }

function run({ startId, targetId, crouchNearDuck, autoJump, label }) {
  const instance = m1Instance({ missionId: M1_MISSION_ID, attemptOrdinal: 1, seed: 0xb057, Scenery: null });
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  resolveEncountersForTraversal(runtime);
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const s = nodePos(startId), tgt = nodePos(targetId);
  runtime.motion = createGroundedState({ x: s.x, y: 0, z: s.z }, Math.atan2(tgt.x - s.x, tgt.z - s.z));

  let pendingJump = false, jumpCooldown = 0, stall = 0;
  let prev = { ...runtime.motion.pos };
  const pen = []; let firstStuck = null; let maxX = s.x;
  for (let tick = 0; tick < 30 * 60; tick++) {
    const p = runtime.motion.pos;
    const dx = tgt.x - p.x, dz = tgt.z - p.z, len = Math.hypot(dx, dz);
    const moveX = len > 1e-4 ? dx / len : 0, moveZ = len > 1e-4 ? dz / len : 1;
    const crouch = crouchNearDuck && p.x >= 24.8 && p.x <= 28.6;
    const preview = runtime.flow.previewVerb;
    if (autoJump && runtime.motion.grounded && (preview === "JUMP" || preview === "JUMP_GAP" || preview === "LEAP_OF_FAITH") && jumpCooldown === 0) { pendingJump = true; jumpCooldown = 12; }
    if (jumpCooldown > 0) jumpCooldown -= 1;
    const step = stepMissionRuntime(runtime, { dtS: FIELD_DT, moveX, moveZ, sprintHeld: !crouch, crouchHeld: crouch, jumpBuffered: pendingJump, reducedMotion: false, flowEnabled: true });
    if (step.jumpConsumed) pendingJump = false;
    const np = runtime.motion.pos;
    maxX = Math.max(maxX, np.x);
    const support = runtime.motion.grounded ? (groundedSupport(world, np)?.id ?? "GROUND") : null;
    if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0 && !positionClear(world, np, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) pen.push({ tick, x: +np.x.toFixed(2), z: +np.z.toFixed(2), support });
    const moved = Math.hypot(np.x - prev.x, np.z - prev.z);
    if (step.steps > 0) stall = moved < 0.003 ? stall + step.steps : 0;
    if (!firstStuck && stall > 60 && np.x < tgt.x - 1) firstStuck = { tick, x: +np.x.toFixed(2), y: +np.y.toFixed(2), z: +np.z.toFixed(2), support, verb: runtime.flow.verb, preview: runtime.flow.previewVerb };
    prev = { ...np };
    if (Math.hypot(np.x - tgt.x, np.z - tgt.z) < 0.8) return { label, reached: true, tick, maxX: +maxX.toFixed(2), pen: pen.length, firstStuck };
    if (stall > 6 * 60) break;
  }
  return { label, reached: false, maxX: +maxX.toFixed(2), pen: pen.length, penFirst: pen.slice(0,3), firstStuck };
}

const scenarios = [
  { label: "A: W-only, no crouch, no jump  (naive)", startId: "B_STREET_W", targetId: "B_EXIT", crouchNearDuck: false, autoJump: false },
  { label: "B: W + auto-jump, no crouch", startId: "B_STREET_W", targetId: "B_EXIT", crouchNearDuck: false, autoJump: true },
  { label: "C: W + crouch-at-duck + auto-jump", startId: "B_STREET_W", targetId: "B_EXIT", crouchNearDuck: true, autoJump: true },
  { label: "D: from past-vault, W-only no crouch", startId: "B_VAULT_OUT", targetId: "B_EXIT", crouchNearDuck: false, autoJump: false },
  { label: "E: from past-duck, W-only", startId: "B_STREET_MID", targetId: "B_EXIT", crouchNearDuck: false, autoJump: false },
];
for (const sc of scenarios) console.log(JSON.stringify(run(sc)));
