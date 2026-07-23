// M4 Meshy image-to-3D stage. Feeds QA'd concept PNGs into the proven Meshy
// pipeline scripts. Props -> gen_prop_from_image.mjs (assets/build/world-m4/),
// character -> gen_character_from_image.mjs (assets/build/characters/).
// Scoped to the M4 batch; skips already-built GLBs. Concurrency limited so we
// stay within Meshy's parallel-task budget.
//
// Usage: node assets/pipeline/m4/gen_m4_meshy.mjs [key ...]
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
process.chdir(ROOT);
const CON = "assets/source/concepts/m4";
const PROP_OUT = "assets/build/world-m4";
const CHAR_OUT = "assets/build/characters";
mkdirSync(PROP_OUT, { recursive: true });
mkdirSync(CHAR_OUT, { recursive: true });

// key -> { kind: "prop"|"char", out }
const PROPS = [
  "roof-walk-board",
  "roof-walk-board-long",
  "effigy-oliver",
  "effigy-boot",
  "organizer-crate-perch",
  "protest-torch",
  "protest-banner-cloth",
  "coin-paper-set",
  "street-dog",
  // Single source ink ball; the matched pair is assembled in assemble_ink_balls.py.
  "printer-ink-ball",
];
const JOBS = PROPS.map((k) => ({ key: k, kind: "prop", out: `${PROP_OUT}/${k}.glb` }));
JOBS.push({ key: "constable", kind: "char", out: `${CHAR_OUT}/constable-base.glb` });

const args = process.argv.slice(2);
const selected = args.length ? JOBS.filter((j) => args.includes(j.key)) : JOBS;
const MAX = 3;

function run(job) {
  return new Promise((res) => {
    const img = `${CON}/${job.key}.png`;
    if (!existsSync(img)) { console.log(`[skip] no concept ${job.key}`); return res({ job, ok: false }); }
    if (existsSync(job.out) && statSync(job.out).size > 1000) { console.log(`[cached] ${job.key}`); return res({ job, ok: true }); }
    const script = job.kind === "char" ? "gen_character_from_image.mjs" : "gen_prop_from_image.mjs";
    console.log(`[meshy:${job.kind}] ${job.key} -> ${job.out}`);
    const child = spawn("node", [`assets/pipeline/${script}`, img, job.out], { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const cap = (d) => { tail = (tail + d).slice(-400); };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    child.on("close", (code) => {
      if (code === 0) console.log(`[ok] ${job.key}`);
      else console.log(`[FAIL] ${job.key} (code ${code}): ${tail.trim().split("\n").slice(-2).join(" | ")}`);
      res({ job, ok: code === 0 });
    });
  });
}

const queue = [...selected];
const results = [];
async function worker() { while (queue.length) results.push(await run(queue.shift())); }
await Promise.all(Array.from({ length: MAX }, worker));
const okCount = results.filter((r) => r.ok).length;
console.log(`M4 MESHY DONE (${okCount}/${results.length} ok)`);
