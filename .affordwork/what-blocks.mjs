import { M1_EFFIGY_RUN } from "@pa/mission-m1";
const { compileLevel } = await import("/Users/ramsarma/Projects/project-archive-worktrees/mission-world/packages/mission-m1/src/compile.ts");
const { world } = compileLevel(M1_EFFIGY_RUN);
// Blockers overlapping the vault corridor x[21.0,23.6], z[-1.0,0.4].
console.log("BLOCKERS overlapping the barrel-vault corridor:");
for (const b of world.blockers) {
  if (b.maxX < 21.0 || b.minX > 23.6) continue;
  if (b.maxZ < -1.0 || b.minZ > 0.4) continue;
  console.log(`  ${b.id.padEnd(24)} x[${b.minX.toFixed(2)},${b.maxX.toFixed(2)}] z[${b.minZ.toFixed(2)},${b.maxZ.toFixed(2)}] y[${b.baseY?.toFixed?.(2) ?? "?"},${Number.isFinite(b.topY) ? b.topY.toFixed(2) : "inf"}] landable=${b.landable}`);
}
console.log("\nPLATFORMS/decks overlapping (y span around vault arc):");
for (const p of world.platforms ?? []) {
  if (p.maxX < 21.0 || p.minX > 23.6) continue;
  if (p.maxZ < -1.0 || p.minZ > 0.4) continue;
  console.log(`  ${p.id.padEnd(24)} x[${p.minX.toFixed(2)},${p.maxX.toFixed(2)}] z[${p.minZ.toFixed(2)},${p.maxZ.toFixed(2)}] y=${p.y?.toFixed?.(2)}`);
}
