import { FIELD_DT, createGroundedState, groundedSupport } from "../packages/engine-world/src/index.js";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/index.js";
import { M1_MISSION_ID, m1Instance } from "../apps/web/src/chapter/m1Mission.js";
import { createMissionRuntime, markRead, standingObjective, stepMissionRuntime } from "../apps/web/src/mission/traversal.js";

const instance = m1Instance({ missionId: M1_MISSION_ID, attemptOrdinal: 1, seed: 0xb057, Scenery: null });
const runtime: any = createMissionRuntime({ instance, seed: 0xb057 });
for (const enc of runtime.encounters ?? []) enc.phase = "RELEASED";
const world = runtime.instance.world;
const node = (id: string) => M1_EFFIGY_RUN.nodes.find((n) => n.id === id)!.pos;
const sroofE = node("D_SROOF_E");
const start = node("D_VAULT_OUT_1");
runtime.motion = createGroundedState({ x: start[0], y: start[1], z: start[2] }, Math.atan2(sroofE[0]-start[0], sroofE[2]-start[2]));
const objective = standingObjective(runtime)!.objective;
let pendingJump = false, jumpCooldown = 0, wasGrounded = true, apex = runtime.motion.pos.y, drops = 0;
for (let f = 0; f < 30*60; f++) {
  let moveX = 0, moveZ = 1;
  const mark = markRead(objective, runtime.motion.pos);
  if (mark) { const dx=mark.pos.x-runtime.motion.pos.x, dz=mark.pos.z-runtime.motion.pos.z, len=Math.hypot(dx,dz); if(len>1e-4){moveX=dx/len;moveZ=dz/len;} }
  const pv = runtime.flow.previewVerb;
  const leap = pv==="JUMP"||pv==="JUMP_GAP"||pv==="LEAP_OF_FAITH"||pv==="DASH_JUMP";
  if (runtime.motion.grounded && leap && jumpCooldown===0) { pendingJump=true; jumpCooldown=12; }
  if (jumpCooldown>0) jumpCooldown--;
  const step = stepMissionRuntime(runtime, { dtS: FIELD_DT, moveX, moveZ, sprintHeld:true, crouchHeld:false, jumpBuffered:pendingJump, reducedMotion:false, flowEnabled:true });
  if (step.jumpConsumed) pendingJump=false;
  const p = runtime.motion.pos;
  const support = groundedSupport(world, p)?.id ?? null;
  if (!runtime.motion.grounded) apex = Math.max(apex, p.y);
  if (!wasGrounded && runtime.motion.grounded && support==="HOLLIS_MEETING__ROOF" && apex>11) {
    drops++;
    console.log(`DROP ${drops} @f=${f} pos=[${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}] apex=${apex.toFixed(1)} verb=${runtime.flow.verb}`);
  }
  if (runtime.motion.grounded) apex = p.y;
  wasGrounded = runtime.motion.grounded;
  if (runtime.outcome) { console.log(`outcome @f=${f}`); break; }
}
console.log(`total drops=${drops}`);
