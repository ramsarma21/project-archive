// Definitive diagnosis: at the wedge point, for z=-0.4 vs z=-0.6, dump the
// obstacle read, the ranked verbs, the VAULT plan, and whether beginAuthored
// accepts the vault trajectory (the commit gate). This says exactly why the
// vault refuses off-axis and what to fix.
import { probeAhead, selectVerb, rankVerbs } from "@pa/engine-world/parkour";
import { beginAuthored, createGroundedState, RUN_SPEED } from "@pa/engine-world/playerMotion";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
const { compileLevel } = await import("/Users/ramsarma/Projects/project-archive-worktrees/mission-world/packages/mission-m1/src/compile.ts");

const { world } = compileLevel(M1_EFFIGY_RUN);

function diag(z) {
  // Body just west of the barrel front (x=21.6), moving east at sprint speed.
  const pos = { x: 21.1, y: 0, z };
  const vel = { x: RUN_SPEED, y: 0, z: 0 };
  const motion = { ...createGroundedState(pos, Math.PI / 2), vel };
  const probe = probeAhead(world, { pos, velX: vel.x, velZ: vel.z, yaw: Math.PI / 2, intentX: 1, intentZ: 0, motion });
  const ctx = { grounded: true, sprintHeld: true, jumpBuffered: false, pushing: true, crouchHeld: false, chaining: false, receivingTargets: [], reducedMotion: false };
  const ranked = rankVerbs(probe, ctx);
  const choice = selectVerb(world, probe, ctx, pos);
  const ob = probe.obstacle;
  console.log(`\n=== z=${z} ===`);
  console.log("obstacle:", ob ? { id: ob.id, height: +ob.heightM.toFixed(2), depth: +ob.depthM.toFixed(2), faceD: +ob.faceDistanceM.toFixed(2), topStandable: ob.topStandable, farSide: ob.farSide ? { standable: ob.farSide.standable, drop: +ob.farSide.dropM.toFixed(2), pt: { x: +ob.farSide.point.x.toFixed(2), z: +ob.farSide.point.z.toFixed(2) } } : null, lowSpan: ob.lowSpan } : null);
  console.log("edge:", probe.edge ? { drop: +probe.edge.dropM.toFixed(2), contact: +probe.edge.contactDistanceM.toFixed(2) } : null);
  console.log("ranked:", ranked);
  console.log("selected:", choice ? { verb: choice.verb, reason: choice.reason } : null);
  if (choice && choice.motion.kind === "AUTHORED") {
    const began = beginAuthored(world, motion, { kind: choice.motion.authored, anchors: choice.motion.anchors, durationMs: choice.motion.durationMs, ignore: choice.motion.ignore, arcHeight: choice.motion.arcHeight });
    console.log("beginAuthored accepted:", began !== null, "anchors:", choice.motion.anchors.map((a) => ({ x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2) })), "ignore:", choice.motion.ignore);
  }
}
diag(-0.4);
diag(-0.5);
diag(-0.6);
