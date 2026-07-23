// Batch Meshy image-to-3D for the outdoor-density-kit concepts.
// Same request shape as gen_prop_from_image.mjs (established prop pipeline:
// ai_model latest, symmetry off, texture on, PBR off, remesh on, triangle
// topology, glb) but reads per-key target_polycount from density_kit.json and
// runs a small concurrency pool so 22 modules finish without serial waiting.
// Writes assets/build/world-v3/<key>.glb (+ .task.json) — unique keys, so it
// never collides with other overnight workers sharing that folder.
//
// Usage:
//   node assets/pipeline/gen_density_meshy.mjs                 # all missing
//   node assets/pipeline/gen_density_meshy.mjs key1 key2       # only these
//   FORCE=1 node assets/pipeline/gen_density_meshy.mjs         # rebuild all
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const kit = JSON.parse(readFileSync(join(here, "density_kit.json"), "utf8"));
const conceptDir = join(repoRoot, "assets", "source", "concepts", "density");
const outDir = join(repoRoot, "assets", "build", "world-v3");
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repoRoot, ".env"), "utf8");
const key = env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("MESHY_API_KEY missing");
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const only = process.argv.slice(2);
const force = process.env.FORCE === "1";
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);

const targets = kit.assets.filter((a) => only.length === 0 || only.includes(a.key));
const queue = [];
for (const asset of targets) {
  const out = join(outDir, `${asset.key}.glb`);
  if (existsSync(out) && !force) {
    console.log(`SKIP ${asset.key} (exists)`);
    continue;
  }
  const concept = join(conceptDir, `${asset.key}.png`);
  if (!existsSync(concept)) {
    console.log(`MISSING CONCEPT ${asset.key}`);
    continue;
  }
  queue.push(asset);
}

const results = { ok: [], failed: [] };

async function build(asset) {
  const concept = join(conceptDir, `${asset.key}.png`);
  const out = join(outDir, `${asset.key}.glb`);
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
      target_polycount: asset.meshyPoly ?? 30000,
      topology: "triangle",
      target_formats: ["glb"],
    }),
  });
  if (!create.ok) throw new Error(`create failed ${create.status}: ${await create.text()}`);
  const { result: taskId } = await create.json();
  console.log(`START ${asset.key} task=${taskId} poly=${asset.meshyPoly}`);
  let task;
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
    task = await res.json();
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
  }
  if (task?.status !== "SUCCEEDED") {
    throw new Error(`${asset.key} generation failed: ${JSON.stringify(task?.task_error ?? task?.status)}`);
  }
  const url = task.model_urls?.glb;
  if (!url) throw new Error(`${asset.key}: no GLB result`);
  const file = await fetch(url);
  const bytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(out, bytes);
  writeFileSync(out + ".task.json", JSON.stringify(task, null, 2));
  console.log(`DONE  ${asset.key} ${bytes.length} bytes`);
}

let idx = 0;
async function worker() {
  while (idx < queue.length) {
    const asset = queue[idx++];
    try {
      await build(asset);
      results.ok.push(asset.key);
    } catch (err) {
      console.error(`FAIL ${asset.key}: ${err?.message ?? err}`);
      results.failed.push(asset.key);
    }
  }
}

console.log(`Meshy queue: ${queue.length} assets, concurrency ${CONCURRENCY}`);
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
console.log(`\nMESHY: ok ${results.ok.length}, failed ${results.failed.length}${results.failed.length ? ": " + results.failed.join(", ") : ""}`);
process.exit(results.failed.length ? 1 : 0);
