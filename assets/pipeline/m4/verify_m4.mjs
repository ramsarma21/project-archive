// Scoped verification for the M4 prop batch: parse each GLB's JSON chunk and
// print node names (to confirm the semantic root + animation pivot empties made
// it through the exporter) alongside mesh/tri/image counts.
// Usage: node assets/pipeline/m4/verify_m4.mjs assets/build/world-m4-opt/*.glb
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function glbJson(data) {
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a binary glTF");
  const len = data.readUInt32LE(12);
  return JSON.parse(data.slice(20, 20 + len).toString("utf8"));
}

const EXPECTED_NODES = {
  "roof-walk-board.glb": ["roof-walk-board"],
  "roof-walk-board-long.glb": ["roof-walk-board-long"],
  "effigy-oliver.glb": ["effigy_carry_pivot", "effigy_hang_pivot", "placard_mount"],
  "effigy-boot.glb": ["boot_swing_pivot"],
  "organizer-crate-perch.glb": ["perch_stand"],
  "protest-torch.glb": ["torch_flame"],
  "protest-banner.glb": ["banner_face", "banner_sway_pivot"],
  "coin-paper-set.glb": ["coin-paper-set"],
  "street-dog.glb": ["street-dog"],
  "printer-ink-balls.glb": [
    "printer-ink-balls",
    "InkBall_Left",
    "InkBall_Right",
    "InkBall_Left_grip",
    "InkBall_Left_rock",
    "InkBall_Right_grip",
    "InkBall_Right_rock",
    "InkSurface_Left",
    "InkSurface_Right",
  ],
  "constable-rigged.glb": ["Hips", "Head", "LeftHand", "RightHand"],
};
const REQUIRED_CONSTABLE_CLIPS = [
  "idle",
  "walk",
  "run",
  "search",
  "talk",
  "talk2",
  "argu1",
  "reach",
];
const DEFAULT_FILES = [
  ...Object.keys(EXPECTED_NODES)
    .filter((name) => name !== "constable-rigged.glb")
    .map((name) => `apps/web/public/world/props/${name}`),
  "apps/web/public/world/characters/constable-rigged.glb",
];
const REQUIRED_TEXTURES = [
  "sign-watchhouse",
  "placard-andrew-oliver",
  "coinpaper-card",
  "banner-consent",
  "banner-never-asked",
].map((key) => `apps/web/public/world/posters/${key}.png`);
const files = process.argv.slice(2);
if (files.length === 0) files.push(...DEFAULT_FILES);
let failures = 0;
for (const f of files) {
  try {
    const j = glbJson(readFileSync(resolve(f)));
    const nodes = (j.nodes ?? []).map((n) => n.name).filter(Boolean);
    const meshNodes = (j.nodes ?? []).filter((n) => n.mesh !== undefined).length;
    const emptyNodes = (j.nodes ?? []).filter((n) => n.mesh === undefined).length;
    console.log(`\n${f}`);
    console.log(`  nodes=${(j.nodes ?? []).length} meshNodes=${meshNodes} emptyNodes=${emptyNodes} images=${(j.images ?? []).length} materials=${(j.materials ?? []).length}`);
    console.log(`  names: ${nodes.join(", ")}`);
    const required = EXPECTED_NODES[basename(f)] ?? [];
    for (const name of required) {
      if (!nodes.includes(name)) {
        failures += 1;
        console.log(`  FAIL missing required node ${name}`);
      }
    }
    if (basename(f) === "constable-rigged.glb") {
      const clips = (j.animations ?? []).map((animation) => animation.name).filter(Boolean);
      console.log(`  clips: ${clips.join(", ")}`);
      for (const clip of REQUIRED_CONSTABLE_CLIPS) {
        if (!clips.includes(clip)) {
          failures += 1;
          console.log(`  FAIL missing required clip ${clip}`);
        }
      }
    }
  } catch (e) {
    failures += 1;
    console.log(`\n${f}\n  FAIL: ${e.message}`);
  }
}
for (const texture of REQUIRED_TEXTURES) {
  if (!existsSync(resolve(texture))) {
    failures += 1;
    console.log(`FAIL missing runtime texture ${texture}`);
  }
}
if (failures > 0) {
  console.error(`M4 verification failed: ${failures} issue(s)`);
  process.exit(1);
}
console.log(`M4 verification passed: ${files.length} GLBs, ${REQUIRED_TEXTURES.length} textures`);
