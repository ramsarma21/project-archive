// Measure, at each grounded approach tick, the PRE-STEP speed and the derived
// per-gap min jump speed, plus a deterministic projection of the takeoff speed
// the body will actually reach at the lip. This sizes the fix.
const {
  FIELD_DT, RUN_SPEED, PARKOUR_TUNING, maxGapMetersForDrop, minGapJumpSpeedMps,
  createGroundedState, createFlowState, stepFlow, probeAhead,
} = await import(new URL("../packages/engine-world/src/index.ts", import.meta.url).pathname);
const { compileLevel: compile } = await import(
  new URL("../packages/mission-m1/src/compile.ts", import.meta.url).pathname
);
const { M1_EFFIGY_RUN } = await import(
  new URL("../packages/mission-m1/src/level/index.ts", import.meta.url).pathname
);
const level = M1_EFFIGY_RUN;
const world = compile(level).world;
const nb = (id) => level.nodes.find((n) => n.id === id).pos;
const S = nb("C_SCAFF_2"), G = nb("C_GALLERY_W");
const dl = Math.hypot(G[0] - S[0], G[2] - S[2]);
const dirX = (G[0] - S[0]) / dl, dirZ = (G[2] - S[2]) / dl;

// Deterministic grounded-accel projection over a straight flat run of runUpM,
// matching stepGrounded: b = 1 - exp(-ACCEL*dt*0.6), ACCEL=9.
function projectSpeed(v0, target, runUpM) {
  const b = 1 - Math.exp(-9 * FIELD_DT * 0.6);
  let v = v0, x = 0;
  for (let i = 0; i < 600 && x < runUpM; i++) { v += (target - v) * b; x += v * FIELD_DT; }
  return v;
}

let motion = createGroundedState({ x: S[0], y: S[1] + 0.05, z: S[2] }, Math.atan2(dirX, dirZ));
let flow = createFlowState();
const input = { dt: FIELD_DT, targetVelX: dirX * RUN_SPEED, targetVelZ: dirZ * RUN_SPEED,
  sprintHeld: true, crouchHeld: false, jumpBuffered: false, flowEnabled: true, reducedMotion: false, receivingTargets: [] };

for (let t = 0; t < 14; t++) {
  const preSpeed = Math.hypot(motion.vel.x, motion.vel.z);
  const probe = probeAhead(world, { pos: motion.pos, velX: motion.vel.x, velZ: motion.vel.z, yaw: motion.yaw,
    intentX: input.targetVelX, intentZ: input.targetVelZ, airtimeMs: motion.airtimeMs, capsuleHeight: motion.capsuleHeight, motion }, PARKOUR_TUNING);
  const e = probe.edge;
  let need = null, runUp = null, proj = null, projMax = null;
  if (e && e.gapM !== null && e.far) {
    need = minGapJumpSpeedMps(e.gapM, e.far.dropM, PARKOUR_TUNING.jumpGapSafetyM);
    runUp = Math.max(0, e.contactDistanceM - PARKOUR_TUNING.edgeCommitMinM);
    proj = projectSpeed(preSpeed, RUN_SPEED, runUp);
    projMax = maxGapMetersForDrop(e.far.dropM, proj);
  }
  console.log(
    `t${t} preSpeed=${preSpeed.toFixed(3)} cd=${e ? e.contactDistanceM.toFixed(3) : "-"} ` +
    `gap=${e && e.gapM !== null ? e.gapM.toFixed(2) : "-"} minNeed=${need ? need.toFixed(3) : "-"} ` +
    `runUp=${runUp !== null ? runUp.toFixed(3) : "-"} projTakeoff=${proj ? proj.toFixed(3) : "-"} ` +
    `projClears=${projMax !== null ? (projMax >= e.gapM + PARKOUR_TUNING.jumpGapSafetyM ? "YES(" + projMax.toFixed(2) + ")" : "no(" + projMax.toFixed(2) + ")") : "-"}`
  );
  const res = stepFlow(world, motion, flow, input, PARKOUR_TUNING);
  motion = res.motion; flow = res.flow;
}
