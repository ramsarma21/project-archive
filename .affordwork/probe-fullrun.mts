import { FIELD_DT, createGroundedState, groundedSupport } from "../packages/engine-world/src/index.js";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/index.js";
import { M1_MISSION_ID, m1Instance } from "../apps/web/src/chapter/m1Mission.js";
import {
  createMissionRuntime,
  markRead,
  standingObjective,
  stepMissionRuntime,
} from "../apps/web/src/mission/traversal.js";

const instance = m1Instance({ missionId: M1_MISSION_ID, attemptOrdinal: 1, seed: 0xb057, Scenery: null });
const runtime: any = createMissionRuntime({ instance, seed: 0xb057 });
const world = runtime.instance.world;

const startId = process.env.START ?? "A_START";
const towardId = process.env.TOWARD ?? "A_SHEETS";
const start = M1_EFFIGY_RUN.nodes.find((n) => n.id === startId)!;
const sheets = M1_EFFIGY_RUN.nodes.find((n) => n.id === towardId)!;
runtime.motion = createGroundedState({ x: start.pos[0], y: start.pos[1], z: start.pos[2] }, Math.atan2(sheets.pos[0]-start.pos[0], sheets.pos[2]-start.pos[2]));

// isolate encounters: mark them resolved so they don't lock the headless run
for (const enc of runtime.encounters ?? []) { enc.phase = "RELEASED"; }

let pendingJump = false, jumpCooldown = 0, stall = 0, maxStall = 0;
let prev = { x: runtime.motion.pos.x, z: runtime.motion.pos.z };
let lastLog = -1;
let maxX = -Infinity, stuckAt: any = null;
for (let f = 0; f < 170 * 60; f++) {
  const standing = standingObjective(runtime);
  let moveX = 0, moveZ = 1;
  let markId = "none";
  if (standing) {
    const mark = markRead(standing.objective, runtime.motion.pos);
    if (mark) {
      markId = mark.pos ? `${mark.pos.x.toFixed(0)},${mark.pos.z.toFixed(0)}` : "?";
      const dx = mark.pos.x - runtime.motion.pos.x, dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) { moveX = dx/len; moveZ = dz/len; }
    }
  }
  const gv = standing?.objective.mark?.gateway?.()?.allowedVerbs ?? null;
  const forbidJump = gv !== null && !gv.includes("JUMP") && !gv.includes("JUMP_GAP");
  const pv = runtime.flow.previewVerb;
  const leap = pv === "JUMP" || pv === "JUMP_GAP" || pv === "DASH_JUMP";
  if (runtime.motion.grounded && leap && jumpCooldown === 0 && !forbidJump) { pendingJump = true; jumpCooldown = 12; }
  if (jumpCooldown > 0) jumpCooldown--;
  const step = stepMissionRuntime(runtime, { dtS: FIELD_DT, moveX, moveZ, sprintHeld: true, crouchHeld: false, jumpBuffered: pendingJump, reducedMotion: false, flowEnabled: true });
  if (step.jumpConsumed) pendingJump = false;
  const p = runtime.motion.pos;
  const support = runtime.motion.grounded ? (groundedSupport(world, p)?.id ?? null) : null;
  const moved = Math.hypot(p.x - prev.x, p.z - prev.z);
  if (step.steps > 0) { if (moved < 0.002) stall += step.steps; else stall = 0; }
  if (stall > maxStall) { maxStall = stall; }
  prev = { x: p.x, z: p.z };
  if (p.x > maxX) maxX = p.x;
  if (f % 60 === 0 || stall === 60) {
    console.log(`t=${(f/60).toFixed(0)}s pos=[${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}] sup=${support} verb=${runtime.flow.verb} preview=${pv} mark=${markId} stall=${(stall/60).toFixed(1)}s`);
  }
  if (stall > 60 && !stuckAt) { stuckAt = { t: (f/60).toFixed(1), pos: {...p}, support, verb: runtime.flow.verb, mark: markId }; }
  if (runtime.outcome) { console.log(`OUTCOME @${(f/60).toFixed(1)}s: ${JSON.stringify(runtime.outcome).slice(0,120)}`); break; }
}
console.log(`\nmaxX=${maxX.toFixed(1)} maxStall=${(maxStall/60).toFixed(1)}s`);
if (stuckAt) console.log(`FIRST STUCK >1s: ${JSON.stringify(stuckAt)}`);
