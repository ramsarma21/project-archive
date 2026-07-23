// Meshy image-to-3D driver for the interior FURNISHING/TRADE kit.
// Reads concept PNGs from assets/source/concepts/interior-kit/<key>.png and
// writes raw GLBs to assets/build/interior-kit/<key>.glb (+ .task.json with the
// Meshy task id recorded for provenance).
//
// Usage:
//   node assets/pipeline/gen_interior_kit_meshy.mjs --check
//   node assets/pipeline/gen_interior_kit_meshy.mjs [--only key,key] [--force] [--concurrency 4]
//
// Submits tasks up to a concurrency cap and polls each to completion. Skips
// keys whose GLB already exists unless --force, so the batch is resumable.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QUEUE } from "./interior_kit_queue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CONCEPT_DIR = resolve(ROOT, "assets/source/concepts/interior-kit");
const OUT_DIR = resolve(ROOT, "assets/build/interior-kit");

function readKey() {
  const env = readFileSync(resolve(ROOT, ".env"), "utf8");
  const k = process.env.MESHY_API_KEY?.trim() || env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!k) throw new Error("MESHY_API_KEY missing");
  return k;
}

function parseArgs(argv) {
  const args = { concurrency: 4 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--force") args.force = true;
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--concurrency") args.concurrency = Math.max(1, Math.min(8, Number(argv[++i]) || 4));
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

const KEY = readKey();
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const args = parseArgs(process.argv);

if (args.check) {
  const r = await fetch("https://api.meshy.ai/openapi/v1/balance", { headers });
  const body = await r.text();
  if (!r.ok) { console.error(`balance HTTP ${r.status}: ${body.slice(0, 200)}`); process.exit(1); }
  console.log("meshy ok:", body.slice(0, 200));
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(entry) {
  const concept = resolve(CONCEPT_DIR, `${entry.key}.png`);
  const out = resolve(OUT_DIR, `${entry.key}.glb`);
  if (!existsSync(concept)) return { key: entry.key, status: "NO_CONCEPT" };
  if (existsSync(out) && !args.force) return { key: entry.key, status: "SKIP" };

  const imageUrl = `data:image/png;base64,${readFileSync(concept).toString("base64")}`;
  const create = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
    method: "POST",
    headers,
    body: JSON.stringify({
      image_url: imageUrl,
      ai_model: "latest",
      symmetry_mode: "off",
      should_texture: true,
      enable_pbr: false,
      should_remesh: true,
      target_polycount: entry.meshy,
      topology: "triangle",
      target_formats: ["glb"],
    }),
  });
  if (!create.ok) return { key: entry.key, status: "CREATE_FAIL", error: `${create.status}: ${(await create.text()).slice(0, 200)}` };
  const { result: taskId } = await create.json();
  console.log(`[${entry.key}] task ${taskId} (poly ${entry.meshy})`);

  let task;
  for (let i = 0; i < 360; i++) {
    await sleep(5000);
    const r = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
    task = await r.json();
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
  }
  if (task?.status !== "SUCCEEDED") return { key: entry.key, status: task?.status ?? "TIMEOUT", taskId, error: JSON.stringify(task?.task_error ?? "") };
  const url = task.model_urls?.glb;
  if (!url) return { key: entry.key, status: "NO_GLB", taskId };
  const file = await fetch(url);
  const bytes = Buffer.from(await file.arrayBuffer());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  writeFileSync(`${out}.task.json`, JSON.stringify({ key: entry.key, taskId, meshyPoly: entry.meshy, conceptPath: `assets/source/concepts/interior-kit/${entry.key}.png`, status: task.status, model_urls: task.model_urls }, null, 2));
  console.log(`[${entry.key}] WROTE ${bytes.length}`);
  return { key: entry.key, status: "OK", taskId, bytes: bytes.length };
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = QUEUE.filter((q) => !args.only || args.only.includes(q.key));

// Simple concurrency pool.
const results = [];
let idx = 0;
async function worker() {
  while (idx < targets.length) {
    const entry = targets[idx++];
    try { results.push(await runOne(entry)); }
    catch (e) { results.push({ key: entry.key, status: "ERROR", error: String(e?.message ?? e) }); }
  }
}
await Promise.all(Array.from({ length: Math.min(args.concurrency, targets.length) }, worker));

console.log("\n=== Meshy batch results ===");
for (const r of results.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`${r.status.padEnd(11)} ${r.key}${r.taskId ? ` task=${r.taskId}` : ""}${r.error ? ` err=${r.error}` : ""}`);
}
const failed = results.filter((r) => !["OK", "SKIP"].includes(r.status));
console.log(`\nok=${results.filter((r) => r.status === "OK").length} skip=${results.filter((r) => r.status === "SKIP").length} failed=${failed.length}`);
process.exit(failed.length ? 1 : 0);
