// Systematic sweep: a running jump off every bough spot in 8 directions, run
// through the REAL production solver. Report the worst outcomes: any body that
// ends embedded, deck-cut, below y=-0.02, or comes to rest off the authored
// descent. This maps exactly what "jump off the boughs" does today.
//
//   node --import tsx .affordwork/sweep-elm-jumps.mjs
import { compileLevel } from "../packages/mission-m1/src/compile.ts";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";
import { supportBelow } from "../packages/engine-world/src/collision.ts";
import {
  createGroundedState,
  beginRunningJump,
  beginStandingJump,
  stepMotion,
  motionPenetration,
  RUN_SPEED,
} from "../packages/engine-world/src/playerMotion.ts";
import { FIELD_TICK_HZ } from "../packages/engine-world/src/fieldSimulation.ts";

const { world } = compileLevel(M1_EFFIGY_RUN);
const DT = 1 / FIELD_TICK_HZ;
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

const DIRS = [
  [1, 0, "E"], [-1, 0, "W"], [0, 1, "N"], [0, -1, "S"],
  [0.7, 0.7, "NE"], [0.7, -0.7, "SE"], [-0.7, 0.7, "NW"], [-0.7, -0.7, "SW"],
];

// Standing spots on each tier a player could take off from.
const SPOTS = [
  ["crown F_POST", 79.6, 8.3, 0.4],
  ["crown F_CROWN", 79.6, 8.3, 1.9],
  ["crown F_CROWN_E", 82.6, 8.3, 2.6],
  ["crown centre", 81.0, 8.3, 0.8],
  ["low F_POST_STEP", 79.6, 6.4, 3.8],
  ["low bough W", 78.0, 6.4, 0.0],
  ["low bough E", 84.0, 6.4, 0.0],
  ["upper bough", 82.0, 11.2, 2.6],
  ["awning F_AWNING", 77.0, 3.2, 2.8],
];

let worstFall = 0, worstEmbed = 0, belowGround = 0, deckCuts = 0;
const notable = [];

for (const [label, x, y, z] of SPOTS) {
  for (const [dx, dz, dname] of DIRS) {
    let state = createGroundedState({ x, y, z }, Math.atan2(dx, dz));
    state = stepMotion(world, state, { dt: DT, targetVelX: 0, targetVelZ: 0, reducedMotion: false }).state;
    const startY = state.pos.y;
    state = beginRunningJump({ ...state, vel: { x: dx * RUN_SPEED, y: 0, z: dz * RUN_SPEED } });
    let minY = state.pos.y, embed = 0, deckCut = null;
    let landed = false, landTick = null;
    for (let t = 0; t < 1500; t++) {
      state = stepMotion(world, state, { dt: DT, targetVelX: dx * RUN_SPEED, targetVelZ: dz * RUN_SPEED, reducedMotion: false }).state;
      minY = Math.min(minY, state.pos.y);
      const pen = motionPenetration(world, state);
      if (pen.embeds.length) embed = Math.max(embed, ...pen.embeds.map((e) => e.depthM));
      if (pen.deckId) deckCut = pen.deckId;
      if (state.grounded && t > 3) { landed = true; landTick = t; break; }
    }
    const fall = startY - minY;
    const s = supportBelow(world, state.pos.x, state.pos.z, state.pos.y + 0.02, 0.06);
    worstFall = Math.max(worstFall, fall);
    worstEmbed = Math.max(worstEmbed, embed);
    if (state.pos.y < -0.02) belowGround++;
    if (deckCut) deckCuts++;
    const flag = state.pos.y < -0.02 || embed > 0.05 || deckCut;
    if (flag || fall >= 5.5) {
      notable.push(
        `${label.padEnd(18)} ${dname.padEnd(2)}: start=${f2(startY)} rest=(${f2(state.pos.x)},${f2(state.pos.y)},${f2(state.pos.z)}) on=${s ? s.id : "NONE"} fall=${f2(fall)}m embed=${f2(embed)} deckCut=${deckCut ?? "-"} landed=${landed}`,
      );
    }
  }
}

console.log("worst fall:", f2(worstFall), "m   worst embed:", f2(worstEmbed), "m   below-ground rests:", belowGround, "   deck cuts:", deckCuts);
console.log("\nNotable outcomes (fall>=5.5m, or embed/deckcut/below-ground):");
for (const n of notable) console.log("  " + n);
