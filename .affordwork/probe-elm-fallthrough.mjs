// Repro for the owner's report: "on that building next to the tree when u jump u
// literally fall all the way into the ground and some interaction comes."
//
// Drives the REAL compiled M1 collision world and the REAL production solver
// (stepMotion) — collision is authored hulls, which IS the physics truth (GLBs
// are visual only). Answers, with evidence:
//   1. What does support look like at the elm base? Any coverage gap / pocket?
//   2. Jump off the boughs: where does the body actually come to rest, and is it
//      ever embedded / below the ground plane?
//   3. Which encounter (if any) arms at the landing position?
//
//   node --import tsx .affordwork/probe-elm-fallthrough.mjs
import { compileLevel } from "../packages/mission-m1/src/compile.ts";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";
import { watcherPosesAtTick } from "../packages/mission-m1/src/runtime.ts";
import { M1_ENCOUNTERS } from "../packages/mission-m1/src/encounters/bank.ts";
import { selectEncounterVariant } from "../packages/mission-m1/src/encounters/select.ts";
import {
  createEncounterInstance,
  stepEncounter,
} from "../packages/mission-m1/src/encounters/machine.ts";
import {
  supportBelow,
  capsuleEmbeddedIn,
  deckThroughBody,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
} from "../packages/engine-world/src/collision.ts";
import {
  createGroundedState,
  beginStandingJump,
  beginRunningJump,
  stepMotion,
  motionPenetration,
  RUN_SPEED,
} from "../packages/engine-world/src/playerMotion.ts";
import { FIELD_TICK_HZ } from "../packages/engine-world/src/fieldSimulation.ts";

const { world } = compileLevel(M1_EFFIGY_RUN);
const DT = 1 / FIELD_TICK_HZ;
const SEED = "0123456789abcdef0123456789abcdef";

const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

// ---- 1. collision census around the elm base -------------------------------
console.log("================ COLLISION near the elm (x 74..88) ================");
console.log("--- blockers ---");
for (const b of world.blockers) {
  if (b.maxX < 74 || b.minX > 88) continue;
  if (b.maxZ < -8 || b.minZ > 8) continue;
  console.log(
    `  ${b.id.padEnd(22)} x[${f2(b.minX)},${f2(b.maxX)}] z[${f2(b.minZ)},${f2(b.maxZ)}] baseY=${f2(b.baseY)} topY=${f2(b.topY)} landable=${b.landable}`,
  );
}
console.log("--- platforms (decks) ---");
for (const p of world.platforms) {
  if (p.maxX < 74 || p.minX > 88) continue;
  if (p.maxZ < -8 || p.minZ > 8) continue;
  console.log(
    `  ${p.id.padEnd(22)} x[${f2(p.minX)},${f2(p.maxX)}] z[${f2(p.minZ)},${f2(p.maxZ)}] y=${f2(p.y)}${p.polygon ? " (poly)" : ""}`,
  );
}

// ---- 2. support grid at ground level (find any gap/pocket) ------------------
console.log("\n================ supportBelow at foot y=0.02 over elm base ======");
console.log("(what a body arriving at the surface rests on; blank=NO SUPPORT)");
let header = "z\\x  ";
const xs = [];
for (let x = 75; x <= 87; x += 1) { xs.push(x); header += String(x).padStart(6); }
console.log(header);
for (let z = 6; z >= -6; z -= 1) {
  let row = String(z).padStart(3) + "  ";
  for (const x of xs) {
    const s = supportBelow(world, x, z, 0.02, 0.06);
    row += (s ? f2(s.y) : "----").padStart(6);
  }
  console.log(row);
}

