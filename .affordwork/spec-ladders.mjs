// Emit concrete ladder placements: for each authored climb volume, the foot
// (base), the served surface + its footprint/centroid, the rise height, and a
// derived outward FACE (from the served surface centroid toward the foot — the
// side a ladder leans on and faces the climber). This is the raw material for
// the mandatory placement spec handed to the geometry (mission-flow) lane.
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";
import { compileLevel } from "../packages/mission-m1/src/compile.ts";
import { surfaceRectById } from "../packages/engine-world/src/collision.ts";

const level = M1_EFFIGY_RUN;
const { world } = compileLevel(level);

for (const v of world.climbVolumes ?? []) {
  const fx = +((v.minX + v.maxX) / 2).toFixed(2);
  const fz = +((v.minZ + v.maxZ) / 2).toFixed(2);
  const fy = +((v.minY + v.maxY) / 2).toFixed(2);
  const rect = surfaceRectById(world, v.toSurface);
  const isPlatform = world.platforms.some((p) => p.id === v.toSurface);
  const kind = isPlatform ? "PLATFORM" : "LANDABLE-BLOCKER";
  let faceStr = "?", topY = null, cxz = "?";
  if (rect) {
    topY = rect.y;
    const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    cxz = `(${cx.toFixed(1)},${cz.toFixed(1)})`;
    let dx = fx - cx, dz = fz - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) { faceStr = "AMBIGUOUS(foot≈centroid) — needs route approach"; }
    else faceStr = `(${(dx/len).toFixed(2)},${(dz/len).toFixed(2)})`;
  }
  const rise = topY != null ? +(topY - fy).toFixed(2) : null;
  console.log(`${v.id.replace("CLIMBVOL_","")}`);
  console.log(`  base=(${fx},${fy},${fz})  onto=${v.toSurface}[${kind}] topY=${topY} centroid=${cxz} rise=${rise}m  outwardFace=${faceStr}`);
}
