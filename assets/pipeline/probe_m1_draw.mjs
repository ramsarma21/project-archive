// Scratch probe: what does the mission actually draw for a given asset key, and
// which authored surfaces land inside the box FittedGlb will fit the mesh into?
//
// Run: node --import tsx assets/pipeline/probe_m1_draw.mjs bldg-townhouse-1713
globalThis.self = globalThis;
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { GEOMETRY } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "level", "geometry.ts"))
);
const { ASSETS } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "assets.ts"))
);
const { sceneryPlacements } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "runtime.ts"))
);
const { M1_EFFIGY_RUN } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "level", "index.ts"))
);

const keys = process.argv.slice(2);
for (const key of keys.length ? keys : ["bldg-townhouse-1713", "steeple-meetinghouse-climbable"]) {
  const declared = ASSETS.find((a) => a.key === key);
  console.log(`\n=========== ${key}  declared sizeM ${JSON.stringify(declared?.sizeM)} status=${declared?.status}`);

  const masses = M1_EFFIGY_RUN.masses.filter((m) => m.asset === key);
  const decks = M1_EFFIGY_RUN.decks.filter((d) => d.asset === key);
  console.log(`entries: ${masses.length} masses, ${decks.length} decks`);
  for (const m of masses) {
    console.log(
      `  MASS ${m.id.padEnd(22)} x ${m.rect.minX.toFixed(2)}..${m.rect.maxX.toFixed(2)}` +
        ` z ${m.rect.minZ.toFixed(2)}..${m.rect.maxZ.toFixed(2)} y ${m.baseY.toFixed(2)}..${m.topY.toFixed(2)}` +
        ` landable=${m.landable}`,
    );
  }
  for (const d of decks) {
    console.log(
      `  DECK ${d.id.padEnd(22)} x ${d.rect.minX.toFixed(2)}..${d.rect.maxX.toFixed(2)}` +
        ` z ${d.rect.minZ.toFixed(2)}..${d.rect.maxZ.toFixed(2)} y ${d.y.toFixed(2)}` +
        ` carriedBy=[${d.carriedBy.join(",")}]`,
    );
  }

  const draws = sceneryPlacements().filter((p) => p.asset === key);
  console.log(`draws: ${draws.length}`);
  for (const p of draws) {
    const box = {
      minX: p.pos[0] - p.size[0] / 2,
      maxX: p.pos[0] + p.size[0] / 2,
      minZ: p.pos[2] - p.size[2] / 2,
      maxZ: p.pos[2] + p.size[2] / 2,
      minY: p.pos[1],
      maxY: p.pos[1] + p.size[1],
    };
    console.log(
      `  ${p.id.padEnd(22)} ${p.kind} ${p.fit} size ${p.size.map((v) => v.toFixed(2)).join(" x ")}` +
        ` at (${p.pos.map((v) => v.toFixed(2)).join(", ")}) yaw ${p.yaw}`,
    );
    console.log(
      `    drawable envelope  x ${box.minX.toFixed(2)}..${box.maxX.toFixed(2)}` +
        `  y ${box.minY.toFixed(2)}..${box.maxY.toFixed(2)}  z ${box.minZ.toFixed(2)}..${box.maxZ.toFixed(2)}`,
    );
    console.log(`    parts: ${p.parts.join(", ")}`);
    for (const id of p.parts) {
      const mass = masses.find((m) => m.id === id);
      const deckEntry = decks.find((d) => d.id === id);
      const r = (mass ?? deckEntry).rect;
      const outX = Math.max(box.minX - r.minX, r.maxX - box.maxX, 0);
      const outZ = Math.max(box.minZ - r.minZ, r.maxZ - box.maxZ, 0);
      const top = mass ? mass.topY : deckEntry.y;
      const outY = Math.max(top - box.maxY, 0);
      const verdict = outX > 1e-6 || outZ > 1e-6 || outY > 1e-6
        ? `OUTSIDE by x${outX.toFixed(2)} z${outZ.toFixed(2)} y${outY.toFixed(2)}`
        : "inside";
      console.log(`      ${id.padEnd(22)} ${verdict}`);
    }
  }

  // What box WOULD cover every part, given pos is fixed at the solids' centre?
  const all = [
    ...masses.map((m) => ({ rect: m.rect, top: m.topY })),
    ...decks.map((d) => ({ rect: d.rect, top: d.y })),
  ];
  if (draws.length === 1 && all.length) {
    const p = draws[0];
    const halfX = Math.max(...all.flatMap((e) => [p.pos[0] - e.rect.minX, e.rect.maxX - p.pos[0]]));
    const halfZ = Math.max(...all.flatMap((e) => [p.pos[2] - e.rect.minZ, e.rect.maxZ - p.pos[2]]));
    const top = Math.max(...all.map((e) => e.top));
    console.log(
      `  sizeM that would cover every part, centred on the draw: ` +
        `[${(halfX * 2).toFixed(2)}, ${(top - p.pos[1]).toFixed(2)}, ${(halfZ * 2).toFixed(2)}]`,
    );
  }
}

// Route nodes standing on each asset's surfaces.
const nodes = M1_EFFIGY_RUN.route?.nodes ?? M1_EFFIGY_RUN.nodes ?? [];
for (const key of keys.length ? keys : ["bldg-townhouse-1713", "steeple-meetinghouse-climbable"]) {
  const surfaces = new Set([
    ...M1_EFFIGY_RUN.masses.filter((m) => m.asset === key).map((m) => m.id),
    ...M1_EFFIGY_RUN.decks.filter((d) => d.asset === key).map((d) => d.id),
  ]);
  const standing = nodes.filter((n) => surfaces.has(n.surface));
  console.log(`\n${key}: ${standing.length} route nodes stand on it`);
  for (const n of standing) {
    console.log(`  ${n.id.padEnd(20)} ${n.surface.padEnd(18)} at ${n.pos.map((v) => v.toFixed(2)).join(", ")} [${n.tags.join(" ")}]`);
  }
}
