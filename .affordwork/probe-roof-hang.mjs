// Repro for the owner's soft-lock: "randomly teleported to this interaction and
// nothing is happening." Hypothesis: the encounter trigger's proximity test is
// XZ-only, so standing on the COBBLES directly beneath the meeting-house roof is
// inside a 3.6m radius of a trigger authored 8.2m overhead. It arms from below,
// the speaker is 8.2m up and can never close, and the machine sits in APPROACH
// forever (locomotion locked, world clock still running -> mission times out).
//
// Drives the REAL compiled M1 world and the REAL BILLMAN_HOLLIS sim pose.
//   node .affordwork/probe-roof-hang.mjs
import { compileLevel } from "../packages/mission-m1/src/compile.ts";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";
import { watcherPosesAtTick } from "../packages/mission-m1/src/runtime.ts";
import { encounterById } from "../packages/mission-m1/src/encounters/bank.ts";
import { selectEncounterVariant } from "../packages/mission-m1/src/encounters/select.ts";
import {
  createEncounterInstance,
  stepEncounter,
} from "../packages/mission-m1/src/encounters/machine.ts";
import { FIELD_TICK_HZ } from "../packages/engine-world/src/fieldSimulation.ts";

const { world } = compileLevel(M1_EFFIGY_RUN);
const DT = 1 / FIELD_TICK_HZ;
const SEED = "0123456789abcdef0123456789abcdef";
const def = encounterById("ROPEWALK_STOP");

function actorPoses(tick) {
  return watcherPosesAtTick(tick, 0).map((p) => ({
    id: p.id,
    pos: p.position,
    yaw: p.baseYaw,
  }));
}
const billman = actorPoses(0).find((p) => p.id === "BILLMAN_HOLLIS");
console.log("trigger.at", JSON.stringify(def.trigger.at), "radius", def.trigger.radiusM);
console.log("BILLMAN_HOLLIS sim pose", JSON.stringify(billman.pos));
console.log(
  "requiresGroundedApproach", def.trigger.requiresGroundedApproach, "\n",
);

function driveFrom(label, playerPos) {
  const variant = selectEncounterVariant(def, SEED, 1);
  const inst = createEncounterInstance(def, variant);
  const mk = (tick) => ({
    world,
    tick,
    player: { pos: playerPos, grounded: true },
    actorPoses: actorPoses(tick),
    dt: DT,
    submit: false,
    verdict: null,
    dismiss: false,
  });
  let r = stepEncounter(inst, mk(0));
  const armedPhase = inst.phase;
  let tick = 1;
  let openedTick = null;
  let releasedTick = null;
  while (tick < 2400) {
    r = stepEncounter(inst, mk(tick));
    if (r.phase === "QUESTION" && openedTick === null) openedTick = tick;
    if (r.phase === "RELEASED" && releasedTick === null) releasedTick = tick;
    if (openedTick !== null || releasedTick !== null) break;
    tick += 1;
  }
  const spk = inst.actors.find((a) => a.kind === "SPEAKER");
  const gapXZ = spk ? Math.hypot(spk.pos.x - playerPos.x, spk.pos.z - playerPos.z) : NaN;
  const gap3D = spk
    ? Math.hypot(spk.pos.x - playerPos.x, spk.pos.y - playerPos.y, spk.pos.z - playerPos.z)
    : NaN;
  console.log(`--- ${label} @ ${JSON.stringify(playerPos)} ---`);
  console.log(`  armed to: ${armedPhase}`);
  console.log(`  finalPhase after ${tick} ticks (${(tick / FIELD_TICK_HZ).toFixed(1)}s): ${inst.phase}`);
  console.log(`  QUESTION opened: ${openedTick === null ? "NEVER (soft-lock)" : `tick ${openedTick}`}`);
  console.log(`  speaker settled at: ${spk ? JSON.stringify({x:+spk.pos.x.toFixed(2),y:+spk.pos.y.toFixed(2),z:+spk.pos.z.toFixed(2)}) : "none"}`);
  console.log(`  speaker gap: XZ=${gapXZ.toFixed(2)}m  3D=${gap3D.toFixed(2)}m`);
  console.log(`  locksLocomotion=${r.locksLocomotion} ownsInput=${r.ownsInput} freezeTime=${r.freezeTime}\n`);
  return { armedPhase, opened: openedTick !== null };
}

console.log("================ THE BUG: arm from the cobbles below ================");
// Several spots on the cobbles inside the height-blind XZ radius. Some open the
// question with the speaker absurdly overhead (3D gap ~8m); others never let him
// reach the 2.2m XZ gate and sit in APPROACH forever (the screenshot's hang).
for (const [dx, dz, label] of [
  [0, 0, "under trigger"],
  [-2.0, 0, "cobbles W of trigger"],
  [0, -2.0, "cobbles N of trigger"],
  [-1.5, -1.5, "cobbles NW of trigger"],
  [1.5, 1.5, "cobbles SE of trigger"],
]) {
  driveFrom(`COBBLES ${label} (y=0)`, {
    x: def.trigger.at[0] + dx,
    y: 0,
    z: def.trigger.at[2] + dz,
  });
}

console.log("================ CONTROL: arm on the roof itself ================");
driveFrom("ON THE ROOF (y=8.2)", { x: def.trigger.at[0], y: def.trigger.at[1], z: def.trigger.at[2] });
