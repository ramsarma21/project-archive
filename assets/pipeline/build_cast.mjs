// Orchestrate the full cast build after Meshy rigging completes:
//   1. optimize_rigged.py  (decimate + shrink textures, keep skin)
//   2. bake_character_anims.py per character (rest-delta Mixamo retarget,
//      per-character clip subset, self-contained GLB with named clips)
//   3. sync into apps/web/public/world/characters
// Usage: node assets/pipeline/build_cast.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, statSync } from "node:fs";
import { resolve } from "node:path";

const BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender";
const OPT = resolve("assets/build/characters-opt");
const FINAL = resolve("assets/build/characters-final");
const WEB = resolve("apps/web/public/world/characters");

const LOCOMOTION = ["idle", "walk", "run"];
const SOCIAL = ["talk", "talk2", "talk3", "talk4", "argu1", "argue2"];
const WORK = ["work1", "work2"];

const CAST_CLIPS = {
  playerboy: null, // null = all 30
  abigail: [...LOCOMOTION, ...WORK, "talk", "talk2", "talk3", "talk4", "reach", "handoff"],
  thomas: [...LOCOMOTION, ...WORK, "talk", "talk2", "argu1", "carry", "carryWalk", "handoff", "reach"],
  pike: [...LOCOMOTION, ...WORK, "talk", "talk2", "talk3", "reach", "handoff", "search"],
  clarke: [...LOCOMOTION, ...SOCIAL, "work1", "reach"],
  rider: [...LOCOMOTION, ...WORK, "handoff", "reach", "carryWalk"],
  officer: [...LOCOMOTION, "search", "talk", "talk2", "argu1", "reach"],
  townsman: [...LOCOMOTION, ...SOCIAL, ...WORK, "cheer1", "cheer2", "circleWalk1", "circleWalk2", "carryWalk"],
  townswoman: [...LOCOMOTION, ...SOCIAL, ...WORK, "cheer1", "cheer2", "circleWalk1", "circleWalk2", "carryWalk"],
};

console.log("[cast] optimizing rigged characters...");
execFileSync(BLENDER, ["--background", "--python", "assets/pipeline/optimize_rigged.py"], { stdio: "inherit" });

mkdirSync(FINAL, { recursive: true });
mkdirSync(WEB, { recursive: true });

for (const [name, clips] of Object.entries(CAST_CLIPS)) {
  const src = `${OPT}/${name}-rigged.glb`;
  const out = `${FINAL}/${name}-rigged.glb`;
  if (!existsSync(src)) {
    console.log(`[cast] SKIP ${name} (no optimized rig)`);
    continue;
  }
  if (existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) {
    console.log(`[cast] ${name} up to date`);
  } else {
    console.log(`[cast] baking ${name}...`);
    const args = ["--background", "--python", "assets/pipeline/bake_character_anims.py", "--", src, out];
    if (clips) args.push(clips.join(","));
    execFileSync(BLENDER, args, { stdio: "inherit" });
  }
  cpSync(out, `${WEB}/${name}-rigged.glb`);
}
console.log("[cast] CAST BUILD DONE");
