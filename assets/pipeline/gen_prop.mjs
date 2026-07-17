// Generate a world prop/building with Meshy text-to-3D (preview -> refine).
// Usage: node assets/pipeline/gen_prop.mjs <name> "<prompt>"
// Writes assets/build/world/<name>.glb
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const [, , name, prompt] = process.argv;
if (!name || !prompt) {
  console.error('usage: node gen_prop.mjs <name> "<prompt>"');
  process.exit(1);
}
const outDir = resolve("assets/build/world");
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/${name}.glb`;

if (existsSync(outPath)) {
  console.log(`[${name}] exists, skipping`);
  process.exit(0);
}

const key = readFileSync(resolve(".env"), "utf8").match(/^MESHY_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) { console.error("MESHY_API_KEY missing"); process.exit(1); }
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function poll(url, label) {
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(url, { headers });
    const task = await res.json();
    process.stdout.write(`\r${label}: ${task.status} ${task.progress ?? 0}%   `);
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) { console.log(); return task; }
  }
  throw new Error(`${label} timed out`);
}

async function main() {
  const prevRes = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
    method: "POST", headers,
    body: JSON.stringify({
      mode: "preview",
      prompt,
      art_style: "realistic",
      topology: "triangle",
      target_polycount: 40000,
      symmetry_mode: "auto",
    }),
  });
  if (!prevRes.ok) { console.error(`[${name}] preview create failed:`, prevRes.status, await prevRes.text()); process.exit(1); }
  const previewId = (await prevRes.json()).result;
  const preview = await poll(`https://api.meshy.ai/openapi/v2/text-to-3d/${previewId}`, `${name} preview`);
  if (preview.status !== "SUCCEEDED") { console.error(JSON.stringify(preview.task_error ?? preview, null, 2)); process.exit(1); }

  const refRes = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
    method: "POST", headers,
    body: JSON.stringify({ mode: "refine", preview_task_id: previewId, enable_pbr: false }),
  });
  if (!refRes.ok) { console.error(`[${name}] refine create failed:`, refRes.status, await refRes.text()); process.exit(1); }
  const refineId = (await refRes.json()).result;
  const refine = await poll(`https://api.meshy.ai/openapi/v2/text-to-3d/${refineId}`, `${name} refine`);
  if (refine.status !== "SUCCEEDED") { console.error(JSON.stringify(refine.task_error ?? refine, null, 2)); process.exit(1); }

  const res = await fetch(refine.model_urls.glb);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log("WROTE", outPath, buf.length, "bytes");
}

main().catch((e) => { console.error(e); process.exit(1); });