// ---- 3. jump off the boughs, with the real solver ---------------------------
console.log("\n================ JUMP off the elm boughs (real stepMotion) ======");
function simJump(label, pos, yaw, kind, targetDir) {
  let state = createGroundedState({ x: pos[0], y: pos[1], z: pos[2] }, yaw);
  // settle one grounded tick so support resolves
  state = stepMotion(world, state, { dt: DT, targetVelX: 0, targetVelZ: 0, reducedMotion: false }).state;
  const startY = state.pos.y;
  state = kind === "run"
    ? beginRunningJump({ ...state, vel: { x: targetDir[0] * RUN_SPEED, y: 0, z: targetDir[1] * RUN_SPEED } })
    : beginStandingJump(state);
  let minY = state.pos.y;
  let worstEmbed = 0;
  let deckCut = null;
  let landedTick = null;
  for (let t = 0; t < 1200; t++) {
    const tvx = targetDir ? targetDir[0] * RUN_SPEED : 0;
    const tvz = targetDir ? targetDir[1] * RUN_SPEED : 0;
    state = stepMotion(world, state, { dt: DT, targetVelX: tvx, targetVelZ: tvz, reducedMotion: false }).state;
    minY = Math.min(minY, state.pos.y);
    const pen = motionPenetration(world, state);
    if (pen.embeds.length) worstEmbed = Math.max(worstEmbed, ...pen.embeds.map((e) => e.depthM));
    if (pen.deckId) deckCut = pen.deckId;
    if (state.grounded && landedTick === null && t > 3) { landedTick = t; break; }
  }
  const s = supportBelow(world, state.pos.x, state.pos.z, state.pos.y + 0.02, 0.06);
  console.log(
    `  ${label}: start y=${f2(startY)} -> rest (${f2(state.pos.x)},${f2(state.pos.y)},${f2(state.pos.z)}) ` +
    `on=${s ? s.id : "NONE"} minY=${f2(minY)} embed=${f2(worstEmbed)}m deckCut=${deckCut ?? "none"} ` +
    `landedTick=${landedTick} (${landedTick ? f2(landedTick * DT) : "-"}s)`,
  );
  return state.pos;
}

// The authored descent standing spots and a few edges a player would jump from.
simJump("crown F_POST straight-up", [79.6, 8.3, 0.4], 0, "stand", null);
simJump("crown F_CROWN_E run +x (off limb)", [82.6, 8.3, 2.6], Math.PI / 2, "run", [1, 0]);
simJump("crown run north (+z, toward trunk)", [80.0, 8.3, 2.0], 0, "run", [0, 1]);
simJump("crown run south off rim", [80.0, 8.3, 0.0], Math.PI, "run", [0, -1]);
simJump("low bough F_POST_STEP run west (off rim)", [79.6, 6.4, 3.8], -Math.PI / 2, "run", [-1, 0]);
simJump("awning F_AWNING run west off edge", [77.0, 3.2, 2.8], -Math.PI / 2, "run", [-1, 0]);

// ---- 4. encounter arming test at candidate positions ------------------------
console.log("\n================ ENCOUNTER arming vs position ==================");
function actorPoses(tick) {
  return watcherPosesAtTick(tick, 0).map((p) => ({ id: p.id, pos: p.position, yaw: p.baseYaw }));
}
function tryArm(label, pos) {
  for (const def of M1_ENCOUNTERS) {
    const variant = selectEncounterVariant(def, SEED, def.order);
    const inst = createEncounterInstance(def, variant);
    // single arm tick, grounded at pos
    stepEncounter(inst, {
      world, tick: 0,
      player: { pos: { x: pos[0], y: pos[1], z: pos[2] }, grounded: true },
      actorPoses: actorPoses(0), dt: DT, submit: false, verdict: null, dismiss: false,
    });
    const armed = inst.phase !== "DORMANT";
    const t = def.trigger;
    const dXZ = Math.hypot(pos[0] - t.at[0], pos[2] - t.at[2]);
    const dY = Math.abs(pos[1] - t.at[1]);
    console.log(
      `  ${label.padEnd(30)} vs ${def.id.padEnd(14)} at[${t.at}] r=${t.radiusM}: ` +
      `dXZ=${f2(dXZ)} dY=${f2(dY)} -> ${armed ? "ARMED " + inst.phase : "dormant"}`,
    );
  }
}
tryArm("elm base ground (77,0,3)", [77, 0, 3]);
tryArm("elm base ground (80,0,2)", [80, 0, 2]);
tryArm("meeting roof billman spot", [74.6, 8.2, 9.4]);
tryArm("cobbles under billman (y0)", [74.6, 0, 9.4]);
