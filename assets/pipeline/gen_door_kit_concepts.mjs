// Generate the door-kit concept reference images (Gemini / Nano Banana Pro via
// the TrueFoundry gateway) as THREE isolated single-subject assets so Meshy never
// fuses the leaf into the frame (root cause #3). Delegates the actual image
// call to gen_concept_image.mjs so there is one image-generation implementation.
//
//   1. colonial-door-frame-recess  — stationary paneled jamb + lintel casing.
//   2. colonial-door-recess        — a separate shallow dark vestibule/backing.
//   3. colonial-door-leaf          — a single detached 6-panel wooden door leaf,
//      face-on, no frame, no wall, hinge stile on the left.
//
// Usage:
//   node assets/pipeline/gen_door_kit_concepts.mjs --check
//   node assets/pipeline/gen_door_kit_concepts.mjs [--count 2]
//
// Output: assets/source/concepts/colonial-door-frame-recess.png
//         assets/source/concepts/colonial-door-recess.png
//         assets/source/concepts/colonial-door-leaf.png
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONCEPT = resolve(HERE, "gen_concept_image.mjs");
const OUT_DIR = resolve(HERE, "..", "source", "concepts");

const COMMON =
  "Historically accurate 1765 Boston (colonial New England) working-class paneled " +
  "exterior door. Hand-planed painted wood, wrought-iron hardware, weathered but " +
  "intact. Neutral studio lighting, plain flat background, orthographic-style " +
  "front elevation, single subject, centered, no people, no ground, no text.";

const SUBJECTS = [
  {
    out: "colonial-door-frame-recess.png",
    prompt:
      `${COMMON} SUBJECT: only the stationary OPEN door SURROUND — a simple ` +
      `beaded/ovolo jamb and lintel casing framing a ~1.2m x 2.05m clear opening. ` +
      `The opening must be completely empty/transparent so this is only a three-sided ` +
      `frame with threshold; show the casing depth. NO door leaf, NO dark back panel, ` +
      `NO vestibule, NO wall filling the opening.`,
  },
  {
    out: "colonial-door-recess.png",
    prompt:
      `${COMMON} SUBJECT: only a shallow DARK WOODEN VESTIBULE BACKING for a door ` +
      `opening — a rectangular inset back panel with short side and top returns, ` +
      `approximately 1.18m wide x 2.03m tall x 0.18m deep. Matte near-black brown ` +
      `wood, designed to sit behind a door frame and fully occlude a sealed facade ` +
      `door when the functional leaf opens. NO door leaf, NO decorative casing, ` +
      `NO wall, NO floor slab beyond the shallow vestibule shell.`,
  },
  {
    out: "colonial-door-leaf.png",
    prompt:
      `${COMMON} SUBJECT: only a single DETACHED door leaf — a six-panel (two over ` +
      `two over two) stile-and-rail wooden door, ~1.12m wide x 2.0m tall x ~0.1m thick, ` +
      `wrought-iron thumb-latch and hinges on the LEFT hinge stile. No frame, no jamb, ` +
      `no wall, no opening around it — just the isolated leaf, face-on.`,
  },
];

const check = process.argv.includes("--check");
const countIdx = process.argv.indexOf("--count");
const count = countIdx >= 0 ? process.argv[countIdx + 1] : "1";

if (check) {
  execFileSync("node", [CONCEPT, "--check"], { stdio: "inherit" });
  process.exit(0);
}

for (const subject of SUBJECTS) {
  const out = resolve(OUT_DIR, subject.out);
  console.log(`\n=== ${subject.out} ===`);
  execFileSync(
    "node",
    [CONCEPT, "--prompt", subject.prompt, "--out", out, "--count", String(count)],
    { stdio: "inherit" },
  );
}
console.log("\nconcepts written to", OUT_DIR);
