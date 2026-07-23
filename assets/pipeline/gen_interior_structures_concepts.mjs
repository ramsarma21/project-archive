// Drive gen_concept_image.mjs for the interior STRUCTURAL kit (v4) from
// interior_structures_spec.json. Applies the shared Bible-style single-asset
// cutaway template so each concept is a clean Meshy image-to-3D input.
//
// Usage:
//   node assets/pipeline/gen_interior_structures_concepts.mjs            # all missing
//   node assets/pipeline/gen_interior_structures_concepts.mjs --force    # regenerate all
//   node assets/pipeline/gen_interior_structures_concepts.mjs --only key1,key2 [--force]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const spec = JSON.parse(readFileSync(resolve("assets/pipeline/interior_structures_spec.json"), "utf8"));
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const includeComponents = argv.includes("--components");
const onlyArg = argv[argv.indexOf("--only") + 1];
const only = argv.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;

let generated = 0, skipped = 0, failed = [];
const componentTemplate =
  "Single imported modular interior architectural component only, isolated and centered in frame on a plain light-gray studio background, orthographic-like front three-quarter product view, no room, no exterior scene, no furniture, no people, no text, no watermark. Historically accurate 1765 Boston construction: {DETAIL}. The component must be complete, rectangular, straight, unwarped, with clean parallel edges, shallow realistic thickness, and directly usable as a repeated visible module in Blender. Do not add a floor, roof, facade, or surrounding structure.";
const floorTemplate =
  "Single flat modular floor TILE only, isolated and centered in frame on a plain light-gray studio background, top-down view at a very slight angle so its thin downward thickness is visible. No room, no walls, no ceiling, no door, no furniture, no people, no loose pieces, no text, no watermark. The tile must be one complete square, straight and unwarped, with clean parallel tileable edges and no raised border. Historically accurate 1765 Boston surface: {DETAIL}";
const queue = [
  ...spec.assets,
  ...(includeComponents ? (spec.modularComponents ?? []) : []),
];
for (const asset of queue) {
  if (only && !only.has(asset.key)) continue;
  const out = `${spec.conceptDir}/${asset.key}.png`;
  if (!force && existsSync(resolve(out))) {
    console.log("SKIP (exists)", asset.key);
    skipped++;
    continue;
  }
  const template = asset.key.startsWith("int-floor-")
    ? floorTemplate
    : spec.assets.includes(asset)
      ? spec.conceptTemplate
      : componentTemplate;
  const prompt = template
    .replace("{DETAIL}", asset.detail);
  console.log("\n=== GEN", asset.key, "===");
  const res = spawnSync("node", [
    "assets/pipeline/gen_concept_image.mjs",
    "--prompt", prompt,
    "--out", out,
    "--size", "1024x1024",
  ], { stdio: "inherit" });
  if (res.status === 0) generated++;
  else failed.push(asset.key);
}
console.log(`\nCONCEPTS DONE generated=${generated} skipped=${skipped} failed=${failed.length}${failed.length ? " ["+failed.join(",")+"]" : ""}`);
if (failed.length) process.exit(1);
