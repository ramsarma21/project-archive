// Reproduce the C_SCAFF_2 -> C_GALLERY_W gallery gap-jump from a SHORT run-up,
// driving the REAL flow controller (stepFlow) against the REAL M1 collision
// world. No browser, but bit-identical to the client sim: same stepFlow, same
// probe, same world. Logs per tick which verb the ladder offers/commits and the
// edge read, so we can see EXACTLY which mechanism refuses the leap.
//
//   node --import tsx .affordwork/mw-gallery-leap.mjs
// Import by absolute source path so the driver needs no root @pa symlink; the
// packages' OWN internal @pa/* imports still resolve via their node_modules.
const {
  FIELD_DT,
  RUN_SPEED,
  PARKOUR_TUNING,
  MOVEMENT_CAPABILITIES,
  maxGapMetersForDrop,
  createGroundedState,
  createFlowState,
  stepFlow,
  probeAhead,
  rankVerbs,
  planVerb,
} = await import(new URL("../packages/engine-world/src/index.ts", import.meta.url).pathname);
const { compileLevel: compile } = await import(
  new URL("../packages/mission-m1/src/compile.ts", import.meta.url).pathname
);
const { M1_EFFIGY_RUN } = await import(
  new URL("../packages/mission-m1/src/level/index.ts", import.meta.url).pathname
);

const level = M1_EFFIGY_RUN;
const compiled = compile(level);
const world = compiled.world;

const nodeById = (id) => level.nodes.find((n) => n.id === id);
const SCAFF2 = nodeById("C_SCAFF_2").pos;   // [44.8, 5.6, -6.4]
const GALLW = nodeById("C_GALLERY_W").pos;  // [48.6, 5.6, -6.45]

// Direction of the leap (east, toward the gallery).
const dx = GALLW[0] - SCAFF2[0];
const dz = GALLW[2] - SCAFF2[2];
const dlen = Math.hypot(dx, dz);
const dirX = dx / dlen;
const dirZ = dz / dlen;
const yaw = Math.atan2(dirX, dirZ);

console.log("=== physics facts ===");
console.log("SCAFFOLD_D2 east edge x=46.1, GALLERY_N west edge x=47.5 -> flat gap 1.40m at y=5.6");
console.log("top-out node C_SCAFF_2 x=44.8 -> run-up to lip = 1.30m");
console.log("jumpGapMinSpeedMps =", PARKOUR_TUNING.jumpGapMinSpeedMps);
console.log("edgeBrakeMinDropM  =", PARKOUR_TUNING.edgeBrakeMinDropM, " (gap fall = 5.6m)");
console.log("maxFlatGap @RUN_SPEED =", MOVEMENT_CAPABILITIES.maxFlatGapM.toFixed(2));
for (const v of [1.5, 2.0, 2.22, 2.5, 3.0, 3.5, 4.0]) {
  console.log(`  clearable flat gap @${v.toFixed(2)}m/s = ${maxGapMetersForDrop(0, v).toFixed(2)}m`);
}
console.log();

// Start at the top-out, standing, facing the gallery — the SHORT run-up case.
let motion = createGroundedState({ x: SCAFF2[0], y: SCAFF2[1] + 0.05, z: SCAFF2[2] }, yaw);
let flow = createFlowState();

const input = {
  dt: FIELD_DT,
  targetVelX: dirX * RUN_SPEED,
  targetVelZ: dirZ * RUN_SPEED,
  sprintHeld: true,
  crouchHeld: false,
  jumpBuffered: false,
  flowEnabled: true,
  reducedMotion: false,
  receivingTargets: [],
};

const ctxOf = () => ({
  grounded: motion.grounded,
  sprintHeld: true,
  jumpBuffered: false,
  crouchHeld: false,
  chaining: flow.chainWindowTicks > 0,
  receivingTargets: [],
  reducedMotion: false,
  pushing: true,
});

console.log("=== driving W+Shift (no jump key), honest read ===");
let leaped = false;
let braked = false;
for (let tick = 0; tick < 240; tick++) {
  // Diagnostic read of the SAME probe stepFlow will take this tick.
  const probe = probeAhead(world, {
    pos: motion.pos,
    velX: motion.vel.x,
    velZ: motion.vel.z,
    yaw: motion.yaw,
    intentX: input.targetVelX,
    intentZ: input.targetVelZ,
    airtimeMs: motion.airtimeMs,
    capsuleHeight: motion.capsuleHeight,
    motion,
  });
  const ranked = motion.grounded ? rankVerbs(probe, ctxOf(), PARKOUR_TUNING) : [];
  const jgPlan = ranked.includes("JUMP_GAP")
    ? planVerb(world, probe, ctxOf(), "JUMP_GAP", motion.pos, PARKOUR_TUNING)
    : null;

  const res = stepFlow(world, motion, flow, input, PARKOUR_TUNING);
  motion = res.motion;
  flow = res.flow;

  const e = probe.edge;
  const speed = Math.hypot(motion.vel.x, motion.vel.z);
  const evNames = res.events.map((x) => x.type + ":" + x.verb).join(",");
  const line =
    `t${String(tick).padStart(3)} x=${motion.pos.x.toFixed(2)} y=${motion.pos.y.toFixed(2)} ` +
    `spd=${speed.toFixed(2)} verb=${flow.verb} prev=${flow.previewVerb} ` +
    `rank=[${ranked.join(">")}]` +
    (e ? ` edge{cd=${e.contactDistanceM.toFixed(2)} gap=${e.gapM === null ? "-" : e.gapM.toFixed(2)} dropM=${Number.isFinite(e.dropM) ? e.dropM.toFixed(2) : "inf"} far=${e.far ? e.far.dropM.toFixed(2) : "-"}}` : " edge{none}") +
    (jgPlan ? ` JG:OK(${jgPlan.reason})` : ranked.includes("JUMP_GAP") ? " JG:planNull" : "") +
    (evNames ? ` ev[${evNames}]` : "");
  // Only print interesting ticks: near the lip, or when a verb/brake fires.
  if (motion.pos.x > 45.0 || flow.verb !== "NONE" || evNames || !motion.grounded || tick < 3) {
    console.log(line);
  }
  if (res.events.some((x) => x.type === "edgeBraked")) braked = true;
  if (res.events.some((x) => x.type === "verbCommitted" && (x.verb === "JUMP_GAP"))) leaped = true;
  if (res.events.some((x) => x.type === "landed")) {
    console.log(`   -> landed at x=${motion.pos.x.toFixed(2)} y=${motion.pos.y.toFixed(2)} on gallery? (west edge x=47.5)`);
    break;
  }
  if (motion.pos.y < 1.0) { console.log("   -> FELL into the street"); break; }
}
console.log("\nRESULT:", leaped ? "LEAPED (JUMP_GAP committed)" : braked ? "EDGE_BRAKED (soft-lock / refused)" : "no leap, no brake");
