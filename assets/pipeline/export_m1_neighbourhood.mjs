// Every draw around one collision part, as JSON, for an in-place render.
//
// The mission's own screenshot harness (`shot_m1_standing_in_place.mjs`) shoots
// through the gameplay chase camera, which sits behind the player's shoulder.
// That is the right camera for a building and the wrong one for a 2m prop in a
// 3m alley: at the hay wains it frames the underside of the pentice canvas
// hanging over them, and outside the ropewalk door it frames the inside of the
// shed the player just left. Neither picture is of the prop.
//
// So the placements come out here and are rebuilt in Blender by
// `render_m1_in_place.py`, which can put the camera where a person would stand to
// look at the thing. The placements are `sceneryPlacements()`, unmodified — the
// point of the render is that it is the arrangement the mission draws, not a
// tableau of the same assets.
//
// Run: node --import tsx assets/pipeline/export_m1_neighbourhood.mjs PART_ID [radius] [out.json]
globalThis.self = globalThis;
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));
const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");

const [partId, radiusArg, outArg] = process.argv.slice(2);
if (!partId) throw new Error("usage: export_m1_neighbourhood.mjs PART_ID [radius] [out.json]");
const radius = Number(radiusArg ?? 14);
const out = resolve(outArg ?? `assets/build/world-m1-standing/scene-${partId}.json`);

const mass = M1_EFFIGY_RUN.masses.find((m) => m.id === partId);
const deck = M1_EFFIGY_RUN.decks.find((d) => d.id === partId);
if (!mass && !deck) throw new Error(`no collision part "${partId}"`);
const onRoute = M1_EFFIGY_RUN.nodes.some((n) => n.surface === partId);
const part = mass
  ? { id: mass.id, kind: "MASS", rect: mass.rect, plane: onRoute ? mass.topY : mass.baseY }
  : { id: deck.id, kind: "DECK", rect: deck.rect, plane: deck.y };

const zone = {
  minX: part.rect.minX - radius, maxX: part.rect.maxX + radius,
  minZ: part.rect.minZ - radius, maxZ: part.rect.maxZ + radius,
};
const placements = sceneryPlacements().filter((p) => {
  const bx0 = p.pos[0] - p.size[0] / 2, bx1 = p.pos[0] + p.size[0] / 2;
  const bz0 = p.pos[2] - p.size[2] / 2, bz1 = p.pos[2] + p.size[2] / 2;
  return bx1 > zone.minX && bx0 < zone.maxX && bz1 > zone.minZ && bz0 < zone.maxZ;
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ part, radius, placements }, null, 2));
console.log(
  `${part.id} ${part.kind} plane ${part.plane.toFixed(2)}m: ` +
    `${placements.length} draws within ${radius}m -> ${out}`,
);
for (const p of placements) {
  console.log(
    `  ${p.id.padEnd(22)} ${p.asset.padEnd(26)} ${p.fit.padEnd(6)} ` +
      `size ${p.size.map((v) => v.toFixed(2)).join(" x ")} at ${p.pos.map((v) => v.toFixed(1)).join(", ")}`,
  );
}
