// Generate a character with Meshy text-to-3D (preview -> refine), then rig it.
// Usage: node assets/pipeline/gen_character.mjs <name> <heightMeters> "<prompt>"
// Writes assets/build/characters/<name>-refined.glb and <name>-rigged.glb
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const [, , name, heightArg, prompt] = process.argv;
if (!name || !prompt) {
  console.error('usage: node gen_character.mjs <name> <height> "<prompt>"');
  process.exit(1);
}
const height = Number(heightArg ?? "1.7");
const outDir = resolve("assets/build/characters");
mkdirSync(outDir, { recursive: true });

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

async function download(url, path) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  console.log("WROTE", path, buf.length, "bytes");
}

async function main() {
  const refinedPath = `${outDir}/${name}-refined.glb`;

  if (!existsSync(refinedPath)) {
    console.log(`[${name}] preview task...`);
    const prevRes = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
      method: "POST", headers,
      body: JSON.stringify({
        mode: "preview",
        prompt,
        art_style: "realistic",
        topology: "triangle",
        target_polycount: 60000,
        symmetry_mode: "auto",
        pose_mode: "t-pose",
      }),
    });
    if (!prevRes.ok) { console.error("preview create failed:", prevRes.status, await prevRes.text()); process.exit(1); }
    const previewId = (await prevRes.json()).result;
    const preview = await poll(`https://api.meshy.ai/openapi/v2/text-to-3d/${previewId}`, `${name} preview`);
    if (preview.status !== "SUCCEEDED") { console.error(JSON.stringify(preview.task_error ?? preview, null, 2)); process.exit(1); }

    console.log(`[${name}] refine task...`);
    const refRes = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
      method: "POST", headers,
      body: JSON.stringify({ mode: "refine", preview_task_id: previewId, enable_pbr: false }),
    });
    if (!refRes.ok) { console.error("refine create failed:", refRes.status, await refRes.text()); process.exit(1); }
    const refineId = (await refRes.json()).result;
    const refine = await poll(`https://api.meshy.ai/openapi/v2/text-to-3d/${refineId}`, `${name} refine`);
    if (refine.status !== "SUCCEEDED") { console.error(JSON.stringify(refine.task_error ?? refine, null, 2)); process.exit(1); }
    await download(refine.model_urls.glb, refinedPath);
  } else {
    console.log(`[${name}] refined model exists, skipping generation`);
  }

  console.log(`[${name}] rigging...`);
  const glb = readFileSync(refinedPath);
  const rigRes = await fetch("https://api.meshy.ai/openapi/v1/rigging", {
    method: "POST", headers,
    body: JSON.stringify({
      model_url: `data:model/gltf-binary;base64,${glb.toString("base64")}`,
      height_meters: height,
    }),
  });
  if (!rigRes.ok) { console.error("rig create failed:", rigRes.status, await rigRes.text()); process.exit(1); }
  const rigId = (await rigRes.json()).result;
  const rig = await poll(`https://api.meshy.ai/openapi/v1/rigging/${rigId}`, `${name} rig`);
  if (rig.status !== "SUCCEEDED") { console.error(JSON.stringify(rig.task_error ?? rig, null, 2)); process.exit(1); }
  const url = rig.result?.rigged_character_glb_url ?? rig.result?.character_glb_url;
  await download(url, `${outDir}/${name}-rigged.glb`);
  writeFileSync(`${outDir}/${name}-rig-task.json`, JSON.stringify(rig, null, 2));
  console.log(`[${name}] DONE`);
}

main().catch((e) => { console.error(e); process.exit(1); });
