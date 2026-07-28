// Compiled-world inspection (structure, not a physics claim): for each authored
// climb volume, report the destination surface kind (platform/blocker), its Y,
// what solid mass sits under the volume, and the nearest open edge direction.
// Also dump encounter stances + roof surfaces near the screenshot's roof-walk.
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";
import { compileLevel } from "../packages/mission-m1/src/compile.ts";

const level = M1_EFFIGY_RUN;
const { world } = compileLevel(level);
const platById = new Map(world.platforms.map((p) => [p.id, p]));
const blkById = new Map(world.blockers.map((b) => [b.id, b]));

console.log("=== CLIMB VOLUMES ===");
for (const v of world.climbVolumes ?? []) {
  const cx = (v.minX + v.maxX) / 2, cz = (v.minZ + v.maxZ) / 2;
  const dest = platById.get(v.toSurface) || blkById.get(v.toSurface);
  const destKind = platById.has(v.toSurface) ? "PLATFORM" : blkById.has(v.toSurface) ? "BLOCKER" : "??";
  const destY = platById.get(v.toSurface)?.y ?? blkById.get(v.toSurface)?.topY ?? null;
  // Solid mass column under the volume centre.
  const under = world.blockers.filter((b) => cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ);
  console.log(`${v.id}`);
  console.log(`  foot=(${cx.toFixed(1)},${((v.minY+v.maxY)/2).toFixed(1)},${cz.toFixed(1)}) onto=${v.toSurface}[${destKind} y=${destY}]`);
  console.log(`  masses under centre: ${under.map((b)=>`${b.id}[${b.baseY}-${b.topY}]`).join(", ") || "none"}`);
}

console.log("\n=== ENCOUNTERS ===");
for (const e of level.encounters ?? []) {
  console.log(`${e.id ?? e.kind ?? "?"} @ ${JSON.stringify(e.at ?? e.stance ?? e.pos ?? null)}`);
}

console.log("\n=== ROOF/LEADS surfaces (platforms y 3-12) near meeting house (x>70) ===");
for (const p of world.platforms) {
  const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
  if (cx > 68 && p.y >= 2.5 && p.y <= 12) {
    console.log(`${p.id} y=${p.y} rect x[${p.minX.toFixed(1)},${p.maxX.toFixed(1)}] z[${p.minZ.toFixed(1)},${p.maxZ.toFixed(1)}]`);
  }
}
