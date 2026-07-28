// ISOLATION TEST: if the edge brake did not pre-empt the approach, does the body
// reach the gallery lip fast enough to auto-jump the 1.44m gap and LAND on the
// gallery? Answers Outcome 1 (makeable, guard is wrong) vs Outcome 2 (genuinely
// not makeable from 1.3m -> needs the scaffold deck widened, not my lane).
//
// The brake is neutralised ONLY in this scratch tuning (edgeBrakeMinDropM huge),
// to see the honest ballistic outcome of the run-up. Nothing shipped changes.
//   node --import tsx .affordwork/mw-gallery-nobrake.mjs
const {
  FIELD_DT, RUN_SPEED, PARKOUR_TUNING, maxGapMetersForDrop,
  createGroundedState, createFlowState, stepFlow,
} = await import(new URL("../packages/engine-world/src/index.ts", import.meta.url).pathname);
const { compileLevel: compile } = await import(
  new URL("../packages/mission-m1/src/compile.ts", import.meta.url).pathname
);
const { M1_EFFIGY_RUN } = await import(
  new URL("../packages/mission-m1/src/level/index.ts", import.meta.url).pathname
);

const level = M1_EFFIGY_RUN;
const world = compile(level).world;
const nodeById = (id) => level.nodes.find((n) => n.id === id).pos;
const SCAFF2 = nodeById("C_SCAFF_2");
const GALLW = nodeById("C_GALLERY_W");
const dx = GALLW[0] - SCAFF2[0], dz = GALLW[2] - SCAFF2[2];
const dl = Math.hypot(dx, dz);
const dirX = dx / dl, dirZ = dz / dl;
const yaw = Math.atan2(dirX, dirZ);

// Scratch tuning: brake effectively off, everything else identical.
const tuning = { ...PARKOUR_TUNING, edgeBrakeMinDropM: 999 };

let motion = createGroundedState({ x: SCAFF2[0], y: SCAFF2[1] + 0.05, z: SCAFF2[2] }, yaw);
let flow = createFlowState();
const input = {
  dt: FIELD_DT, targetVelX: dirX * RUN_SPEED, targetVelZ: dirZ * RUN_SPEED,
  sprintHeld: true, crouchHeld: false, jumpBuffered: false,
  flowEnabled: true, reducedMotion: false, receivingTargets: [],
};

let launchSpeed = null, launchX = null;
for (let tick = 0; tick < 240; tick++) {
  const res = stepFlow(world, motion, flow, input, tuning);
  motion = res.motion; flow = res.flow;
  const speed = Math.hypot(motion.vel.x, motion.vel.z);
  const ev = res.events.map((x) => x.type + ":" + x.verb).join(",");
  if (res.events.some((x) => x.type === "verbCommitted" && x.verb === "JUMP_GAP")) {
    launchSpeed = speed; launchX = motion.pos.x;
    console.log(`t${tick} JUMP_GAP committed at x=${motion.pos.x.toFixed(2)} launchSpeed~${speed.toFixed(2)} (maxGap@that=${maxGapMetersForDrop(0, speed).toFixed(2)}m vs gap 1.44)`);
  }
  if (ev) console.log(`t${tick} x=${motion.pos.x.toFixed(2)} y=${motion.pos.y.toFixed(2)} spd=${speed.toFixed(2)} verb=${flow.verb} ev[${ev}]`);
  if (res.events.some((x) => x.type === "landed")) {
    const onGallery = motion.pos.x >= 47.5 - 0.01 && motion.pos.y > 5.0;
    console.log(`\n-> LANDED at x=${motion.pos.x.toFixed(2)} y=${motion.pos.y.toFixed(2)} (gallery west edge x=47.5) ${onGallery ? "ON THE GALLERY ✓" : "NOT on gallery ✗"}`);
    break;
  }
  if (motion.pos.y < 1.0) { console.log(`\n-> FELL into the street at x=${motion.pos.x.toFixed(2)}`); break; }
}
if (launchSpeed === null) console.log("JUMP_GAP never committed even with the brake off");
