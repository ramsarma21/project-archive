import { CAPSULE_RADIUS, STAND_HEIGHT, landingValid, blockerIdsAt, headClearance } from "@pa/engine-world/collision";
import { PARKOUR_TUNING } from "@pa/engine-world/parkour";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
const { compileLevel } = await import("/Users/ramsarma/Projects/project-archive-worktrees/mission-world/packages/mission-m1/src/compile.ts");
const { world } = compileLevel(M1_EFFIGY_RUN);
const ignore = new Set(["GAOL_BARRELS"]);
const arcH = PARKOUR_TUNING.vaultArcHeightM;
console.log("vaultArcHeightM =", arcH);

function sweep(z) {
  // anchors: start(21.1,0), nearTop(21.6,1.1), farTop(22.56,1.1), end(23.36,0)
  const anchors = [ {x:21.1,y:0}, {x:21.6,y:1.1}, {x:22.56,y:1.1}, {x:23.36,y:0} ];
  const endValid = landingValid(world, 23.36, z, CAPSULE_RADIUS, 0, STAND_HEIGHT, ignore);
  console.log(`\nz=${z}  endValid=${endValid}`);
  // Sample the polyline with a parabolic arc bump (approx). Report intruders.
  const hits = new Set();
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i+1];
    for (let t = 0; t <= 1; t += 0.1) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t + arcH * Math.sin(Math.PI * ((i + t) / (anchors.length - 1)));
      const ids = blockerIdsAt(world, { x, y, z }, CAPSULE_RADIUS, STAND_HEIGHT, ignore);
      const hc = headClearance(world, x, z, CAPSULE_RADIUS, y);
      for (const id of ids) hits.add(`${id}@(x${x.toFixed(2)},y${y.toFixed(2)})`);
      if (hc < STAND_HEIGHT && hc >= 0) hits.add(`HEADROOM ${hc.toFixed(2)}@(x${x.toFixed(2)},y${y.toFixed(2)})`);
    }
  }
  console.log("  intruders:", hits.size ? [...hits] : "none");
}
sweep(-0.4); sweep(-0.5); sweep(-0.6);
