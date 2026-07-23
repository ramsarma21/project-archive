// Convert the QA'd interior STRUCTURAL concepts to textured GLBs via Meshy
// image-to-3D, driven by interior_structures_spec.json. Scoped output:
// writes raw GLB + <key>.glb.task.json sidecars into spec.rawDir only, so it
// never touches the shared world-v3 factory batches. Meshy target_polycount is
// set from each asset's triBudget (shells 50k so posts/beams/window mullions
// survive the later Blender decimation to 40k; partitions/floors 12k).
//
// Usage:
//   node assets/pipeline/gen_interior_structures_meshy.mjs             # all missing
//   node assets/pipeline/gen_interior_structures_meshy.mjs --force
//   node assets/pipeline/gen_interior_structures_meshy.mjs --only k1,k2 [--force]
//   node assets/pipeline/gen_interior_structures_meshy.mjs --concurrency 3
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

const spec = JSON.parse(readFileSync(resolve("assets/pipeline/interior_structures_spec.json"), "utf8"));
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const includeComponents = argv.includes("--components");
const onlyArg = argv[argv.indexOf("--only") + 1];
const only = argv.includes("--only") && onlyArg ? new Set(onlyArg.split(",")) : null;
const concArg = Number(argv[argv.indexOf("--concurrency") + 1]);
const CONCURRENCY = argv.includes("--concurrency") && concArg ? concArg : 4;

const env = readFileSync(resolve(".env"), "utf8");
const key = env.match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("MESHY_API_KEY missing");
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

mkdirSync(resolve(spec.rawDir), { recursive: true });

const polyFor = (asset) => (asset.triBudget >= 40000 ? 50000 : 12000);

async function convert(asset) {
  const conceptPath = resolve(`${spec.conceptDir}/${asset.key}.png`);
  const outPath = resolve(`${spec.rawDir}/${asset.key}.glb`);
  if (!existsSync(conceptPath)) return { key: asset.key, status: "NO_CONCEPT" };
  if (!force && existsSync(outPath)) return { key: asset.key, status: "SKIP" };

  const ext = extname(conceptPath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  const imageUrl = `data:${mime};base64,${readFileSync(conceptPath).toString("base64")}`;

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
      target_polycount: polyFor(asset),
      topology: "triangle",
      target_formats: ["glb"],
    }),
  });
  if (!create.ok) return { key: asset.key, status: "CREATE_FAIL", detail: `${create.status}: ${(await create.text()).slice(0, 300)}` };
  const { result: taskId } = await create.json();
  console.log(`[${asset.key}] task ${taskId} (poly ${polyFor(asset)})`);

  let task;
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const response = await fetch(`https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`, { headers });
    task = await response.json();
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break;
  }
  if (task?.status !== "SUCCEEDED") {
    return { key: asset.key, status: "GEN_FAIL", detail: JSON.stringify(task?.task_error ?? task?.status ?? task).slice(0, 300) };
  }
  const url = task.model_urls?.glb;
  if (!url) return { key: asset.key, status: "NO_GLB" };
  const file = await fetch(url);
  const bytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(outPath, bytes);
  writeFileSync(`${outPath}.task.json`, JSON.stringify(task, null, 2));
  console.log(`[${asset.key}] WROTE ${outPath} ${bytes.length}`);
  return { key: asset.key, status: "OK", bytes: bytes.length, taskId };
}

const queue = [
  ...spec.assets,
  ...(includeComponents ? (spec.modularComponents ?? []) : []),
].filter((a) => !only || only.has(a.key));
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const asset = queue[cursor++];
    try {
      results.push(await convert(asset));
    } catch (err) {
      results.push({ key: asset.key, status: "ERROR", detail: String(err).slice(0, 300) });
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

console.log("\n=== MESHY SUMMARY ===");
for (const r of results.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`${r.status.padEnd(11)} ${r.key}${r.detail ? "  " + r.detail : ""}${r.bytes ? "  " + r.bytes + "b" : ""}`);
}
const bad = results.filter((r) => !["OK", "SKIP"].includes(r.status));
console.log(`MESHY DONE ok=${results.filter((r) => r.status === "OK").length} skip=${results.filter((r) => r.status === "SKIP").length} failed=${bad.length}`);
if (bad.length) process.exit(1);
