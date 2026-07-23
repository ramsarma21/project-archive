// Turn the three door-kit concept images into separate Meshy image-to-3D GLB
// components (frame, recess, leaf) so Blender can assemble them into one rigged
// colonial-door-kit.glb with named nodes + animation. Keeping them separate is
// deliberate: a fused single-mesh door (the legacy colonial-door.glb) cannot be
// hinged without swinging the casing. Delegates to gen_prop_from_image.mjs.
//
// Usage: node assets/pipeline/gen_door_kit_meshy.mjs
// Inputs:  assets/source/concepts/colonial-door-frame-recess.png
//          assets/source/concepts/colonial-door-recess.png
//          assets/source/concepts/colonial-door-leaf.png
// Outputs: assets/build/door-kit/components/colonial-door-frame-recess.glb
//          assets/build/door-kit/components/colonial-door-recess.glb
//          assets/build/door-kit/components/colonial-door-leaf.glb
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROP = resolve(HERE, "gen_prop_from_image.mjs");
const CONCEPTS = resolve(HERE, "..", "source", "concepts");
const OUT = resolve(HERE, "..", "build", "door-kit", "components");
mkdirSync(OUT, { recursive: true });

const COMPONENTS = [
  { concept: "colonial-door-frame-recess.png", glb: "colonial-door-frame-recess.glb" },
  { concept: "colonial-door-recess.png", glb: "colonial-door-recess.glb" },
  { concept: "colonial-door-leaf.png", glb: "colonial-door-leaf.glb" },
];

for (const c of COMPONENTS) {
  const image = resolve(CONCEPTS, c.concept);
  if (!existsSync(image)) {
    console.error(`missing concept: ${image}\nRun gen_door_kit_concepts.mjs first.`);
    process.exit(1);
  }
  const out = resolve(OUT, c.glb);
  console.log(`\n=== meshy ${c.concept} -> ${c.glb} ===`);
  execFileSync("node", [PROP, image, out], { stdio: "inherit" });
}
console.log("\ncomponents written to", OUT, "\nnext: Blender assemble_door_kit.py");
