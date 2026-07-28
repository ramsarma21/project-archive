// Why does the naive straight run wedge on GAOL_BARRELS? Log flow state on
// approach for several z-lanes, and test whether an on-axis (z=-0.6) straight
// run vaults. Distinguishes an alignment problem (geometry) from a reader one.
import { FIELD_DT, createGroundedState, groundedSupport } from "@pa/engine-world";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
const APP = "/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/src";
const { M1_MISSION_ID, m1Instance } = await import(`${APP}/chapter/m1Mission.ts`);
const { createMissionRuntime, stepMissionRuntime } = await import(`${APP}/mission/traversal.ts`);
const { resolveEncountersForTraversal } = await import("/Users/ramsarma/Projects/project-archive-worktrees/mission-world/apps/web/test/traversalEncounters.ts");

function trial({ z, autoJump, label }) {
  const instance = m1Instance({ missionId: M1_MISSION_ID, attemptOrdinal: 1, seed: 0xb057, Scenery: null });
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  resolveEncountersForTraversal(runtime);
  const world = runtime.instance.world;
  runtime.motion = createGroundedState({ x: 17.8, y: 0, z }, Math.PI / 2); // face +x
  let pendingJump = false, jumpCooldown = 0;
  const log = [];
  let vaulted = false, maxX = 17.8;
  for (let tick = 0; tick < 12 * 60; tick++) {
    const p = runtime.motion.pos;
    const moveX = 1, moveZ = 0; // pure east
    const preview = runtime.flow.previewVerb;
    if (autoJump && runtime.motion.grounded && (preview === "VAULT" || preview === "JUMP" || preview === "JUMP_GAP") && jumpCooldown === 0) { pendingJump = true; jumpCooldown = 10; }
    if (jumpCooldown > 0) jumpCooldown -= 1;
    const step = stepMissionRuntime(runtime, { dtS: FIELD_DT, moveX, moveZ, sprintHeld: true, crouchHeld: false, jumpBuffered: pendingJump, reducedMotion: false, flowEnabled: true });
    if (step.jumpConsumed) pendingJump = false;
    const np = runtime.motion.pos;
    maxX = Math.max(maxX, np.x);
    if (runtime.flow.verb === "VAULT") vaulted = true;
    // Log only near the barrels (x 20.5..23.5).
    if (np.x > 20.3 && np.x < 23.6 && tick % 4 === 0) {
      log.push({ t: tick, x: +np.x.toFixed(2), z: +np.z.toFixed(2), y: +np.y.toFixed(2), g: runtime.motion.grounded, verb: runtime.flow.verb, prev: runtime.flow.previewVerb, act: runtime.motion.action?.kind ?? null, spd: +Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z).toFixed(2) });
    }
    if (np.x > 24) break;
    if (tick > 300 && maxX < 21.5) break; // wedged
  }
  return { label, z, autoJump, vaulted, maxX: +maxX.toFixed(2), reached24: maxX > 23.5, log: log.slice(0, 30) };
}

for (const t of [
  { z: -0.4, autoJump: false, label: "z=-0.4 (street node line), no jump" },
  { z: -0.4, autoJump: true, label: "z=-0.4, auto-jump on VAULT preview" },
  { z: -0.6, autoJump: false, label: "z=-0.6 (vault axis), no jump" },
  { z: -0.6, autoJump: true, label: "z=-0.6, auto-jump" },
]) {
  const r = trial(t);
  console.log(`\n=== ${r.label} ===  vaulted=${r.vaulted} maxX=${r.maxX} reached24=${r.reached24}`);
  for (const l of r.log) console.log("  ", JSON.stringify(l));
}
