// Generate the outdoor-density-kit concept images defined in density_kit.json
// via the established gen_concept_image.mjs (TrueFoundry / Gemini gateway).
// Sequential to stay under gateway rate limits. Concepts land in
// assets/source/concepts/density/<key>.png (scoped subdir; touches nothing else).
//
// Usage:
//   node assets/pipeline/gen_density_concepts.mjs            # all missing
//   node assets/pipeline/gen_density_concepts.mjs key1 key2  # only these keys
//   FORCE=1 node assets/pipeline/gen_density_concepts.mjs    # regenerate even if present
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const kit = JSON.parse(readFileSync(join(here, "density_kit.json"), "utf8"));
const shared = kit._meta.sharedConstraint;
const outDir = join(repoRoot, "assets", "source", "concepts", "density");
mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const force = process.env.FORCE === "1";
const targets = kit.assets.filter((a) => only.length === 0 || only.includes(a.key));

let done = 0;
let skipped = 0;
let failed = [];
for (const asset of targets) {
  const out = join(outDir, `${asset.key}.png`);
  if (existsSync(out) && !force) {
    console.log(`SKIP ${asset.key} (exists)`);
    skipped++;
    continue;
  }
  const prompt = `${asset.prompt} ${shared}`;
  console.log(`GEN  ${asset.key} ...`);
  const res = spawnSync(
    "node",
    [join(here, "gen_concept_image.mjs"), "--prompt", prompt, "--out", out],
    { stdio: "inherit", cwd: repoRoot },
  );
  if (res.status === 0) done++;
  else failed.push(asset.key);
}
console.log(`\nCONCEPTS: generated ${done}, skipped ${skipped}, failed ${failed.length}${failed.length ? ": " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
