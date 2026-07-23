// Generate isolated Gemini concepts for the modular common-press v2.
// Reuses the proven gateway client while keeping outputs in a dedicated folder.
// Usage: node assets/pipeline/gen_press_v2_concepts.mjs [--force] [--only key,key]
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PRESS_V2_COMPONENTS, PRESS_V2_DIRS } from "./press_v2_queue.mjs";

const force = process.argv.includes("--force");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0
  ? new Set((process.argv[onlyIndex + 1] ?? "").split(",").filter(Boolean))
  : null;
const outDir = resolve(PRESS_V2_DIRS.concepts);
mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const component of PRESS_V2_COMPONENTS) {
  if (only && !only.has(component.key)) continue;
  const out = resolve(outDir, `${component.key}.png`);
  if (existsSync(out) && !force) {
    console.log("SKIP", component.key);
    continue;
  }
  const result = spawnSync(process.execPath, [
    "assets/pipeline/gen_concept_image.mjs",
    "--prompt", component.prompt,
    "--out", out,
  ], { cwd: resolve("."), stdio: "inherit" });
  if (result.status !== 0) {
    console.error("FAIL", component.key, "exit", result.status);
    failed++;
  }
}
process.exit(failed ? 1 : 0);

