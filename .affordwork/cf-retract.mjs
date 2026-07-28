// Counterfactual: retract the flanking stall canopies' south overhang (z -0.2 -> +0.4,
// flush to the stall mass) and check (1) the naive z=-0.4 barrel vault now commits,
// and (2) the traversability counterfactual (old z=-0.35 barrels) is still refused.
import { probeAhead, selectVerb } from "@pa/engine-world/parkour";
import { beginAuthored, createGroundedState, RUN_SPEED } from "@pa/engine-world/playerMotion";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
const { compileLevel } = await import("/Users/ramsarma/Projects/project-archive-worktrees/mission-world/packages/mission-m1/src/compile.ts");

function withRetractedCanopies(southZ) {
  return {
    ...M1_EFFIGY_RUN,
    decks: M1_EFFIGY_RUN.decks.map((d) =>
      /^STALL_\d+__CANOPY$/.test(d.id) && d.rect.minZ < southZ
        ? { ...d, rect: { ...d.rect, minZ: southZ } }
        : d,
    ),
  };
}

function vaultCommits(level, z) {
  const { world } = compileLevel(level);
  const pos = { x: 21.1, y: 0, z };
  const vel = { x: RUN_SPEED, y: 0, z: 0 };
  const motion = { ...createGroundedState(pos, Math.PI / 2), vel };
  const probe = probeAhead(world, { pos, velX: vel.x, velZ: vel.z, yaw: Math.PI / 2, intentX: 1, intentZ: 0, motion });
  const ctx = { grounded: true, sprintHeld: true, jumpBuffered: false, pushing: true, crouchHeld: false, chaining: false, receivingTargets: [], reducedMotion: false };
  const choice = selectVerb(world, probe, ctx, pos);
  if (!choice || choice.motion.kind !== "AUTHORED") return { verb: choice?.verb ?? null, began: false };
  const began = beginAuthored(world, motion, { kind: choice.motion.authored, anchors: choice.motion.anchors, durationMs: choice.motion.durationMs, ignore: choice.motion.ignore, arcHeight: choice.motion.arcHeight });
  return { verb: choice.verb, began: began !== null };
}

for (const southZ of [-0.2, 0.0, 0.4]) {
  const level = southZ === -0.2 ? M1_EFFIGY_RUN : withRetractedCanopies(southZ);
  console.log(`\ncanopy southZ=${southZ}:`);
  for (const z of [-0.4, -0.5, -0.6]) console.log(`  vault @z${z}: ${JSON.stringify(vaultCommits(level, z))}`);
}
